import { useState, useRef, useEffect } from "react";
const TOOLS = { PEN:"pen", BRUSH:"brush", MARKER:"marker", ERASER:"eraser", LINE:"line", RECT:"rect", CIRCLE:"circle", TEXT:"text", HAND:"hand" };

const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return {r,g,b};
};

/* ─── GOLD CLASSIFICATION THRESHOLDS ────────────────────────── */
const THRESHOLDS = {
  CT22:     { min: 25, max: 30 },
  CT18:     { min: 33, max: 38 },
  SPURIOUS: { min: 39 },
};

const STABILITY_FRAMES = 1;
const ROLLING_WINDOW   = 1;

const classifyPressure = (p) => {
  if (p >= THRESHOLDS.CT22.min  && p <= THRESHOLDS.CT22.max)  return "22ct";
  if (p >= THRESHOLDS.CT18.min  && p <= THRESHOLDS.CT18.max)  return "18ct";
  if (p >= THRESHOLDS.SPURIOUS.min)                           return "Spurious";
  return null;
};
function PressureGraph({ pressureHistory, isDrawing, fullWidth }) {
  const graphRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 220, h: 100 });

  useEffect(() => {
    if (!fullWidth || !containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fullWidth]);

  const W = fullWidth ? dims.w : 220;
  const H = fullWidth ? dims.h : 100;

  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = W;
    const ch = H;

    c.clearRect(0, 0, cw, ch);
    c.fillStyle = "#0a0c14";
    c.fillRect(0, 0, cw, ch);

    [0.25, 0.5, 0.75, 1.0].forEach(v => {
      const y = ch - v * ch;
      c.beginPath();
      c.strokeStyle = v === 1.0 ? "#1e2a4a" : "#161c2a";
      c.lineWidth = 1;
      c.setLineDash([2, 4]);
      c.moveTo(0, y); c.lineTo(cw, y); c.stroke();
      c.setLineDash([]);
    });

    [25, 50, 75, 100].forEach(v => {
      const y = ch - (v / 100) * ch;
      c.fillStyle = "#2a3050";
      c.font = "bold 7px sans-serif";
      c.fillText(`${v}`, 3, y - 2);
    });

    if (pressureHistory.length < 2) {
      c.beginPath();
      c.strokeStyle = "#1e2a3a";
      c.lineWidth = 1;
      c.setLineDash([3, 5]);
      c.moveTo(0, ch - 2); c.lineTo(cw, ch - 2); c.stroke();
      c.setLineDash([]);
      return;
    }

    const pts = pressureHistory.slice(-cw);
    const step = cw / Math.max(pts.length - 1, 1);

    const grad = c.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0,   "rgba(247,37,133,0.55)");
    grad.addColorStop(0.4, "rgba(79,142,247,0.35)");
    grad.addColorStop(1,   "rgba(79,142,247,0.04)");

    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step;
      const y = ch - p * ch;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.lineTo((pts.length - 1) * step, ch);
    c.lineTo(0, ch);
    c.closePath();
    c.fillStyle = grad;
    c.fill();

    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step;
      const y = ch - p * ch;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    const lineGrad = c.createLinearGradient(0, 0, cw, 0);
    lineGrad.addColorStop(0, "#4f8ef7");
    lineGrad.addColorStop(1, "#f72585");
    c.strokeStyle = lineGrad;
    c.lineWidth = 1.5;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();

    const last = pts[pts.length - 1];
    const dotX = (pts.length - 1) * step;
    const dotY = ch - last * ch;
    const glowGrad = c.createRadialGradient(dotX, dotY, 0, dotX, dotY, 6);
    glowGrad.addColorStop(0, isDrawing ? "rgba(247,37,133,0.9)" : "rgba(79,142,247,0.6)");
    glowGrad.addColorStop(1, "rgba(0,0,0,0)");
    c.beginPath();
    c.arc(dotX, dotY, 6, 0, Math.PI * 2);
    c.fillStyle = glowGrad;
    c.fill();
    c.beginPath();
    c.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    c.fillStyle = isDrawing ? "#f72585" : "#4f8ef7";
    c.fill();
  }, [pressureHistory, isDrawing]);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  return (
    <div
      ref={containerRef}
      style={{
        position:"relative", border:"1px solid #161c2a", borderRadius:8, overflow:"hidden",
        boxShadow:"0 4px 20px rgba(0,0,0,.5), inset 0 0 0 1px rgba(79,142,247,.06)",
        width: fullWidth ? "100%" : W,
        height: fullWidth ? "60vh" : H,
        flexShrink: 0,
      }}
    >
      <canvas ref={graphRef} width={W * dpr} height={H * dpr} style={{ width:"100%", height:"100%", display:"block" }}/>
      <div style={{ position:"absolute", top:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>100</div>
      <div style={{ position:"absolute", bottom:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>0</div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────── */
export default function Whiteboard() {
  const canvasRef = useRef(null);

  // ── all original state kept exactly ──
  const [tool]          = useState(TOOLS.PEN);
  const [color]         = useState("#0d0d0d");
  const [strokeSize]    = useState(5);
  const [eraserSize]    = useState(20);
  const [pressureHistory, setPressureHistory] = useState([]);
  const [isPainting, setIsPainting]           = useState(false);

  const drawing   = useRef(false);
  const lastPt    = useRef(null);
  const lastPres  = useRef(0.5);
  const snapshotR = useRef(null);
  const startPtR  = useRef(null);
  const decayTimer = useRef(null);

  // ── Classification stability tracking ──
  const consecutiveCount = useRef(0);
  const lastRawLabel     = useRef(null);
  const [stableLabel, setStableLabel]       = useState(null);
  const [confidence, setConfidence]         = useState(0);
  const [contactType, setContactType]       = useState(null); // "no_contact" | "reading"

  /* ── Canvas setup ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth / 2;
    const h = window.innerHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, w, h);
  }, []);

  const ctx = () => canvasRef.current?.getContext("2d");

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? 0);
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (cx - rect.left) * (canvas.width  / rect.width  / dpr),
      y: (cy - rect.top)  * (canvas.height / rect.height / dpr),
    };
  };

  const getPressure = (e) => {
    const p = typeof e.pressure !== "undefined" ? e.pressure : 0.5;
    return Math.max(0.02, Math.min(1, p));
  };

  const pushPressure = (p) => {
    setPressureHistory(h => {
      const next = [...h, p];
      const trimmed = next.length > 200 ? next.slice(-200) : next;

      // ── Rolling average over last ROLLING_WINDOW samples ──
      const window = trimmed.slice(-ROLLING_WINDOW);
      const avg = (window.reduce((a, b) => a + b, 0) / window.length) * 100;

      // ── Classify averaged pressure ──
      const rawLabel = classifyPressure(avg) ?? "__no_contact__";

      // ── Stability: only lock label after STABILITY_FRAMES same consecutive readings ──
      if (rawLabel === lastRawLabel.current) {
        consecutiveCount.current = Math.min(consecutiveCount.current + 1, STABILITY_FRAMES);
      } else {
        consecutiveCount.current = 0;
        lastRawLabel.current = rawLabel;
      }

      const conf = Math.round((consecutiveCount.current / STABILITY_FRAMES) * 100);
      setConfidence(conf);

      if (consecutiveCount.current >= STABILITY_FRAMES) {
        if (rawLabel === "__no_contact__") {
          setStableLabel(null);
          setContactType("no_contact");
        } else {
          setStableLabel(rawLabel);
          setContactType("reading");
        }
      }

      return trimmed;
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

  const applyPressureStyle = (c, pressure) => {
    const {r,g,b} = hexToRgb(color);
    let alpha, width;
    if (tool === TOOLS.ERASER) {
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = "#ffffff";
      c.lineWidth   = eraserSize * (0.6 + pressure * 0.8);
    } else if (tool === TOOLS.BRUSH) {
      alpha = Math.pow(pressure, 0.5);
      width = strokeSize * (0.15 + pressure * 2.0);
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      c.lineWidth   = Math.max(0.5, width);
    } else if (tool === TOOLS.MARKER) {
      alpha = 0.4 + pressure * 0.5;
      width = strokeSize * (0.8 + pressure * 0.4);
      c.globalCompositeOperation = "multiply";
      c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      c.lineWidth   = Math.max(1, width);
    } else {
      alpha = Math.pow(pressure, 0.65);
      width = strokeSize * (0.25 + pressure * 0.95);
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      c.lineWidth   = Math.max(0.5, width);
    }
    c.lineCap  = "round";
    c.lineJoin = "round";
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse") return;
    // Fullscreen on first touch — Promise-based, no crash
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    if (decayTimer.current) clearInterval(decayTimer.current);
    const pos  = getPos(e);
    const pres = getPressure(e);
    drawing.current  = true;
    lastPt.current   = pos;
    lastPres.current = pres;
    setIsPainting(true);
    pushPressure(pres);
    const c = ctx();
    if (!c) return;
    snapshotR.current = c.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    startPtR.current  = pos;
  };

  const onPointerMove = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const pos  = getPos(e);
    const pres = getPressure(e);
    const c = ctx();
    if (!c) return;
    pushPressure(pres);
    if ([TOOLS.PEN, TOOLS.BRUSH, TOOLS.MARKER, TOOLS.ERASER].includes(tool)) {
      const avgPres = (lastPres.current + pres) / 2;
      applyPressureStyle(c, avgPres);
      const mid = { x:(lastPt.current.x+pos.x)/2, y:(lastPt.current.y+pos.y)/2 };
      c.beginPath();
      c.moveTo(lastPt.current.x, lastPt.current.y);
      c.quadraticCurveTo(lastPt.current.x, lastPt.current.y, mid.x, mid.y);
      c.stroke();
      lastPt.current   = mid;
      lastPres.current = pres;
    } else {
      c.putImageData(snapshotR.current, 0, 0);
      const s = startPtR.current;
      const {r,g,b} = hexToRgb(color);
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = `rgba(${r},${g},${b},0.9)`;
      c.lineWidth   = strokeSize;
      c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath();
      if (tool === TOOLS.LINE) {
        c.moveTo(s.x,s.y); c.lineTo(pos.x,pos.y); c.stroke();
      } else if (tool === TOOLS.RECT) {
        c.rect(s.x,s.y,pos.x-s.x,pos.y-s.y); c.stroke();
      } else if (tool === TOOLS.CIRCLE) {
        const rx=Math.abs(pos.x-s.x)/2, ry=Math.abs(pos.y-s.y)/2;
        c.ellipse((s.x+pos.x)/2,(s.y+pos.y)/2,rx,ry,0,0,Math.PI*2); c.stroke();
      }
    }
  };

  const onPointerUp = () => {
    drawing.current = false;
    setIsPainting(false);
    ctx()?.globalCompositeOperation && (ctx().globalCompositeOperation = "source-over");
    // Reset stability on lift
    consecutiveCount.current = 0;
    lastRawLabel.current = null;
    setStableLabel(null);
    setConfidence(0);
    setContactType(null);
    startDecay();
  };

  /* ─── RENDER ── full screen graph only ──────────────────────── */
  return (
    <div
      style={{ position:"fixed", inset:0, overflow:"hidden", display:"flex", flexDirection:"row", userSelect:"none", WebkitUserSelect:"none" }}
      onContextMenu={e => e.preventDefault()}
    >
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box;}
        html,body{width:100%;height:100%;overflow:hidden;background:#080a12;}
        html{height:-webkit-fill-available;}
        body{min-height:-webkit-fill-available;}
        @media all { :root { --vh: 1vh; } }
      `}</style>

      {/* Hidden canvas — keeps all drawing logic intact */}
      <canvas ref={canvasRef} style={{ display:"none" }} />

      {/* FULL SCREEN — Pressure graph panel, entire screen, pointer events active */}
      <div
        style={{
          width:"100%", height:"100%", flexShrink:0,
          background:"#080a12",
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"space-between",
          padding:"env(safe-area-inset-top, 24px) 20px env(safe-area-inset-bottom, 24px)",
          boxSizing:"border-box", touchAction:"none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >

        {/* ── TOP STATUS BAR ── */}
        <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:8 }}>
          {/* LIVE / IDLE pill */}
          <div style={{
            display:"flex", alignItems:"center", gap:7,
            background:"#0e1120", borderRadius:50,
            padding:"6px 14px", border:"1px solid #1a1f36",
          }}>
            <div style={{
              width:7, height:7, borderRadius:"50%",
              background: isPainting ? "#f72585" : "#1e2430",
              boxShadow: isPainting ? "0 0 8px #f72585" : "none",
              transition:"all .2s",
            }}/>
            <span style={{ fontSize:11, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase",
              color: isPainting ? "#f72585" : "#2a3050", transition:"color .2s" }}>
              {isPainting ? "LIVE" : "IDLE"}
            </span>
          </div>

          {/* Big % reading */}
          <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
            <span style={{
              fontSize:52, fontWeight:800, lineHeight:1,
              background:"linear-gradient(135deg,#4f8ef7,#f72585)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            }}>
              {((pressureHistory[pressureHistory.length - 1] ?? 0) * 100).toFixed(0)}
            </span>
            <span style={{ fontSize:18, color:"#2a3050", fontWeight:700 }}>%</span>
          </div>

          {/* Tool badge */}
          <div style={{
            background:"#0e1120", borderRadius:50,
            padding:"6px 14px", border:"1px solid #1a1f36",
          }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#4f8ef7", letterSpacing:".08em" }}>{tool.toUpperCase()}</span>
          </div>
        </div>

        {/* ── GRAPH — takes up most of screen ── */}
        <div style={{ width:"100%", flex:1, padding:"16px 0" }}>
          <PressureGraph pressureHistory={pressureHistory} isDrawing={isPainting} fullWidth />
        </div>

        {/* ── CARAT LABEL ── */}
        {(() => {
          const LABEL_STYLES = {
            "24ct":     { col:"#a8edea", glow:"0 0 24px rgba(168,237,234,.6)", fs:52 },
            "22ct":     { col:"#f9c74f", glow:"0 0 24px rgba(249,199,79,.6)",  fs:52 },
            "18ct":     { col:"#f4a261", glow:"0 0 24px rgba(244,162,97,.6)",  fs:52 },
            "Spurious": { col:"#e63946", glow:"0 0 28px rgba(230,57,70,.7)",   fs:40 },
          };

          const style = stableLabel ? LABEL_STYLES[stableLabel] : null;

          // Confidence bar color
          const confCol = confidence < 40 ? "#e63946" : confidence < 80 ? "#f9c74f" : "#2dc653";

          return (
            <div style={{ minHeight:100, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", width:"100%", gap:10 }}>

              {/* Main label — instant, no waiting */}
              {stableLabel ? (
                <span style={{ fontSize:style.fs, fontWeight:800, letterSpacing:".04em", color:style.col, textShadow:style.glow, transition:"all .1s" }}>
                  {stableLabel}
                </span>
              ) : (
                <span style={{ fontSize:22, fontWeight:700, color:"#1e2430", letterSpacing:".1em" }}>— —</span>
              )}

            </div>
          );
        })()}

        {/* ── BOTTOM LABEL ── */}
        <div style={{ paddingBottom:8 }}>
          <span style={{ fontSize:10, fontWeight:700, color:"#1e2a3a", letterSpacing:".12em", textTransform:"uppercase" }}>
            ✦ PRESSURE MONITOR
          </span>
        </div>

      </div>
    </div>
  );
}
