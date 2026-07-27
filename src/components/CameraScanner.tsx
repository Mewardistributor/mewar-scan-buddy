import { useEffect, useRef, useState } from "react";
import { Loader2, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type Props = {
  onDetected: (barcode: string) => void;
  onClose: () => void;
};

export function CameraScanner({ onDetected, onClose }: Props) {
  const containerId = "mdc-camera-reader";
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;
        const formats = [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ];
        const scanner = new Html5Qrcode(containerId, { formatsToSupport: formats, verbose: false });
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 12, qrbox: { width: 260, height: 170 } },
          (decodedText) => {
            if (firedRef.current) return;
            firedRef.current = true;
            scanner
              .stop()
              .catch(() => undefined)
              .finally(() => onDetected(decodedText.trim()));
          },
          () => undefined,
        );
        if (!cancelled) setStarting(false);
      } catch (e) {
        if (!cancelled) {
          setStarting(false);
          setError(
            e instanceof Error ? e.message : "Camera unavailable. Use the scanner or search below.",
          );
        }
      }
    })();

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
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="font-display text-sm font-semibold">Point at the barcode</p>
        <Button size="icon" variant="gold" onClick={onClose} aria-label="Close camera">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div id={containerId} className="mx-auto h-full w-full max-w-lg [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        {starting ? (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-4 bottom-8 rounded-xl bg-card p-4 text-sm text-destructive shadow-lg">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
