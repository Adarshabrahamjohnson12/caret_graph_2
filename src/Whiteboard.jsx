import { useState, useRef, useEffect } from "react";

const TOOLS = { PEN: "pen" };

function FullGraph({ pressureHistory, isDrawing }) {
  const wrapRef  = useRef(null);
  const graphRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 400 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return;
    const { w: W, h: H } = dims;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    c.clearRect(0, 0, W, H);
    c.fillStyle = "#07090f";
    c.fillRect(0, 0, W, H);

    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].forEach(v => {
      const y = H - v * H;
      c.beginPath();
      c.strokeStyle = v === 0.5 || v === 1.0 ? "#1a2240" : "#0e1220";
      c.lineWidth   = v === 0.5 || v === 1.0 ? 1.2 : 0.6;
      c.setLineDash(v === 0.5 || v === 1.0 ? [4, 6] : [2, 8]);
      c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      c.setLineDash([]);
    });

    const vCount = Math.floor(W / 80);
    for (let i = 1; i < vCount; i++) {
      const x = (i / vCount) * W;
      c.beginPath();
      c.strokeStyle = "#0c1018";
      c.lineWidth = 0.6;
      c.setLineDash([2, 8]);
      c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      c.setLineDash([]);
    }

    const labelSize = W < 400 ? 9 : 11;
    [0, 25, 50, 75, 100].forEach(v => {
      const y = H - (v / 100) * H;
      c.fillStyle = v === 50 ? "#1e2a44" : "#131825";
      c.font = `bold ${v === 50 ? labelSize + 2 : labelSize}px sans-serif`;
      c.fillText(`${v}%`, 6, y - 4);
    });

    if (pressureHistory.length < 2) {
      c.beginPath();
      c.strokeStyle = "#131825";
      c.lineWidth = 1.5;
      c.setLineDash([4, 8]);
      c.moveTo(0, H - 4); c.lineTo(W, H - 4); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "#1a2030";
      c.font = `bold ${W < 400 ? 12 : 15}px sans-serif`;
      c.textAlign = "center";
      c.fillText("TOUCH ANYWHERE…", W / 2, H / 2);
      c.textAlign = "left";
      return;
    }

    const pts  = pressureHistory.slice(-Math.floor(W * 1.5));
    const step = W / Math.max(pts.length - 1, 1);

    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,    "rgba(247,37,133,0.62)");
    grad.addColorStop(0.3,  "rgba(124,106,245,0.42)");
    grad.addColorStop(0.65, "rgba(79,142,247,0.22)");
    grad.addColorStop(1,    "rgba(79,142,247,0.03)");

    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step, y = H - p * H;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.lineTo((pts.length - 1) * step, H);
    c.lineTo(0, H);
    c.closePath();
    c.fillStyle = grad;
    c.fill();

    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step, y = H - p * H;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    const lg = c.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0,   "#4f8ef7");
    lg.addColorStop(0.5, "#7c6af5");
    lg.addColorStop(1,   "#f72585");
    c.strokeStyle = lg;
    c.lineWidth   = W < 400 ? 2 : 2.8;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();

    const last = pts[pts.length - 1];
    const dotX = (pts.length - 1) * step;
    const dotY = H - last * H;
    const gSize = isDrawing ? (W < 400 ? 18 : 26) : (W < 400 ? 10 : 14);
    const gg = c.createRadialGradient(dotX, dotY, 0, dotX, dotY, gSize);
    gg.addColorStop(0, isDrawing ? "rgba(247,37,133,0.9)" : "rgba(79,142,247,0.65)");
    gg.addColorStop(1, "rgba(0,0,0,0)");
    c.beginPath(); c.arc(dotX, dotY, gSize, 0, Math.PI * 2);
    c.fillStyle = gg; c.fill();

    c.beginPath(); c.arc(dotX, dotY, W < 400 ? 3.5 : 5, 0, Math.PI * 2);
    c.fillStyle = isDrawing ? "#f72585" : "#4f8ef7";
    c.shadowColor = isDrawing ? "#f72585" : "#4f8ef7";
    c.shadowBlur  = 14;
    c.fill();
    c.shadowBlur = 0;

    c.beginPath();
    c.strokeStyle = isDrawing ? "rgba(247,37,133,0.12)" : "rgba(79,142,247,0.08)";
    c.lineWidth = 1;
    c.moveTo(dotX, 0); c.lineTo(dotX, H); c.stroke();

  }, [pressureHistory, isDrawing, dims]);

  return (
    <div ref={wrapRef} style={{
      flex: 1, position: "relative", minHeight: 0,
      borderRadius: 14, overflow: "hidden",
      border: "1px solid #141a28",
      boxShadow: "0 0 0 1px rgba(79,142,247,.04), inset 0 0 100px rgba(0,0,0,.5)",
    }}>
      <canvas ref={graphRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

export default function PressureOnly() {
  const hiddenCanvasRef = useRef(null);
  const [tool]          = useState(TOOLS.PEN);
  const [isPainting, setIsPainting]           = useState(false);
  const [pressureHistory, setPressureHistory] = useState([]);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 800);

  const drawing    = useRef(false);
  const lastPres   = useRef(0.5);
  const decayTimer = useRef(null);

  // Track viewport width for responsive scaling
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isMobile = vw < 600;
  const isSmall  = vw < 400;

  useEffect(() => {
    const canvas = hiddenCanvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 900 * dpr; canvas.height = 600 * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 900, 600);
  }, []);

  useEffect(() => {
    const block = (e) => e.preventDefault();
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);

  const getPressure = (e) => {
    const p = typeof e.pressure !== "undefined" ? e.pressure : 0.5;
    return Math.max(0.02, Math.min(1, p));
  };

  const pushPressure = (p) => {
    setPressureHistory(h => {
      const next = [...h, p];
      return next.length > 1500 ? next.slice(-1500) : next;
    });
  };

  const startDecay = () => {
    if (decayTimer.current) clearInterval(decayTimer.current);
    decayTimer.current = setInterval(() => {
      setPressureHistory(h => {
        if (!h.length) { clearInterval(decayTimer.current); return h; }
        const last = h[h.length - 1];
        if (last <= 0.02) { clearInterval(decayTimer.current); return [...h, 0]; }
        return [...h, Math.max(0, last * 0.82)];
      });
    }, 30);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    if (decayTimer.current) clearInterval(decayTimer.current);
    const pres = getPressure(e);
    drawing.current = true; lastPres.current = pres;
    setIsPainting(true);
    pushPressure(pres);
  };

  const onPointerMove = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const pres = getPressure(e);
    pushPressure((lastPres.current + pres) / 2);
    lastPres.current = pres;
  };

  const onPointerUp = () => {
    drawing.current = false;
    setIsPainting(false);
    startDecay();
  };

  const cur = pressureHistory[pressureHistory.length - 1] ?? 0;
  const pct = cur * 100;

  let karatLabel = null, karatColor = null, karatGlow = null;
  if (pct >= 45) {
    karatLabel = "SPURIOUS"; karatColor = "#f72585"; karatGlow = "rgba(247,37,133,0.35)";
  } else if (pct >= 30) {
    karatLabel = "18ct"; karatColor = "#f9c74f"; karatGlow = "rgba(249,199,79,0.35)";
  } else if (pct >= 25) {
    karatLabel = "22ct"; karatColor = "#f4a261"; karatGlow = "rgba(244,162,97,0.35)";
  }

  // Responsive scale values
  const pad        = isSmall ? "14px 14px 12px" : isMobile ? "16px 18px 14px" : "24px 32px 18px";
  const gap        = isSmall ? 8 : isMobile ? 10 : 14;
  const dotSz      = isSmall ? 8 : isMobile ? 10 : 12;
  const statusFs   = isSmall ? 9 : isMobile ? 10 : 13;
  const monitorFs  = isSmall ? 9 : isMobile ? 10 : 13;
  const pctFs      = isSmall ? 52 : isMobile ? 64 : 88;
  const unitFs     = isSmall ? 20 : isMobile ? 24 : 32;
  const karatFs    = isSmall ? 14 : isMobile ? 17 : 22;
  const karatPad   = isSmall ? "4px 10px" : isMobile ? "5px 13px" : "6px 18px";
  const footerFs   = isSmall ? 8.5 : isMobile ? 9.5 : 11;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        width: "100vw", height: "100vh",
        background: "#07090f",
        display: "flex", flexDirection: "column",
        fontFamily: "'Sora',sans-serif",
        padding: pad,
        gap,
        cursor: isPainting ? "crosshair" : "default",
        userSelect: "none",
        WebkitUserSelect: "none",
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        html,body{overflow:hidden;overscroll-behavior:none;}
      `}</style>

      <canvas ref={hiddenCanvasRef} style={{ display: "none" }} />

      {/* Ambient glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
        background: isPainting
          ? "radial-gradient(ellipse 80% 55% at 50% 85%, rgba(247,37,133,0.05) 0%, transparent 65%)"
          : "radial-gradient(ellipse 80% 55% at 50% 85%, rgba(79,142,247,0.03) 0%, transparent 65%)",
        transition: "background 0.5s",
      }} />

      {/* ── HEADER ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 1,
        flexWrap: isMobile ? "wrap" : "nowrap",
        gap: isMobile ? 6 : 0,
      }}>
        {/* Left: status */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 12 }}>
          <div style={{
            width: dotSz, height: dotSz, borderRadius: "50%",
            background: isPainting ? "#f72585" : "#1a1f2e",
            boxShadow: isPainting ? `0 0 ${isMobile ? 10 : 16}px #f72585, 0 0 ${isMobile ? 24 : 40}px rgba(247,37,133,0.35)` : "none",
            flexShrink: 0,
            transition: "all .25s",
          }} />
          <span style={{
            fontSize: statusFs, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase",
            color: isPainting ? "#f72585" : "#252b3d", transition: "color .25s",
          }}>
            {isPainting ? "LIVE" : "IDLE"}
          </span>
          {!isSmall && (
            <span style={{ fontSize: monitorFs, color: "#1e2438", letterSpacing: ".1em", fontWeight: 500 }}>
              · PRESSURE MONITOR
            </span>
          )}
        </div>

        {/* Right: karat badge + big % */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 20 }}>
          {karatLabel && (
            <div style={{
              fontSize: karatFs, fontWeight: 700, letterSpacing: ".14em",
              color: karatColor, textTransform: "uppercase",
              textShadow: `0 0 14px ${karatGlow}, 0 0 30px ${karatGlow}`,
              border: `1.5px solid ${karatColor}33`,
              borderRadius: 8, padding: karatPad,
              background: `${karatColor}0d`,
              transition: "all .2s",
              whiteSpace: "nowrap",
            }}>
              {karatLabel}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontSize: pctFs, fontWeight: 700, lineHeight: 1,
              background: "linear-gradient(135deg,#4f8ef7 30%,#7c6af5 60%,#f72585 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              {pct.toFixed(0)}
            </span>
            <span style={{ fontSize: unitFs, color: "#1e2438", fontWeight: 700 }}>%</span>
          </div>
        </div>
      </div>

      {/* ── GRAPH ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, zIndex: 1 }}>
        <FullGraph pressureHistory={pressureHistory} isDrawing={isPainting} />
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        justifyContent: isMobile ? "center" : "space-between",
        alignItems: "center",
        flexShrink: 0,
        zIndex: 1,
        gap: isMobile ? 5 : 0,
      }}>
        <span style={{
          fontSize: footerFs, fontWeight: 700, color: "#1a1f2e",
          letterSpacing: ".1em", textTransform: "uppercase",
          textAlign: isMobile ? "center" : "left",
        }}>
          ✦ Touch anywhere · Stylus for full range
        </span>

        {!isMobile && (
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <span style={{ fontSize: footerFs, color: "#1a1f2e" }}>🪶 Light → faint</span>
            <span style={{ fontSize: footerFs, color: "#1e2438" }}>✍️ Medium → natural</span>
            <span style={{ fontSize: footerFs, color: "#232840" }}>🖊️ Hard → bold</span>
            <div style={{
              fontSize: footerFs, fontWeight: 700, color: "#4f8ef7", letterSpacing: ".1em",
              background: "rgba(79,142,247,.08)", borderRadius: 7, padding: "4px 12px",
              border: "1px solid rgba(79,142,247,.18)",
            }}>
              {tool.toUpperCase()}
            </div>
          </div>
        )}

        {isMobile && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <span style={{ fontSize: footerFs, color: "#1a1f2e" }}>🪶 Light</span>
            <span style={{ fontSize: footerFs, color: "#1e2438" }}>✍️ Medium</span>
            <span style={{ fontSize: footerFs, color: "#232840" }}>🖊️ Hard</span>
            <div style={{
              fontSize: footerFs, fontWeight: 700, color: "#4f8ef7", letterSpacing: ".1em",
              background: "rgba(79,142,247,.08)", borderRadius: 6, padding: "3px 9px",
              border: "1px solid rgba(79,142,247,.18)",
            }}>
              {tool.toUpperCase()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}