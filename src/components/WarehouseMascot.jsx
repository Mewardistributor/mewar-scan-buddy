import React, { useEffect, useRef, useState, useCallback } from "react";

/**
 * WarehouseMascot
 * --------------------------------------------------------------
 * Mount once near the root of your app.
 *
 * VAN MODE (lots of free space):
 *  - Top-down car sprite that ROTATES to face its direction of travel
 *    (real steering-style movement, not a left/right flip).
 *  - Stays strictly inside free space -- never overlaps anything marked
 *    data-mascot-avoid.
 *  - Small exhaust-smoke puffs trail behind it.
 *
 * DELIVERY GUY MODE (little free space left):
 *  - Auto-triggered once free space drops below the threshold.
 *  - Rendered as an elevated/"3D" character (drop shadow + floor ellipse)
 *    that is allowed to roam the FULL page, including walking over
 *    buttons/cards -- it's meant to read as sitting above the UI layer,
 *    so no avoidance needed for it.
 *  - Still throws parcels periodically.
 *
 * Mark anything the VAN must never cover:
 *   <button data-mascot-avoid>Buy now</button>
 *   <div className="card" data-mascot-avoid>...</div>
 * --------------------------------------------------------------
 */

const CAR_SIZE = 30; // top-down car footprint (square-ish)
const GUY_W = 26;
const GUY_H = 38;

const GRID_CELL = 24;
const VAN_THRESHOLD = 0.42; // free-ratio above this => van mode
const RECALC_DEBOUNCE = 250;
const TICK_MS = 45;

export default function WarehouseMascot() {
  const [pos, setPos] = useState({ x: 60, y: 60 });
  const [angle, setAngle] = useState(0); // car heading, degrees
  const [mode, setMode] = useState("van");
  const [throwing, setThrowing] = useState(false);
  const [intro, setIntro] = useState(true);
  const [warehouseOpacity, setWarehouseOpacity] = useState(1);
  const [charVisible, setCharVisible] = useState(false);
  const [smokePuffs, setSmokePuffs] = useState([]);

  const freeGridRef = useRef([]); // cells avoiding data-mascot-avoid (van uses this)
  const fullGridRef = useRef([]); // every cell on the viewport (delivery guy uses this)
  const targetRef = useRef(null);
  const modeRef = useRef("van");
  const warehouseAnchor = useRef({ x: 70, y: 90 });
  const puffIdRef = useRef(0);

  // ---- Space scan: builds BOTH grids each pass ---------------------------
  const recalcSpace = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const avoidEls = document.querySelectorAll("[data-mascot-avoid]");
    const rects = [];
    avoidEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      rects.push({
        left: r.left - 14,
        right: r.right + 14,
        top: r.top - 14,
        bottom: r.bottom + 14,
      });
    });

    const cols = Math.floor(vw / GRID_CELL);
    const rows = Math.floor(vh / GRID_CELL);
    const free = [];
    const full = [];

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const px = cx * GRID_CELL + GRID_CELL / 2;
        const py = cy * GRID_CELL + GRID_CELL / 2;

        if (px < 30 || py < 30 || px > vw - 30 || py > vh - 30) continue;

        full.push({ x: px, y: py });

        let blocked = false;
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (px > r.left && px < r.right && py > r.top && py < r.bottom) {
            blocked = true;
            break;
          }
        }
        if (!blocked) free.push({ x: px, y: py });
      }
    }

    freeGridRef.current = free;
    fullGridRef.current = full;

    const freeRatio = free.length / (cols * rows || 1);
    const nextMode = freeRatio > VAN_THRESHOLD ? "van" : "delivery";
    if (nextMode !== modeRef.current) targetRef.current = null; // force a fresh target on mode switch
    modeRef.current = nextMode;
    setMode(nextMode);

    if (targetRef.current) {
      const grid = nextMode === "van" ? free : full;
      const stillOk = grid.some(
        (c) =>
          Math.abs(c.x - targetRef.current.x) < GRID_CELL * 2 &&
          Math.abs(c.y - targetRef.current.y) < GRID_CELL * 2
      );
      if (!stillOk) targetRef.current = null;
    }
  }, []);

  useEffect(() => {
    recalcSpace();
    let debounceId;
    const scheduleRecalc = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(recalcSpace, RECALC_DEBOUNCE);
    };
    const mo = new MutationObserver(scheduleRecalc);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener("resize", scheduleRecalc);
    window.addEventListener("scroll", scheduleRecalc, { passive: true });
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", scheduleRecalc);
      window.removeEventListener("scroll", scheduleRecalc);
      clearTimeout(debounceId);
    };
  }, [recalcSpace]);

  // Recalc immediately on client-side route changes (pushState/popstate),
  // so switching pages triggers an instant re-check instead of waiting on
  // the debounce/mutation observer alone.
  useEffect(() => {
    const handleNav = () => recalcSpace();
    window.addEventListener("popstate", handleNav);
    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      handleNav();
    };
    return () => {
      window.removeEventListener("popstate", handleNav);
      history.pushState = origPush;
    };
  }, [recalcSpace]);

  // ---- Intro: warehouse spawns, van drives out ---------------------------
  useEffect(() => {
    const anchor = { x: 70, y: window.innerHeight - 90 };
    warehouseAnchor.current = anchor;
    setPos(anchor);

    const t1 = setTimeout(() => setCharVisible(true), 700);
    const t2 = setTimeout(() => setWarehouseOpacity(0), 1500);
    const t3 = setTimeout(() => setIntro(false), 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // ---- Movement loop -------------------------------------------------------
  useEffect(() => {
    if (intro) return;

    const pickTarget = () => {
      const grid = modeRef.current === "van" ? freeGridRef.current : fullGridRef.current;
      if (!grid.length) return null;
      return grid[Math.floor(Math.random() * grid.length)];
    };

    const interval = setInterval(() => {
      if (!targetRef.current) {
        targetRef.current = pickTarget();
        return;
      }
      setPos((prev) => {
        const t = targetRef.current;
        if (!t) return prev;
        const dx = t.x - prev.x;
        const dy = t.y - prev.y;
        const dist = Math.hypot(dx, dy);
        const speed = modeRef.current === "van" ? 3.4 : 1.3;

        if (dist < speed * 2) {
          if (Math.random() < 0.32) {
            setThrowing(true);
            setTimeout(() => setThrowing(false), 650);
          }
          targetRef.current = null;
          return prev;
        }

        // heading angle -- car/guy rotates to actually face travel direction
        const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
        setAngle(heading);

        // trail exhaust smoke behind the car (opposite of heading)
        if (modeRef.current === "van" && Math.random() < 0.5) {
          const rad = (heading * Math.PI) / 180;
          const backX = prev.x - Math.cos(rad) * 16;
          const backY = prev.y - Math.sin(rad) * 16;
          const id = puffIdRef.current++;
          setSmokePuffs((puffs) => [...puffs, { id, x: backX, y: backY }]);
          setTimeout(() => {
            setSmokePuffs((puffs) => puffs.filter((p) => p.id !== id));
          }, 900);
        }

        const nx = prev.x + (dx / dist) * speed;
        const ny = prev.y + (dy / dist) * speed;
        return { x: nx, y: ny };
      });
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [intro]);

  const anchor = warehouseAnchor.current;

  return (
    <div
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 40 }}
    >
      {/* Warehouse intro */}
      {(intro || warehouseOpacity > 0) && (
        <div
          style={{
            position: "absolute",
            left: anchor.x - 55,
            top: anchor.y - 60,
            width: 110,
            height: 100,
            opacity: warehouseOpacity,
            transform: intro ? "scale(1)" : "scale(0.9)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <WarehouseIcon />
        </div>
      )}

      {/* Exhaust smoke trail (van mode only) */}
      {smokePuffs.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: p.x - 5,
            top: p.y - 5,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "rgba(160,168,178,0.55)",
            filter: "blur(1px)",
            animation: "smokeFade 0.9s ease-out forwards",
          }}
        />
      ))}

      {/* Character */}
      <div
        style={{
          position: "absolute",
          left: pos.x - (mode === "van" ? CAR_SIZE : GUY_W) / 2,
          top: pos.y - (mode === "van" ? CAR_SIZE : GUY_H) / 2,
          width: mode === "van" ? CAR_SIZE : GUY_W,
          height: mode === "van" ? CAR_SIZE : GUY_H,
          opacity: charVisible ? 1 : 0,
          transform: mode === "van" ? `rotate(${angle + 90}deg)` : "none",
          transition: "opacity 0.5s ease, transform 0.15s linear",
          willChange: "left, top, transform",
          // delivery guy renders visibly "above" the UI (bigger shadow = elevated)
          filter:
            mode === "van"
              ? "drop-shadow(0 2px 2px rgba(0,0,0,0.3))"
              : "drop-shadow(0 6px 5px rgba(0,0,0,0.35))",
        }}
      >
        {mode === "van" ? <TopDownCarIcon /> : <DeliveryGuyIcon />}
      </div>

      {/* Thrown parcel */}
      {throwing && <ThrownParcel x={pos.x} y={pos.y} mode={mode} angle={angle} />}

      <style>{`
        @keyframes mascotWalk {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25%      { transform: translateY(-1.5px) rotate(-2deg); }
          75%      { transform: translateY(-1.5px) rotate(2deg); }
        }
        @keyframes smokeFade {
          0%   { transform: scale(0.6); opacity: 0.55; }
          100% { transform: scale(2.1) translateY(-6px); opacity: 0; }
        }
        @keyframes parcelArc {
          0%   { transform: translate(0,0) rotate(0deg); opacity: 1; }
          60%  { transform: translate(var(--dx), var(--dy-mid)) rotate(180deg); opacity: 1; }
          100% { transform: translate(var(--dx2), var(--dy-end)) rotate(320deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/* ---------------- Thrown parcel ---------------- */
function ThrownParcel({ x, y, mode, angle }) {
  const rad = (angle * Math.PI) / 180;
  const dirX = mode === "van" ? Math.cos(rad) : 1;
  const dx = dirX * (mode === "van" ? 40 : 28);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - (mode === "van" ? 4 : 12),
        width: 10,
        height: 10,
        "--dx": `${dx * 0.6}px`,
        "--dy-mid": "-20px",
        "--dx2": `${dx}px`,
        "--dy-end": "16px",
        animation: "parcelArc 0.65s ease-out forwards",
      }}
    >
      <svg viewBox="0 0 10 10" width="100%" height="100%">
        <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="#c98a4b" stroke="#8a5a28" strokeWidth="0.6" />
        <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="#8a5a28" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

/* ---------------- Warehouse ---------------- */
function WarehouseIcon() {
  return (
    <svg viewBox="0 0 120 108" width="100%" height="100%">
      <ellipse cx="60" cy="100" rx="46" ry="6" fill="#000" opacity="0.08" />
      <rect x="14" y="46" width="92" height="50" rx="3" fill="#eef2f6" stroke="#c7d0da" strokeWidth="1.5" />
      <polygon points="60,8 112,46 8,46" fill="#4f8fd6" stroke="#3b6fae" strokeWidth="1.5" />
      <polygon points="60,8 112,46 104,46 60,16 16,46 8,46" fill="#6ba3e0" />
      {[34, 60, 86].map((cx, i) => (
        <g key={i}>
          <rect x={cx - 4} y="4" width="8" height="12" rx="1.5" fill="#3b6fae" />
          <rect x={cx - 4} y="0" width="8" height="4" rx="1" fill="#2c5488" />
        </g>
      ))}
      <rect x="22" y="56" width="14" height="14" rx="2" fill="#bfe0f5" stroke="#3b6fae" strokeWidth="1.2" />
      <rect x="42" y="56" width="14" height="14" rx="2" fill="#bfe0f5" stroke="#3b6fae" strokeWidth="1.2" />
      <rect x="60" y="52" width="42" height="44" rx="2" fill="#5f9bd8" />
      <rect x="64" y="56" width="34" height="36" rx="1" fill="#1e2733" />
      <rect x="68" y="74" width="12" height="14" rx="1" fill="#c98a4b" stroke="#8a5a28" strokeWidth="0.8" />
      <rect x="81" y="70" width="14" height="18" rx="1" fill="#d69a5c" stroke="#8a5a28" strokeWidth="0.8" />
      <rect x="70" y="63" width="11" height="11" rx="1" fill="#c98a4b" stroke="#8a5a28" strokeWidth="0.8" />
      {[58, 62, 66, 70, 74].map((y, i) => (
        <line key={i} x1="64" y1={y} x2="98" y2={y} stroke="#3b4a5a" strokeWidth="0.6" opacity="0.35" />
      ))}
    </svg>
  );
}

/* ---------------- Top-down car (rotates to face travel direction) ----------------
   Drawn nose-up (pointing toward -Y / 12 o'clock) so rotate(heading + 90deg)
   correctly aligns the nose with the direction of travel.
------------------------------------------------------------------------------- */
function TopDownCarIcon() {
  return (
    <svg viewBox="0 0 40 64" width="100%" height="100%">
      {/* shadow */}
      <ellipse cx="20" cy="58" rx="14" ry="4" fill="#000" opacity="0.15" />
      {/* body */}
      <rect x="6" y="10" width="28" height="46" rx="9" fill="#2f6fed" stroke="#1c4bb8" strokeWidth="1.5" />
      {/* windshield */}
      <rect x="10" y="16" width="20" height="12" rx="4" fill="#bfe0f5" stroke="#1c4bb8" strokeWidth="1" />
      {/* rear window */}
      <rect x="11" y="42" width="18" height="9" rx="3" fill="#bfe0f5" stroke="#1c4bb8" strokeWidth="1" />
      {/* roof/cargo strip */}
      <rect x="12" y="29" width="16" height="12" rx="2" fill="#5c8ffc" />
      {/* headlights */}
      <rect x="8" y="10" width="5" height="3" rx="1.5" fill="#ffe89a" />
      <rect x="27" y="10" width="5" height="3" rx="1.5" fill="#ffe89a" />
      {/* taillights */}
      <rect x="8" y="53" width="5" height="3" rx="1.5" fill="#e05656" />
      <rect x="27" y="53" width="5" height="3" rx="1.5" fill="#e05656" />
      {/* side mirrors */}
      <rect x="2" y="18" width="4" height="3" rx="1" fill="#1c4bb8" />
      <rect x="34" y="18" width="4" height="3" rx="1" fill="#1c4bb8" />
    </svg>
  );
}

/* ---------------- Delivery guy (elevated/"3D" -- can roam over buttons) ---------------- */
function DeliveryGuyIcon() {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* floor ellipse to sell the "floating above the page" 3D read */}
      <div
        style={{
          position: "absolute",
          left: "10%",
          bottom: -6,
          width: "80%",
          height: 6,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.22)",
          filter: "blur(1px)",
        }}
      />
      <svg
        viewBox="0 0 60 84"
        width="100%"
        height="100%"
        style={{ animation: "mascotWalk 0.55s ease-in-out infinite", transformOrigin: "center bottom" }}
      >
        <rect x="20" y="58" width="8" height="20" rx="3" fill="#26466b" />
        <rect x="32" y="58" width="8" height="20" rx="3" fill="#1c3454" />
        <rect x="18" y="76" width="12" height="5" rx="2" fill="#20242b" />
        <rect x="30" y="76" width="12" height="5" rx="2" fill="#20242b" />
        <rect x="16" y="34" width="28" height="28" rx="6" fill="#2f6fed" />
        <rect x="10" y="30" width="24" height="22" rx="2" fill="#c98a4b" stroke="#8a5a28" strokeWidth="1.2" />
        <line x1="10" y1="41" x2="34" y2="41" stroke="#8a5a28" strokeWidth="1" />
        <rect x="8" y="36" width="8" height="10" rx="3" fill="#2f6fed" />
        <rect x="34" y="36" width="8" height="10" rx="3" fill="#1c4bb8" />
        <circle cx="30" cy="20" r="10" fill="#f2c39a" />
        <path d="M18 18 a12 10 0 0 1 24 0 h-2 a10 8 0 0 0 -20 0 z" fill="#1c4bb8" />
        <rect x="17" y="16" width="26" height="5" rx="2.5" fill="#2f6fed" />
        <rect x="34" y="16" width="10" height="4" rx="2" fill="#1c4bb8" />
      </svg>
    </div>
  );
}
