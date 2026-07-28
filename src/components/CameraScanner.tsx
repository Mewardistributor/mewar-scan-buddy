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
  "Since 2019",
  "Partnership",
  "Patanjali",
  "HUL",
  "Mamaearth",
  "Glow & Lovely",
  "Pears",
  "Pond's",
  "TRESemmé",
  "Closeup",
  "Lifebuoy",
  "Vaseline",
  "Horlicks",
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

    // Picks the rear camera least likely to be an ultra-zoomed telephoto lens.
    // Many phones expose 2-3 back cameras (wide / main / telephoto) and some
    // browsers default to whichever the OS reports first, which is sometimes
    // the telephoto -- causing the "too zoomed in" look. We prefer a camera
    // whose label suggests "wide"/"main"/"back camera" over one that says
    // "tele"/"zoom".
    async function pickBackCameraId(Html5Qrcode: any): Promise<string | null> {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || !cameras.length) return null;

        const back = cameras.filter((c: any) => /back|rear|environment/i.test(c.label));
        const pool = back.length ? back : cameras;

        const preferred = pool.find((c: any) => /wide|main/i.test(c.label) && !/tele/i.test(c.label));
        const avoidTele = pool.find((c: any) => !/tele|zoom/i.test(c.label));

        return (preferred || avoidTele || pool[0]).id;
      } catch {
        return null;
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

        const backCameraId = await pickBackCameraId(Html5Qrcode);

        // Request a wider field of view / force zoom to 1x where the browser
        // supports it. Falls back to plain facingMode if the camera/browser
        // rejects the advanced constraint (Safari/iOS ignores `advanced`).
        const cameraTarget: any = backCameraId
          ? backCameraId
          : { facingMode: { ideal: "environment" } };

        const videoConfig = {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          aspectRatio: 1.777,
          videoConstraints: {
            ...(typeof cameraTarget === "string"
              ? { deviceId: { exact: cameraTarget } }
              : cameraTarget),
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ zoom: 1 }],
          },
        };

        try {
          await scanner.start(
            cameraTarget,
            videoConfig,
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
        } catch {
          // Retry with the simplest possible config if the advanced
          // constraints above weren't supported by this browser/device.
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 280, height: 150 } },
            (decodedText: string) => {
              if (firedRef.current) return;
              firedRef.current = true;
              const code = decodedText.trim();
              safeStop().finally(() => {
                onDetected(code);
              });
            },
            () => {}
          );
        }

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
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-black"
      style={{ height: "100dvh", width: "100vw" }}
    >
      {/* Full-bleed camera feed -- object-fit: cover so there's never a
          letterboxed black strip at the bottom */}
      <div
        id={containerId}
        className="absolute inset-0 h-full w-full overflow-hidden [&_video]:!absolute [&_video]:!inset-0 [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover"
      />

      {/* Floating words -- rise from below the scan frame and smoothly fade
          out as they cross into the frame's vertical band, so the frame
          itself always stays visually clear. The fade is done with a mask
          on the whole layer (not clip-path) so it's a soft transition
          rather than a hard cut. */}
      {!starting && !error ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, transparent 58%, black 70%, black 100%)",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, transparent 58%, black 70%, black 100%)",
          }}
        >
          {FLOATING_WORDS.map((word, i) => (
            <span
              key={word + i}
              className="absolute select-none whitespace-nowrap font-display font-semibold"
              style={{
                left: `${(i * 23 + 5) % 78}%`,
                bottom: `${-10 - (i % 6) * 8}%`,
                fontSize: `${12 + (i % 4) * 4}px`,
                color: "rgba(230, 180, 70, 0.75)",
                textShadow: "0 1px 3px rgba(0,0,0,0.5)",
                animation: `mdc-float-up ${11 + (i % 5) * 2}s linear infinite`,
                animationDelay: `${i * 1.1}s`,
              }}
            >
              {word}
            </span>
          ))}
        </div>
      ) : null}

      <style>{`
        @keyframes mdc-float-up {
          0% { transform: translateY(0); opacity: 0; }
          8% { opacity: 1; }
          100% { transform: translateY(-115vh); opacity: 1; }
        }
      `}</style>

      {/* Dark vignette OUTSIDE the scan frame only, so the frame itself stays perfectly clear */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: "rgba(0,0,0,0.35)",
          clipPath:
            "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 66%, 8% 34%, 92% 34%, 92% 66%, 8% 66%, 8% 34%, 0 34%)",
        }}
      />

      {/* Scan frame corners -- drawn above everything, frame interior has no overlay */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2"
        style={{ width: "84%", maxWidth: "420px", height: "32%" }}
      >
        <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-primary" />
        <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-primary" />
        <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-primary" />
        <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-primary" />
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary/70 shadow-[0_0_12px_2px_rgba(13,92,83,0.8)] animate-pulse" />
      </div>

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

      {/* Bottom hint */}
      {!starting && !error ? (
        <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center px-6">
          <div className="rounded-full bg-black/50 px-4 py-2 text-center backdrop-blur-md">
            <p className="text-xs font-medium text-white/90">Hold barcode inside the frame</p>
          </div>
        </div>
      ) : null}

      {starting ? (
        <div className="absolute inset-0 z-[5] grid place-items-center bg-black/60 text-white">
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
