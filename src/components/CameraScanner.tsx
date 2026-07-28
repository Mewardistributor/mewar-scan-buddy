import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Loader2, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onDetected: (barcode: string) => void;
  onClose: () => void;
};

export function CameraScanner({ onDetected, onClose }: Props) {
  const containerId = "mdc-camera-reader";
  const scannerRef = useRef<any>(null);
  const firedRef = useRef(false);
  const runningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [processingFile, setProcessingFile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    firedRef.current = false;

    async function safeStop() {
      const s = scannerRef.current;
      if (!s || !runningRef.current) return;
      runningRef.current = false;
      try {
        await s.stop();
      } catch {
        /* already stopped, ignore */
      }
      try {
        s.clear();
      } catch {
        /* ignore */
      }
    }

    async function start() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(containerId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 150 },
          },
          (decodedText: string) => {
            if (firedRef.current) return;
            firedRef.current = true;
            const code = decodedText.trim();
            safeStop().finally(() => {
              onDetected(code);
            });
          },
          () => {
            /* per-frame miss, ignore */
          }
        );
        runningRef.current = true;
        if (!cancelled) setStarting(false);
      } catch (e) {
        if (!cancelled) {
          setStarting(false);
          setError(
            e instanceof Error
              ? e.message
              : "Could not start the camera. Please allow camera access and try again."
          );
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      safeStop();
    };
  }, [onDetected]);

  // Loads a file into an <img>, then re-draws it onto a canvas with a given
  // transform applied, returning a new File. Used to generate enhanced
  // variants (grayscale+contrast, upscaled, etc.) of a gallery photo so we
  // can retry barcode detection on a cleaner version of the same image.
  function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not load image"));
      };
      img.src = url;
    });
  }

  async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png", 1);
    });
    return new File([blob], name, { type: "image/png" });
  }

  // Grayscale + contrast-stretch variant — helps with glare, soft focus,
  // and low-contrast (e.g. glossy plastic wrap) barcodes.
  async function makeEnhancedVariant(img: HTMLImageElement): Promise<File> {
    const scale = img.width < 900 ? 900 / img.width : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // First pass: convert to grayscale, track min/max for contrast stretch
    let min = 255;
    let max = 0;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray[i / 4] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }

    const range = Math.max(max - min, 1);
    for (let i = 0; i < d.length; i += 4) {
      const stretched = ((gray[i / 4] - min) / range) * 255;
      d[i] = d[i + 1] = d[i + 2] = stretched;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvasToFile(canvas, "enhanced.png");
  }

  async function tryScan(scanner: any, file: File): Promise<string | null> {
    try {
      const result = await scanner.scanFile(file, false);
      return String(result).trim();
    } catch {
      return null;
    }
  }

  async function handleGalleryPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file || firedRef.current) return;

    setProcessingFile(true);
    setError(null);

    // A single Html5Qrcode instance can't run live camera scanning and
    // file scanning at the same time, so stop the live camera first.
    const s = scannerRef.current;
    if (s && runningRef.current) {
      runningRef.current = false;
      try {
        await s.stop();
      } catch {
        /* ignore */
      }
    }

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const fileScanner = new Html5Qrcode(containerId);

      // Attempt 1: the original photo, as-is.
      let result = await tryScan(fileScanner, file);

      // Attempt 2: an enhanced (grayscale + contrast-stretched, upscaled)
      // version, which handles glare and soft-focus photos better.
      if (!result) {
        try {
          const img = await loadImage(file);
          const enhanced = await makeEnhancedVariant(img);
          result = await tryScan(fileScanner, enhanced);
        } catch {
          /* enhancement failed, fall through to error below */
        }
      }

      try {
        fileScanner.clear();
      } catch {
        /* ignore */
      }

      if (result && !firedRef.current) {
        firedRef.current = true;
        onDetected(result);
      } else if (!result) {
        setProcessingFile(false);
        setError(
          "Could not find a barcode in that photo. Try a clearer, well-lit image with the barcode centered."
        );
      }
    } catch {
      setProcessingFile(false);
      setError(
        "Could not find a barcode in that photo. Try a clearer, well-lit image with the barcode centered."
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="font-display text-sm font-semibold">Point at the barcode</p>
        <Button size="icon" variant="secondary" onClick={onClose} aria-label="Close camera">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div id={containerId} className="mx-auto h-full w-full max-w-lg" />
        {(starting || processingFile) && !error ? (
          <div className="absolute inset-0 grid place-items-center bg-black/40 text-white">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              {processingFile ? (
                <p className="text-xs text-white/80">Reading barcode from photo...</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-4 bottom-24 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
            {error}
          </div>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleGalleryPick}
      />

      <div className="flex flex-col items-center gap-2 pb-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={processingFile}
        >
          <ImageIcon className="h-4 w-4" /> Upload from Gallery
        </Button>
        <p className="text-center text-xs text-white/70">
          Hold the barcode steady inside the box, about 15–25 cm away
        </p>
      </div>
    </div>
  );
}
