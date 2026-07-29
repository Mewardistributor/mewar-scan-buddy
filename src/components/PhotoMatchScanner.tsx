import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Product } from "@/lib/supabase";
import { matchProductByPhoto } from "@/lib/match-product.functions";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
  onClose: () => void;
  mode?: "camera" | "gallery";
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SCAN_INTERVAL_MS = 3000;

export function PhotoMatchScanner({ products, onSelect, onClose, mode = "camera" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const firedRef = useRef(false);
  const cooldownUntilRef = useRef(0);

  const [phase, setPhase] = useState<"camera" | "results" | "manual">(
    mode === "gallery" ? "manual" : "camera"
  );
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Product[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  function stopCamera() {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function askGemini(base64Jpeg: string): Promise<string[]> {
    const result = await matchProductByPhoto({
      data: {
        image: base64Jpeg,
        products: products.map((p) => ({ id: p.id, name: p.product_name })),
      },
    });
    if (result.rateLimited) {
      // back off so we stop hammering the model
      cooldownUntilRef.current = Date.now() + 20000;
      setError("AI busy (rate limited) — retrying in a few seconds…");
    } else if (result.error) {
      setError(result.error);
    }
    return result.matches ?? [];
  }


  async function scanFrameOnce() {
    if (busyRef.current || firedRef.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    busyRef.current = true;
    setScanning(true);
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.split(",")[1];

      const matchIds = await askGemini(base64);
      if (firedRef.current || matchIds.length === 0) return;

      const found = matchIds
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is Product => !!p);

      if (found.length === 0) return;

      firedRef.current = true;
      stopCamera();

      if (found.length === 1) {
        onSelect(found[0]);
      } else {
        setMatches(found);
        setPhase("results");
      }
    } catch {
      // per-frame miss (network hiccup etc.) — just try again next tick
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

  useEffect(() => {
    if (mode === "gallery") {
      setTimeout(() => fileInputRef.current?.click(), 100);
      return;
    }
    if (phase !== "camera") return;
    let cancelled = false;
    firedRef.current = false;
    setVideoReady(false);

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(
            "Camera is not available here. Open the app in your phone browser (https), or use the gallery / name search."
          );
          return;
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
        } catch {
          // Some devices/browsers reject the facingMode constraint — retry plain video.
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.setAttribute("playsinline", "true");

          const tryPlay = async () => {
            try {
              await video.play();
            } catch {
              // Autoplay may be blocked without a user gesture on some browsers.
            }
          };

          video.onloadedmetadata = tryPlay;
          video.oncanplay = tryPlay;
          video.onplaying = () => setVideoReady(true);
          await tryPlay();

          // Fallback: if frames are flowing but events were missed, mark ready anyway.
          setTimeout(() => {
            if (!cancelled && video.videoWidth > 0) setVideoReady(true);
          }, 1500);
        }

        scanTimerRef.current = setInterval(scanFrameOnce, SCAN_INTERVAL_MS);
      } catch (e) {
        if (!cancelled) {
          const name = (e as { name?: string })?.name;
          setError(
            name === "NotAllowedError"
              ? "Camera permission blocked. Allow camera access for this site and try again."
              : name === "NotFoundError"
                ? "No camera found on this device."
                : e instanceof Error
                  ? e.message
                  : "Could not start the camera. Please allow camera access."
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, products]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      onClose();
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      try {
        const matchIds = await askGemini(base64);
        const found = matchIds
          .map((id) => products.find((p) => p.id === id))
          .filter((p): p is Product => !!p);
        setMatches(found);
      } catch {
        setMatches([]);
      }
      setPhase("results");
    };
    reader.readAsDataURL(file);
  }

  function retake() {
    setError(null);
    setMatches([]);
    firedRef.current = false;
    if (mode === "gallery") {
      setTimeout(() => fileInputRef.current?.click(), 100);
      setPhase("manual");
    } else {
      setPhase("camera");
    }
  }

  const manualResults = manualQuery.trim()
    ? products
        .filter((p) => normalize(p.product_name ?? "").includes(normalize(manualQuery)))
        .slice(0, 20)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />

      {phase === "camera" && mode === "camera" ? (
        <div className="relative flex-1 overflow-hidden bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            disablePictureInPicture
            controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
            className="absolute inset-0 h-full w-full object-contain bg-black"
          />

          {!videoReady && !error ? (
            <button
              onClick={() => videoRef.current?.play().catch(() => {})}
              className="absolute inset-0 z-[5] grid place-items-center bg-black/60 text-white"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-xs text-white/70">Starting camera... tap if it stays black</p>
              </div>
            </button>
          ) : null}

          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 backdrop-blur-md">
            <p className="font-display text-xs font-semibold tracking-wide text-white/90">
              Match by Photo (AI)
            </p>
          </div>

          <div
            className="pointer-events-none absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-2xl border-2 border-dashed border-white/50"
            style={{ height: "32%" }}
          />

          {error ? (
            <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
              {error}
            </div>
          ) : (
            <div className="absolute inset-x-0 bottom-10 z-10 flex flex-col items-center gap-3 px-6">
              <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 backdrop-blur-md">
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
                <p className="text-xs font-medium text-white/90">
                  Hold product steady — AI will open it automatically
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPhase("manual")}>
                <Search className="h-4 w-4" /> Find by name instead
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {phase === "results" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display text-sm font-semibold">Match by Photo</p>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="border-b border-border p-4">
            {matches.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                AI found {matches.length} possible match{matches.length > 1 ? "es" : ""}. Tap the
                correct one.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                AI couldn't confidently match that product. Retake the photo or find it by name.
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
              Retake / Rescan
            </Button>
            <Button variant="hero" className="flex-1" onClick={() => setPhase("manual")}>
              <Search className="h-4 w-4" /> Find by name
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "manual" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display text-sm font-semibold">Find by name</p>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="border-b border-border p-4">
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
                Start typing to search products in this summary, or use the button below.
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
          <div className="border-t border-border p-4">
            {mode === "gallery" ? (
              <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                Choose photo from gallery
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={retake}>
                Back to camera
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
