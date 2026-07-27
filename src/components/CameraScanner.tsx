import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onDetected: (barcode: string) => void;
  onClose: () => void;
};

export function CameraScanner({ onDetected, onClose }: Props) {
  const containerId = "mdc-camera-reader";
  const scannerRef = useRef<any>(null);
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    firedRef.current = false;

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
            // Stop the camera first, then hand off the code.
            scanner
              .stop()
              .catch(() => undefined)
              .finally(() => {
                onDetected(code);
              });
          },
          () => {
            // per-frame "not found" callback — ignore, this fires constantly while scanning
          }
        );

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
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              s.clear();
            } catch {
              /* ignore */
            }
          });
      }
    };
  }, [onDetected]);

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
        {starting && !error ? (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-4 bottom-8 rounded-xl bg-white p-4 text-sm text-red-600 shadow-lg">
            {error}
          </div>
        ) : null}
      </div>

      <p className="pb-4 text-center text-xs text-white/70">
        Hold the barcode steady inside the box, about 15–25 cm away
      </p>
    </div>
  );
}
