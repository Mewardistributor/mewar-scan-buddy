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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(
    null,
  );

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
        const scanner = new Html5Qrcode(containerId, {
          formatsToSupport: formats,
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
        await scanner.start(
          { facingMode: { ideal: "environment" } },
          {
            fps: 15,
            // Wide, shallow scan window sized from the viewport — matches 1D barcodes
            // and avoids the tight square crop that made the feed look zoomed in.
            qrbox: (vw: number, vh: number) => {
              const width = Math.floor(Math.min(vw * 0.92, 640));
              const height = Math.floor(Math.min(vh * 0.5, Math.max(140, width * 0.45)));
              return { width, height };
            },
            aspectRatio: window.innerHeight > window.innerWidth ? 3 / 4 : 4 / 3,
            videoConstraints: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              advanced: [{ focusMode: "continuous" }],
            } as unknown as MediaTrackConstraints,
            disableFlip: true,
          },
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
        if (cancelled) return;
        setStarting(false);

        const video = document.querySelector<HTMLVideoElement>(`#${containerId} video`);
        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()?.[0] ?? null;
        trackRef.current = track;
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } })
          | undefined;
        if (caps?.zoom) {
          setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
          const current =
            (track?.getSettings?.() as MediaTrackSettings & { zoom?: number })?.zoom ??
            caps.zoom.min;
          setZoom(current);
          // Some Android phones start at a cropped/zoomed level — reset to widest.
          if (current > caps.zoom.min) {
            track
              ?.applyConstraints({
                advanced: [{ zoom: caps.zoom.min }],
              } as unknown as MediaTrackConstraints)
              .then(() => setZoom(caps.zoom!.min))
              .catch(() => undefined);
          }
        }
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
      trackRef.current = null;
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

  function applyZoom(value: number) {
    setZoom(value);
    trackRef.current
      ?.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints)
      .catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="font-display text-sm font-semibold">Point at the barcode</p>
        <Button size="icon" variant="gold" onClick={onClose} aria-label="Close camera">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div
          id={containerId}
          className="mx-auto flex h-full w-full max-w-lg items-center justify-center [&_video]:!h-full [&_video]:!w-full [&_video]:object-contain"
        />
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
      {zoomRange ? (
        <div className="flex items-center gap-3 px-6 py-4 text-white">
          <ZoomIn className="h-4 w-4 shrink-0" />
          <Slider
            aria-label="Camera zoom"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step}
            value={[zoom]}
            onValueChange={(v) => applyZoom(v[0])}
          />
          <span className="w-10 shrink-0 text-right font-mono text-xs">{zoom.toFixed(1)}x</span>
        </div>
      ) : null}
      <p className="pb-4 text-center text-xs text-white/70">
        Hold the barcode inside the wide box, about 15–25 cm away
      </p>
    </div>
  );
}
