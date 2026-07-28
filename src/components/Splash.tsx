import { useEffect, useState } from "react";

export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1500);
    const t2 = setTimeout(onDone, 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);
  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center bg-[image:var(--gradient-brand)] transition-opacity duration-500 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center text-primary-foreground">
        <span className="grid h-20 w-20 animate-pop place-items-center overflow-hidden rounded-3xl bg-primary-foreground shadow-[var(--shadow-gold)]">
          <img src="/logo.jpg" alt="MDC Logo" className="h-full w-full object-cover" />
        </span>
        <div className="animate-fade-up">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Mewar Distribution Centre
          </h1>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] opacity-70">
            Dispatch Verification
          </p>
        </div>
        <span className="mt-4 h-1 w-32 overflow-hidden rounded-full bg-primary-foreground/20">
          <span className="block h-full w-1/2 animate-[fade-in_0.4s_ease-out] rounded-full bg-accent" />
        </span>
      </div>
    </div>
  );
}
