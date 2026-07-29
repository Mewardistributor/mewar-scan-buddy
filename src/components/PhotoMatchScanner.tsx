import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, RotateCcw, Search, X, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Product } from "@/lib/supabase";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
  onClose: () => void;
  // "gallery": open straight into the gallery picker instead of the
  // camera — used by a standalone "Upload from Gallery" entry point.
  mode?: "camera" | "gallery";
};

// How often (ms) we silently grab a frame and ask the AI to match it
// while the live camera is open.
const AUTO_SCAN_INTERVAL_MS = 1800;

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function PhotoMatchScanner({ products, onSelect, onClose, mode = "camera" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const autoScanTimerRef = useRef<number | null>(null);
  const scanInFlightRef = useRef(false);
  const stoppedRef = useRef(false);

  const [phase, setPhase] = useState<"camera" | "processing" | "results" | "manual">(
    mode === "gallery" ? "processing" : "camera"
  );
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Product[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  const [backCameras, setBackCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning">("idle");

  // Lock page scroll while the full-screen scanner is open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // "gallery" mode: open the native picker once, no live camera at all.
  useEffect(() => {
    if (mode !== "gallery") return;
    const t = setTimeout(() => galleryInputRef.current?.click(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Live camera setup -------------------------------------------------

  useEffect(() => {
    if (phase !== "camera" || mode === "gallery") return;
    let cancelled = false;
    stoppedRef.current = false;

    async function discoverBackCameras(): Promise<MediaDeviceInfo[]> {
      try {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true });
          probe.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        if (!cams.length) return [];
        const sorted = [...cams].sort((a, b) => {
          const aWide = /wide|main/i.test(a.label) && !/tele/i.test(a.label) ? 0 : 1;
          const bWide = /wide|main/i.test(b.label) && !/tele/i.test(b.label) ? 0 : 1;
          return aWide - bWide;
        });
        return sorted;
      } catch {
        return [];
      }
    }

    async function startCamera() {
      try {
        let cams = backCameras;
        if (cams.length === 0) {
          cams = await discoverBackCameras();
          if (!cancelled) setBackCameras(cams);
        }

        // No forced width/height, no manual zoom tweaking — both were
        // found to cause a zoomed-in/cropped picture on some phones.
        // We just let the browser hand us its natural stream and then
        // fit it to the screen purely with CSS (object-fit: cover).
        const target = cameraIndex > 0 ? cams[cameraIndex] : undefined;
        const baseConstraints: MediaStreamConstraints = {
          video: target
            ? { deviceId: { exact: target.deviceId } }
            : { facingMode: { ideal: "environment" } },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(baseConstraints);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        startAutoScan();
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Could not start the camera. Please allow camera access."
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      stopAutoScan();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraIndex, mode]);

  function switchCamera() {
    if (backCameras.length < 2) return;
    setCameraIndex((i) => (i + 1) % backCameras.length);
  }

  function stopStream() {
    stopAutoScan();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // ---- Auto-scan loop -----------------------------------------------------

  function startAutoScan() {
    stopAutoScan();
    setScanStatus("scanning");
    autoScanTimerRef.current = window.setInterval(() => {
      if (stoppedRef.current || scanInFlightRef.current) return;
      grabFrameAndTryMatch();
    }, AUTO_SCAN_INTERVAL_MS);
  }

  function stopAutoScan() {
    if (autoScanTimerRef.current !== null) {
      window.clearInterval(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }
    setScanStatus("idle");
  }

  function captureFrameDataUrl(): string | null {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  // Silent background match attempt — does NOT switch the UI into the
  // big "processing" screen, so the live camera keeps running smoothly.
  // Only navigates away on a single confident match.
  async function grabFrameAndTryMatch() {
    const dataUrl = captureFrameDataUrl();
    if (!dataUrl) return;

    scanInFlightRef.current = true;
    try {
      const base64 = await resizeToBase64(dataUrl);
      const candidates = products
        .filter((p) => p.status !== "removed")
        .map((p) => ({ id: p.id, name: p.product_name ?? "" }));

      const { data, error: fnError } = await supabase.functions.invoke("match-product", {
        body: { image: base64, products: candidates },
      });

      if (fnError || data?.error) return; // silent fail, keep scanning
      const ids: string[] = Array.isArray(data?.matches) ? data.matches : [];
      const found = ids
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is Product => !!p);

      if (found.length === 1) {
        stopStream();
        onSelect(found[0]);
        return;
      }
      if (found.length > 1) {
        // Multiple plausible matches — pause auto-scan, let the user pick.
        stopAutoScan();
        setMatches(found);
        setPhase("results");
      }
      // found.length === 0 -> keep scanning silently
    } catch {
      /* ignore, keep scanning */
    } finally {
      scanInFlightRef.current = false;
    }
  }

  // Resizes the photo down to a reasonable size and returns raw base64
  // (no "data:image/jpeg;base64," prefix) — keeps the request fast/cheap.
  function resizeToBase64(dataUrl: string, maxDim = 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        const jpeg = canvas.toDataURL("image/jpeg", 0.85);
        resolve(jpeg.split(",")[1] ?? "");
      };
      img.onerror = () => reject(new Error("Could not process image"));
      img.src = dataUrl;
    });
  }

  // Manual "capture now" button — used as a fallback if auto-scan is
  // taking too long or user wants to force a check right now.
  async function manualCaptureNow() {
    const dataUrl = captureFrameDataUrl();
    if (!dataUrl) return;
    stopAutoScan();
    setPhase("processing");
    setError(null);
    setNoMatch(false);

    try {
      const base64 = await resizeToBase64(dataUrl);
      const candidates = products
        .filter((p) => p.status !== "removed")
        .map((p) => ({ id: p.id, name: p.product_name ?? "" }));

      const { data, error: fnError } = await supabase.functions.invoke("match-product", {
        body: { image: base64, products: candidates },
      });

      if (fnError) throw new Error(fnError.message || "AI match request failed");
      if (data?.error) throw new Error(data.error);

      const ids: string[] = Array.isArray(data?.matches) ? data.matches : [];
      const found = ids
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is Product => !!p);

      setMatches(found);

      if (found.length === 1) {
        stopStream();
        onSelect(found[0]);
        return;
      }
      if (found.length === 0) {
        setNoMatch(true);
        setPhase("manual");
        return;
      }
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not identify the product. Please try again.");
      setPhase("results");
      setMatches([]);
    }
  }

  // ---- Gallery mode (separate entry point, no live camera involved) ------

  async function processGalleryFile(dataUrl: string) {
    setPhase("processing");
    setError(null);
    setNoMatch(false);

    try {
      const base64 = await resizeToBase64(dataUrl);
      const candidates = products
        .filter((p) => p.status !== "removed")
        .map((p) => ({ id: p.id, name: p.product_name ?? "" }));

      const { data, error: fnError } = await supabase.functions.invoke("match-product", {
        body: { image: base64, products: candidates },
      });

      if (fnError) throw new Error(fnError.message || "AI match request failed");
      if (data?.error) throw new Error(data.error);

      const ids: string[] = Array.isArray(data?.matches) ? data.matches : [];
      const found = ids
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is Product => !!p);

      setMatches(found);

      if (found.length === 1) {
        onSelect(found[0]);
        return;
      }
      if (found.length === 0) {
        setNoMatch(true);
        setPhase("manual");
        return;
      }
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not identify the product. Please try again.");
      setPhase("results");
      setMatches([]);
    }
  }

  function onGalleryFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      if (mode === "gallery") onClose();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => processGalleryFile(reader.result as string);
    reader.readAsDataURL(file);
  }

  function backToLiveCamera() {
    setError(null);
    setMatches([]);
    setNoMatch(false);
    setPhase("camera");
  }

  function openGallery() {
    galleryInputRef.current?.click();
  }

  const manualResults = manualQuery.trim()
    ? products.filter((p) =>
        normalize(p.product_name ?? "").includes(normalize(manualQuery))
      ).slice(0, 20)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-black">
      <canvas ref={canvasRef} className="hidden" />

      {/* Plain gallery/file picker — only opened explicitly, never auto. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onGalleryFileChosen}
      />

      {/* Header — floats over the camera */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <p className="flex items-center gap-1.5 font-display text-sm font-semibold text-white drop-shadow">
          <Sparkles className="h-4 w-4 text-primary" /> Match by Photo (AI)
        </p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ---- Live camera view ---- */}
      {phase === "camera" ? (
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />

          {error ? (
            <div className="absolute inset-x-4 top-16 rounded-lg bg-destructive/90 px-3 py-2 text-sm text-white">
              {error}
            </div>
          ) : (
            <div className="absolute inset-x-0 top-16 flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur-md">
                <Loader2 className="h-3 w-3 animate-spin" />
                {scanStatus === "scanning" ? "Point at the product — auto-detecting..." : "Starting camera..."}
              </span>
            </div>
          )}

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-6 bg-gradient-to-t from-black/70 to-transparent px-4 pb-6 pt-10">
            <button
              onClick={openGallery}
              aria-label="Upload from gallery"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md active:scale-90"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <button
              onClick={manualCaptureNow}
              aria-label="Capture now"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 backdrop-blur-md active:scale-95"
            >
              <Camera className="h-6 w-6 text-white" />
            </button>

            <button
              onClick={switchCamera}
              disabled={backCameras.length < 2}
              aria-label="Switch camera"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md disabled:opacity-40 active:scale-90"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* ---- Processing (manual capture / gallery upload) ---- */}
      {phase === "processing" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-white/80">AI is identifying the product...</p>
        </div>
      ) : null}

      {/* ---- Multiple matches — user picks ---- */}
      {phase === "results" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="border-b border-border p-4">
            {error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : matches.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Found {matches.length} possible match{matches.length > 1 ? "es" : ""}. Tap the correct one.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Couldn't confidently identify that product. Retake the photo or find it by name.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {matches.length > 0 ? (
              <ul className="space-y-2">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelect(p)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/50 active:scale-[0.99]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.product_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          Req {p.required_box ?? 0} Box / {p.required_pcs ?? 0} Pcs
                        </span>
                      </span>
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex gap-2 border-t border-border p-4">
            <Button variant="outline" className="flex-1" onClick={backToLiveCamera}>
              <RotateCcw className="h-4 w-4" /> Retake
            </Button>
            <Button variant="outline" className="flex-1" onClick={openGallery}>
              <ImageIcon className="h-4 w-4" /> Gallery
            </Button>
            <Button variant="hero" className="flex-1" onClick={() => setPhase("manual")}>
              <Search className="h-4 w-4" /> By name
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---- Manual name search fallback ---- */}
      {phase === "manual" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="space-y-3 border-b border-border p-4">
            {noMatch ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                No match found — search manually below.
              </p>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="h-11 pl-9"
                placeholder="Type product name..."
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {manualQuery.trim() === "" ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Start typing to search products in this summary.
              </p>
            ) : manualResults.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No products match "{manualQuery}".
              </p>
            ) : (
              <ul className="space-y-2">
                {manualResults.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelect(p)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/50 active:scale-[0.99]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.product_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          Req {p.required_box ?? 0} Box / {p.required_pcs ?? 0} Pcs
                        </span>
                      </span>
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2 border-t border-border p-4">
            <Button variant="outline" className="flex-1" onClick={backToLiveCamera}>
              <Camera className="h-4 w-4" /> Camera
            </Button>
            <Button variant="outline" className="flex-1" onClick={openGallery}>
              <ImageIcon className="h-4 w-4" /> Gallery
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
