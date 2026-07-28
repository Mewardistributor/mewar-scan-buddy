import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, Search, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Product } from "@/lib/supabase";

type Props = {
  products: Product[];
  onSelect: (product: Product) => void;
  onClose: () => void;
};

// Normalize text: lowercase, strip punctuation, collapse whitespace.
// Works fine on both English and Hindi (Devanagari) text since we only
// strip ASCII punctuation and collapse spaces.
function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple word-overlap similarity score between OCR text and a product name.
function scoreMatch(ocrText: string, productName: string) {
  const ocrWords = new Set(normalize(ocrText).split(" ").filter((w) => w.length > 1));
  const nameWords = normalize(productName).split(" ").filter((w) => w.length > 1);
  if (nameWords.length === 0 || ocrWords.size === 0) return 0;
  let hits = 0;
  for (const w of nameWords) {
    if (ocrWords.has(w)) hits++;
    else {
      // partial/substring credit for close variants (e.g. "toothpaste" vs "tooth")
      for (const ow of ocrWords) {
        if (ow.length > 3 && (ow.includes(w) || w.includes(ow))) {
          hits += 0.5;
          break;
        }
      }
    }
  }
  return hits / nameWords.length;
}

export function PhotoMatchScanner({ products, onSelect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"camera" | "processing" | "results" | "manual">("camera");
  const [error, setError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [matches, setMatches] = useState<Product[]>([]);
  const [manualQuery, setManualQuery] = useState("");

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    if (phase !== "camera") return;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
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
    };
  }, [phase]);

  function findMatches(text: string): Product[] {
    const scored = products
      .map((p) => ({ p, score: scoreMatch(text, p.product_name) }))
      .filter((s) => s.score >= 0.34)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map((s) => s.p);
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

    streamRef.current?.getTracks().forEach((t) => t.stop());
    setPhase("processing");
    setError(null);

    try {
      const { default: Tesseract } = await import("tesseract.js");
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const result = await Tesseract.recognize(dataUrl, "eng+hin");
      const text = result.data.text || "";
      setOcrText(text);
      const found = findMatches(text);
      setMatches(found);
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the label. Please try again.");
      setPhase("results");
      setMatches([]);
    }
  }

  function retake() {
    setError(null);
    setOcrText("");
    setMatches([]);
    setPhase("camera");
  }

  const manualResults = manualQuery.trim()
    ? products.filter((p) =>
        normalize(p.product_name).includes(normalize(manualQuery))
      ).slice(0, 20)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-display text-sm font-semibold text-white">Match by Photo</p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {phase === "camera" ? (
        <div className="relative flex-1 overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/50" />
          {error ? (
            <div className="absolute inset-x-4 bottom-24 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
              {error}
            </div>
          ) : (
            <p className="absolute inset-x-0 bottom-24 text-center text-xs font-medium text-white/80">
              Frame the product name / label clearly
            </p>
          )}
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-4">
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
          </div>
        </div>
      ) : null}

      {phase === "processing" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-white/80">Reading the label...</p>
        </div>
      ) : null}

      {phase === "results" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="border-b border-border p-4">
            {matches.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Found {matches.length} possible match{matches.length > 1 ? "es" : ""}. Tap the
                correct one.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Couldn't confidently match that label. Retake the photo or find it by name.
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
              <RotateCcw className="h-4 w-4" /> Retake photo
            </Button>
            <Button variant="hero" className="flex-1" onClick={() => setPhase("manual")}>
              <Search className="h-4 w-4" /> Find by name
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "manual" ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
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
          <div className="border-t border-border p-4">
            <Button variant="outline" className="w-full" onClick={retake}>
              <Camera className="h-4 w-4" /> Back to camera
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
