import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, RotateCcw, Search, X, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Product } from "@/lib/supabase";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
  onClose: () => void;
  // "gallery": skip the camera entirely and open the photo picker right
  // away — used by a standalone "Upload from Gallery" entry point.
  mode?: "camera" | "gallery";
};

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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<"camera" | "processing" | "results" | "manual">("camera");
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Product[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  const [backCameras, setBackCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);

  const [pendingGalleryPick, setPendingGalleryPick] = useState(mode === "gallery");

  useEffect(() => {
    if (mode !== "gallery") return;
    fileInputRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "gallery") return;
    const input = fileInputRef.current;
    if (!input) return;
    const onCancel = () => {
      if (pendingGalleryPick) onClose();
    };
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingGalleryPick]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    if (phase !== "camera" || pendingGalleryPick) return;
    let cancelled = false;

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

        // Default camera: let the browser pick its own default back camera
        // via facingMode. Only use a specific deviceId once the user
        // explicitly taps "Switch Camera" — picking cams[0] directly can
        // accidentally select a telephoto/zoom lens on some phones.
        const target = cameraIndex > 0 ? cams[cameraIndex] : undefined;
        const baseConstraints: MediaStreamConstraints = {
          video: target
            ? { deviceId: { exact: target.deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(baseConstraints);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
          });
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const [track] = stream.getVideoTracks();
        trackRef.current = track;

        try {
          const caps: any = track.getCapabilities ? track.getCapabilities() : {};
          if (caps && caps.zoom && typeof caps.zoom.min === "number") {
            await (track as any).applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
          }
        } catch {
          /* ignore */
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      trackRef.current = null;
    };
  }, [phase, cameraIndex, pendingGalleryPick]);

  function switchCamera() {
    if (backCameras.length < 2) return;
    setCameraIndex((i) => (i + 1) % backCameras.length);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
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

  async function processImage(dataUrl: string) {
    stopStream();
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

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    await processImage(dataUrl);
  }

  function openGallery() {
    fileInputRef.current?.click();
  }

  function onGalleryFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingGalleryPick(false);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      processImage(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function retake() {
    setError(null);
    setMatches([]);
    setNoMatch(false);
    setPhase("camera");
  }

  const manualResults = manualQuery.trim()
    ? products.filter((p) =>
        normalize(p.product_name ?? "").includes(normalize(manualQuery))
      ).slice(0, 20)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onGalleryFileChosen}
      />

      <div className="flex items-center justify-between px-4 py-3">
        <p className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
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

      {phase === "camera" && pendingGalleryPick ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-white/80">Opening gallery...</p>
        </div>
      ) : null}

      {phase === "camera" && !pendingGalleryPick ? (
        <div className="relative flex-1 overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/50" />
          {error ? (
            <div className="absolute inset-x-4 bottom-32 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
              {error}
            </div>
          ) : (
            <p className="absolute inset-x-0 bottom-32 text-center text-xs font-medium text-white/80">
              Frame the whole product clearly
            </p>
          )}

          {backCameras.length > 1 ? (
            <button
              onClick={switchCamera}
              className="absolute right-4 top-16 z-10 rounded-full bg-black/50 px-3 py-2 text-xs font-medium text-white backdrop-blur-md active:scale-90"
            >
              Switch Camera ({cameraIndex + 1}/{backCameras.length})
            </button>
          ) : null}

          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => setPhase("manual")}>
              <Search className="h-4 w-4" /> Find by name
            </Button>
            <button
              onClick={capture}
              aria-label="Take photo"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 backdrop-blur-md active:scale-90"
            >
              <span className="h-12 w-12 rounded-full bg-white" />
            </button>
            <Button variant="secondary" size="sm" onClick={openGallery}>
              <ImageIcon className="h-4 w-4" /> Gallery
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "processing" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-white/80">AI is identifying the product...</p>
        </div>
      ) : null}

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
            <Button variant="outline" className="flex-1" onClick={retake}>
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
            <Button variant="outline" className="flex-1" onClick={retake}>
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
