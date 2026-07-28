import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

type Props = {
  onDetected: (barcode: string) => void;
  onClose: () => void;
};

const FLOATING_WORDS = [
  "Mewar",
  "Distribution",
  "मेवाड़",
  "Patanjali",
  "HUL",
  "Mamaearth",
  "वितरण",
  "Dabur",
  "Amit",
  "वेयरहाउस",
];

export function CameraScanner({ onDetected, onClose }: Props) {
  const containerId = "mdc-camera-reader";
  const scannerRef = useRef<any>(null);
  const firedRef = useRef(false);
  const runningRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

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

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-black">
      {/* Full-bleed camera feed */}
      <div
        id={containerId}
        className="absolute inset-0 [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover"
      />

      {/* Floating drifting words, rising from bottom to top */}
      {!starting && !error ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {FLOATING_WORDS.map((word, i) => (
            <span
              key={word + i}
              className="absolute select-none whitespace-nowrap font-display font-semibold text-white/20"
              style={{
                left: `${(i * 37) % 90}%`,
                fontSize: `${12 + (i % 4) * 4}px`,
                animation: `mdc-float-up ${9 + (i % 5) * 2}s linear infinite`,
                animationDelay: `${i * 1.3}s`,
              }}
            >
              {word}
            </span>
          ))}
        </div>
      ) : null}

      <style>{`
        @keyframes mdc-float-up {
          0% { transform: translateY(110vh); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-10vh); opacity: 0; }
        }
      `}</style>

      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close camera"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-transform active:scale-90"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Center label */}
      <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 backdrop-blur-md">
        <p className="font-display text-xs font-semibold tracking-wide text-white/90">
          Collab with Students
        </p>
      </div>

      {/* Corner-bracket scan frame */}
      {!starting && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[32%] w-[84%] max-w-md">
            <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-primary" />
            <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-primary" />
            <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-primary" />
            <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-primary" />
            <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary/70 shadow-[0_0_12px_2px_rgba(13,92,83,0.8)] animate-pulse" />
          </div>
        </div>
      ) : null}

      {/* Bottom hint */}
      {!starting && !error ? (
        <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
          <div className="rounded-full bg-black/50 px-4 py-2 text-center backdrop-blur-md">
            <p className="text-xs font-medium text-white/90">Hold barcode inside the frame</p>
          </div>
        </div>
      ) : null}

      {starting ? (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-white">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-xs text-white/70">Starting camera...</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
          {error}
        </div>
      ) : null}
    </div>
  );
}
