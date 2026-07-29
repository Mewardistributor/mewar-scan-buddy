import { useRef, useState } from "react";
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

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function PhotoMatchScanner({ products, onSelect, onClose, mode = "camera" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const openedRef = useRef(false);

  const [phase, setPhase] = useState<"start" | "processing" | "results" | "manual">("start");
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Product[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [noMatch, setNoMatch] = useState(false);

  // Auto-open the right native picker once, right when this component mounts.
  if (!openedRef.current) {
    openedRef.current = true;
    setTimeout(() => {
      if (mode === "gallery") galleryInputRef.current?.click();
      else cameraInputRef.current?.click();
    }, 50);
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
        const canvas = canvasRef.current ?? document.createElement("canvas");
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

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      // User cancelled the native picker with nothing captured/selected yet.
      if (phase === "start") onClose();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => processImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  function retakeWithCamera() {
    setError(null);
    setMatches([]);
    setNoMatch(false);
    setPhase("start");
    setTimeout(() => cameraInputRef.current?.click(), 50);
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
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      <canvas ref={canvasRef} className="hidden" />

      {/* Native camera app — capture="environment" opens the phone's own
          camera app, so zoom/focus/etc. are handled by the OS, not us. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileChosen}
      />
      {/* Plain gallery/file picker — no "capture" attribute. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
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

      {phase === "start" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-white/80">
            {mode === "gallery" ? "Opening gallery..." : "Opening camera..."}
          </p>
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
            <Button variant="outline" className="flex-1" onClick={retakeWithCamera}>
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
            <Button variant="outline" className="flex-1" onClick={retakeWithCamera}>
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
