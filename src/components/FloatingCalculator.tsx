import { useState } from "react";
import { Calculator, X } from "lucide-react";

export function FloatingCalculator() {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | null>(null);

  function pressKey(key: string) {
    if (key === "C") {
      setExpr("");
      setResult(null);
      return;
    }
    if (key === "⌫") {
      setExpr((e) => e.slice(0, -1));
      return;
    }
    if (key === "=") {
      try {
        if (!/^[0-9+\-*/.()%\s]+$/.test(expr)) throw new Error("invalid");
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${expr})`)();
        setResult(String(value));
      } catch {
        setResult("Error");
      }
      return;
    }
    setResult(null);
    setExpr((e) => e + key);
  }

  const keys = [
    "7", "8", "9", "/",
    "4", "5", "6", "*",
    "1", "2", "3", "-",
    "C", "0", ".", "+",
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
        aria-label="Open calculator"
      >
        {open ? <X className="h-5 w-5" /> : <Calculator className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="fixed bottom-40 right-4 z-40 w-64 rounded-2xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 rounded-lg bg-secondary/60 p-3 text-right">
            <p className="min-h-[1.25rem] truncate text-xs text-muted-foreground">{expr || "0"}</p>
            <p className="min-h-[1.75rem] truncate text-xl font-semibold">
              {result ?? ""}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pressKey(k)}
                className="h-10 rounded-lg bg-secondary text-sm font-medium transition-colors hover:bg-secondary/70 active:scale-95"
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pressKey("⌫")}
              className="h-10 rounded-lg bg-secondary text-sm font-medium transition-colors hover:bg-secondary/70 active:scale-95"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => pressKey("=")}
              className="col-span-3 h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 active:scale-95"
            >
              =
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
