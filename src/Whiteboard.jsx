import { useState, useRef, useEffect, useCallback } from "react";

/* ─── GOOGLE SHEETS CONFIG ───────────────────────────────────── */
const SHEET_WEBHOOK = "https://script.google.com/macros/s/AKfycbxroXZynMIrZswXBSsaM7-aNBcDswDEAtwcgLh6sMimy69SoYQbBqcHuRDxmaJ7Pp1TJQ/exec";

async function saveReading({ force, ct, resonance }) {
  const datetime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  try {
    await fetch(SHEET_WEBHOOK, {
      method: "POST",
      mode: "no-cors", // required for Apps Script
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datetime,
        force: parseFloat((force * 100).toFixed(2)),
        ct,
        resonance: parseFloat((resonance * 100).toFixed(2)),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/* ─── SIGNAL ANALYSIS ENGINE ─────────────────────────────────── */
const WINDOW       = 20;
const ONSET_FRAMES = 6;
const AREA_VETO    = 0.018;

function computeSignalFeatures(history, areaHistory, onsetHistory) {
  if (history.length < 3) return null;
  const win = history.slice(-WINDOW);
  const n   = win.length;

  const mean = win.reduce((a, b) => a + b, 0) / n;
  const pct  = mean * 100;

  const variance  = win.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std       = Math.sqrt(variance);
  const cv        = mean > 0.01 ? std / mean : 1;
  const stability = Math.max(0, Math.min(1, 1 - cv * 2.5));

  const deltas     = [];
  for (let i = 1; i < win.length; i++) deltas.push(Math.abs(win[i] - win[i - 1]));
  const avgDelta   = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const smoothness = Math.max(0, Math.min(1, 1 - avgDelta * 18));

  const latestArea = areaHistory.length > 0 ? areaHistory[areaHistory.length - 1] : 0;
  const avgArea    = areaHistory.length > 0
    ? areaHistory.slice(-10).reduce((a,b)=>a+b,0) / Math.min(areaHistory.slice(-10).length, 10)
    : 0;
  const contactVeto = avgArea > AREA_VETO;

  let onsetScore = 0.5;
  if (onsetHistory.length >= ONSET_FRAMES) {
    const onset = onsetHistory.slice(0, ONSET_FRAMES);
    const slope = (onset[onset.length-1] - onset[0]) / ONSET_FRAMES;
    onsetScore  = Math.max(0, Math.min(1, slope * 40 + 0.5));
  }

  let flatness = 0.5;
  if (history.length > 10) {
    const settled = history.slice(-10);
    const hi = Math.max(...settled), lo = Math.min(...settled);
    flatness = Math.max(0, Math.min(1, 1 - (hi - lo) * 50));
  }

  let magnitudeScore = 0;
  let zone = null;
  if (pct >= 22 && pct <= 30) {
    magnitudeScore = Math.exp(-Math.pow(pct - 26, 2) / (2 * 4 * 4));
    zone = "22ct";
  } else if (pct >= 31 && pct <= 35) {
    magnitudeScore = Math.exp(-Math.pow(pct - 33, 2) / (2 * 2 * 2));
    zone = "18ct";
  } else if (pct > 35) {
    zone = "Spurious";
    magnitudeScore = 0;
  }

  let resonance = 0;
  if (zone && zone !== "Spurious") {
    resonance = magnitudeScore * 0.25
              + stability      * 0.20
              + smoothness     * 0.15
              + onsetScore     * 0.20
              + flatness       * 0.20;
  }

  return {
    pct, stability, smoothness, magnitudeScore, resonance,
    label: zone, confidence: resonance, zone, mean,
    contactVeto, latestArea: avgArea, onsetScore, flatness,
  };
}

/* ─── TOAST NOTIFICATION ─────────────────────────────────────── */
function Toast({ message, type }) {
  if (!message) return null;
  const colors = {
    success: { bg: "#0a1a0f", border: "#22c55e44", text: "#22c55e" },
    error:   { bg: "#1a0a0a", border: "#e6394644", text: "#e63946" },
    saving:  { bg: "#0a0f1a", border: "#4f8ef744", text: "#4f8ef7" },
  };
  const c = colors[type] || colors.saving;
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9999,
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 10, padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 8,
      boxShadow: `0 4px 24px rgba(0,0,0,.6)`,
      animation: "fadeIn .2s ease",
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: c.text, boxShadow: `0 0 8px ${c.text}`,
        animation: type === "saving" ? "pulse 1s infinite" : "none",
      }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: c.text, letterSpacing: ".1em" }}>
        {message}
      </span>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}

/* ─── FORCE METER ────────────────────────────────────────────── */
function ForceMeter({ force, isActive }) {
  const canvasRef = useRef(null);
  const SIZE = 110;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = SIZE, H = SIZE;
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 8, R = 38;
    const startAngle = (210 * Math.PI) / 180;
    const endAngle   = (330 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;

    c.beginPath(); c.arc(cx, cy, R, startAngle, endAngle);
    c.strokeStyle = "#1a1f36"; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

    for (let i = 0; i <= 10; i++) {
      const angle = startAngle + (i / 10) * sweep;
      const x1 = cx + Math.cos(angle) * (R + 2), y1 = cy + Math.sin(angle) * (R + 2);
      const x2 = cx + Math.cos(angle) * (R - 5), y2 = cy + Math.sin(angle) * (R - 5);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
      c.strokeStyle = i % 5 === 0 ? "#2a3560" : "#161c2a";
      c.lineWidth = i % 5 === 0 ? 1.5 : 1; c.lineCap = "round"; c.stroke();
    }

    if (force > 0.001) {
      const dangerStart = startAngle + 0.8 * sweep;
      c.beginPath(); c.arc(cx, cy, R, dangerStart, endAngle);
      c.strokeStyle = "rgba(230,57,70,0.18)"; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

      const arcEnd = startAngle + force * sweep;
      let arcColor;
      if (force < 0.4) {
        const t = force / 0.4;
        arcColor = `rgb(${Math.round(79 + t * 170)},${Math.round(142 + t * 57)},${Math.round(247 - t * 168)})`;
      } else {
        const t = (force - 0.4) / 0.6;
        arcColor = `rgb(${Math.round(249 + t * -19)},${Math.round(199 + t * -142)},${Math.round(79 - t * 9)})`;
      }

      c.beginPath(); c.arc(cx, cy, R, startAngle, arcEnd);
      c.strokeStyle = arcColor; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

      const nAngle = startAngle + force * sweep;
      const nx = cx + Math.cos(nAngle) * (R - 2), ny = cy + Math.sin(nAngle) * (R - 2);
      const [ar, ag, ab] = (arcColor.match(/\d+/g) || [79, 142, 247]).map(Number);
      const glow = c.createRadialGradient(nx, ny, 0, nx, ny, 8);
      glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.8)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      c.beginPath(); c.arc(nx, ny, 8, 0, Math.PI * 2); c.fillStyle = glow; c.fill();
      c.beginPath(); c.arc(nx, ny, 3, 0, Math.PI * 2); c.fillStyle = arcColor; c.fill();
    }

    const pct = Math.round(force * 100);
    c.font = `bold ${pct >= 100 ? 16 : 18}px 'SF Mono', monospace`;
    c.fillStyle = force > 0.001 ? (force > 0.8 ? "#e63946" : force > 0.4 ? "#f9c74f" : "#4f8ef7") : "#1e2430";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(`${pct}`, cx, cy - 4);
    c.font = "bold 7px 'SF Mono', monospace"; c.fillStyle = "#2a3050";
    c.fillText("FORCE %", cx, cy + 12);
    c.font = "bold 7px monospace"; c.fillStyle = "#1e2a3a";
    c.textAlign = "left";
    const lx = cx + Math.cos(startAngle) * (R + 10), ly = cy + Math.sin(startAngle) * (R + 10);
    c.fillText("0", lx - 4, ly + 3);
    c.textAlign = "right";
    const mx = cx + Math.cos(endAngle) * (R + 10), my = cy + Math.sin(endAngle) * (R + 10);
    c.fillText("100", mx + 4, my + 3);
  }, [force, isActive]);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
      <div style={{ fontSize:9, fontWeight:800, letterSpacing:".2em", color: isActive ? "#4f8ef7" : "#1e2430", textTransform:"uppercase", transition:"color .2s", marginBottom:-4 }}>◈ FORCE</div>
      <canvas ref={canvasRef} width={SIZE * dpr} height={SIZE * dpr} style={{ width:SIZE, height:SIZE, display:"block" }} />
      <div style={{ display:"flex", gap:3, marginTop:-10 }}>
        {[
          { label:"LOW",  col:"#4f8ef7", active: force > 0 && force <= 0.4 },
          { label:"MID",  col:"#f9c74f", active: force > 0.4 && force <= 0.79 },
          { label:"HIGH", col:"#e63946", active: force > 0.79 },
        ].map(({ label, col, active }) => (
          <div key={label} style={{
            fontSize:7, fontWeight:800, letterSpacing:".1em",
            color: active ? col : "#1a1f36", padding:"2px 5px", borderRadius:3,
            background: active ? `${col}18` : "transparent",
            border:`1px solid ${active ? col + "44" : "#1a1f36"}`, transition:"all .15s",
          }}>{label}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── SIGNAL BARS ────────────────────────────────────────────── */
function SignalBars({ features, isPainting }) {
  const bars = [
    { key:"magnitudeScore", label:"MAGNITUDE", col:"#4f8ef7", val: features?.magnitudeScore ?? 0 },
    { key:"stability",      label:"STABILITY",  col:"#a8edea", val: features?.stability ?? 0 },
    { key:"flatness",       label:"FLATNESS",   col:"#c77dff", val: features?.flatness ?? 0 },
    { key:"onsetScore",     label:"ONSET",      col:"#f9c74f", val: features?.onsetScore ?? 0 },
    { key:"resonance",      label:"RESONANCE",  col:"#f72585", val: features?.resonance ?? 0, highlight: true },
  ];
  const isVetoed = features?.contactVeto ?? false;
  return (
    <div style={{
      background:"#080b15", border:"1px solid #161c2a", borderRadius:12,
      padding:"10px 14px", display:"flex", flexDirection:"column", gap:7,
      minWidth:130, boxShadow:"inset 0 0 0 1px rgba(79,142,247,.04)",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%", marginBottom:2 }}>
        <span style={{ fontSize:8, fontWeight:800, letterSpacing:".18em", color:"#1e2a3a", textTransform:"uppercase" }}>◈ SIGNAL</span>
        {isVetoed && (
          <span style={{ fontSize:7, fontWeight:800, color:"#e63946", letterSpacing:".1em",
            background:"#e6394618", border:"1px solid #e6394644", borderRadius:3, padding:"1px 4px" }}>
            FINGER
          </span>
        )}
      </div>
      {bars.map(({ key, label, col, val, highlight }) => (
        <div key={key} style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:8, fontWeight:800, letterSpacing:".12em", color: highlight ? col : "#2a3050", textTransform:"uppercase" }}>{label}</span>
            <span style={{ fontSize:9, fontWeight:800, color: val > 0.6 ? col : "#2a3050", fontFamily:"'SF Mono', monospace" }}>{Math.round(val * 100)}</span>
          </div>
          <div style={{ height:3, background:"#0d1020", borderRadius:2, overflow:"hidden", position:"relative" }}>
            <div style={{
              position:"absolute", left:0, top:0, height:"100%",
              width:`${Math.round(val * 100)}%`,
              background: highlight ? `linear-gradient(90deg, #f72585, #f7258588)` : col,
              borderRadius:2,
              boxShadow: highlight && val > 0.5 ? `0 0 6px ${col}88` : "none",
              transition:"width .08s linear",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── PRESSURE GRAPH ─────────────────────────────────────────── */
function PressureGraph({ pressureHistory, isDrawing, features }) {
  const graphRef     = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 220, h: 100 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const W = dims.w, H = dims.h;

  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = W, ch = H;
    c.clearRect(0, 0, cw, ch);
    c.fillStyle = "#0a0c14"; c.fillRect(0, 0, cw, ch);

    c.fillStyle = "rgba(249,199,79,0.04)";
    c.fillRect(0, ch - 0.30 * ch, cw, 0.08 * ch);
    c.fillStyle = "rgba(244,162,97,0.04)";
    c.fillRect(0, ch - 0.35 * ch, cw, 0.04 * ch);
    c.fillStyle = "rgba(230,57,70,0.03)";
    c.fillRect(0, 0, cw, ch - 0.35 * ch);

    c.font = "bold 7px monospace"; c.textAlign = "right";
    c.fillStyle = "rgba(249,199,79,0.3)";  c.fillText("22ct", cw - 3, ch - 0.24 * ch);
    c.fillStyle = "rgba(244,162,97,0.3)";  c.fillText("18ct", cw - 3, ch - 0.32 * ch);
    c.fillStyle = "rgba(230,57,70,0.25)";  c.fillText("SPUR", cw - 3, ch - 0.37 * ch);

    [0.25, 0.33, 0.39, 0.5, 0.75, 1.0].forEach(v => {
      const y = ch - v * ch;
      c.beginPath(); c.strokeStyle = "#161c2a"; c.lineWidth = 1;
      c.setLineDash([2, 4]); c.moveTo(0, y); c.lineTo(cw, y); c.stroke();
      c.setLineDash([]);
    });

    if (pressureHistory.length < 2) return;

    const pts  = pressureHistory.slice(-cw);
    const step = cw / Math.max(pts.length - 1, 1);

    const grad = c.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, "rgba(247,37,133,0.55)");
    grad.addColorStop(0.4, "rgba(79,142,247,0.35)");
    grad.addColorStop(1, "rgba(79,142,247,0.04)");
    c.beginPath();
    pts.forEach((p, i) => { const x = i * step, y = ch - p * ch; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
    c.lineTo((pts.length - 1) * step, ch); c.lineTo(0, ch);
    c.closePath(); c.fillStyle = grad; c.fill();

    c.beginPath();
    pts.forEach((p, i) => { const x = i * step, y = ch - p * ch; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
    const lineGrad = c.createLinearGradient(0, 0, cw, 0);
    lineGrad.addColorStop(0, "#4f8ef7"); lineGrad.addColorStop(1, "#f72585");
    c.strokeStyle = lineGrad; c.lineWidth = 1.5; c.lineCap = "round"; c.lineJoin = "round"; c.stroke();

    const last = pts[pts.length - 1];
    const dotX = (pts.length - 1) * step, dotY = ch - last * ch;
    const glowGrad = c.createRadialGradient(dotX, dotY, 0, dotX, dotY, 6);
    glowGrad.addColorStop(0, isDrawing ? "rgba(247,37,133,0.9)" : "rgba(79,142,247,0.6)");
    glowGrad.addColorStop(1, "rgba(0,0,0,0)");
    c.beginPath(); c.arc(dotX, dotY, 6, 0, Math.PI * 2); c.fillStyle = glowGrad; c.fill();
    c.beginPath(); c.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    c.fillStyle = isDrawing ? "#f72585" : "#4f8ef7"; c.fill();

    if (features && pressureHistory.length >= WINDOW) {
      const win  = pressureHistory.slice(-WINDOW);
      const wMean = win.reduce((a,b)=>a+b,0)/win.length;
      const wStd  = Math.sqrt(win.reduce((a,b)=>a+Math.pow(b-wMean,2),0)/win.length);
      c.fillStyle = "rgba(168,237,234,0.06)";
      c.fillRect(dotX - 30, ch - (wMean + wStd) * ch, 30, wStd * 2 * ch);
    }
  }, [pressureHistory, isDrawing, features, W, H]);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  return (
    <div ref={containerRef} style={{
      position:"relative", border:"1px solid #161c2a", borderRadius:8, overflow:"hidden",
      boxShadow:"0 4px 20px rgba(0,0,0,.5), inset 0 0 0 1px rgba(79,142,247,.06)",
      width:"100%", height:"100%", flexShrink:0,
    }}>
      <canvas ref={graphRef} width={W * dpr} height={H * dpr} style={{ width:"100%", height:"100%", display:"block" }} />
    </div>
  );
}

/* ─── RESONANCE BADGE ────────────────────────────────────────── */
function ResonanceBadge({ label, confidence }) {
  const STYLES = {
    "22ct":     { col:"#f9c74f", glow:"0 0 32px rgba(249,199,79,.7)", fs:52, sub:"YELLOW GOLD" },
    "18ct":     { col:"#f4a261", glow:"0 0 32px rgba(244,162,97,.7)", fs:52, sub:"ROSE GOLD" },
    "Spurious": { col:"#e63946", glow:"0 0 36px rgba(230,57,70,.8)",  fs:38, sub:"NON-GOLD DETECTED" },
  };
  const s = label ? STYLES[label] : null;
  return (
    <div style={{ minHeight:90, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, width:"100%" }}>
      {s ? (
        <>
          <span style={{ fontSize: s.fs, fontWeight:800, letterSpacing:".04em", color: s.col, textShadow: s.glow, transition:"all .15s", lineHeight:1 }}>{label}</span>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, fontWeight:700, color: s.col + "88", letterSpacing:".12em" }}>{s.sub}</span>
            {label !== "Spurious" && (
              <div style={{ display:"flex", alignItems:"center", gap:4, background:"#0a0f1c", borderRadius:50, padding:"2px 8px", border:`1px solid ${s.col}44` }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background: s.col, boxShadow:`0 0 6px ${s.col}`, animation:"pulse 1s infinite" }}/>
                <span style={{ fontSize:9, fontWeight:800, color: s.col, fontFamily:"'SF Mono', monospace" }}>{Math.round(confidence * 100)}% CONF</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <span style={{ fontSize:22, fontWeight:700, color:"#1e2430", letterSpacing:".1em" }}>— —</span>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────── */
export default function Whiteboard() {
  const canvasRef    = useRef(null);
  const drawing      = useRef(false);
  const lastPt       = useRef(null);
  const lastPres     = useRef(0.5);
  const decayTimer   = useRef(null);
  const livePressure = useRef(0);
  const liveArea     = useRef(0);
  const rafId        = useRef(null);
  const featuresRef  = useRef(null);
  const smoothedPressure    = useRef(0);
  const pressureHistoryRef  = useRef(0); // last pushed value for deadband

  const [pressureHistory, setPressureHistory] = useState([]);
  const [isPainting, setIsPainting]           = useState(false);
  const [features, setFeatures]               = useState(null);
  const [toast, setToast]                     = useState({ message: null, type: "saving" });
  const [isArmed, setIsArmed]                 = useState(false);
  const lastTapTime                           = useRef(0);
  const tapCount                              = useRef(0);
  const TRIPLE_TAP_MS                         = 500;

  const areaHistory  = useRef([]);
  const onsetHistory = useRef([]);

  const showToast = (message, type = "saving", duration = 2500) => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: null, type: "saving" }), duration);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = (window.innerWidth / 2) * dpr;
    canvas.height = window.innerHeight * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, window.innerWidth / 2, window.innerHeight);
  }, []);

  const ctx    = () => canvasRef.current?.getContext("2d");
  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? 0);
    const dpr = window.devicePixelRatio || 1;
    return { x:(cx-rect.left)*(canvas.width/rect.width/dpr), y:(cy-rect.top)*(canvas.height/rect.height/dpr) };
  };
  const getPressure = (e) => Math.max(0.02, Math.min(1, e.pressure ?? 0.5));
  const getArea     = (e) => {
    const w = e.width ?? 0, h = e.height ?? 0;
    const diag = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
    return (w * h) / (diag * diag);
  };

  const pushPressure = useCallback((p, area) => {
    areaHistory.current = [...areaHistory.current.slice(-30), area ?? 0];
    if (onsetHistory.current.length < 10) onsetHistory.current = [...onsetHistory.current, p];
    setPressureHistory(h => {
      const next = h.length > 200 ? [...h.slice(-200), p] : [...h, p];
      const feat = computeSignalFeatures(next, areaHistory.current, onsetHistory.current);
      featuresRef.current = feat; // always keep latest features in ref
      setFeatures(feat);
      return next;
    });
  }, []);

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

  const applyStyle = (c, pressure) => {
    c.globalCompositeOperation = "source-over";
    c.strokeStyle = `rgba(13,13,13,${Math.pow(pressure, 0.65)})`;
    c.lineWidth   = Math.max(0.5, 5 * (0.25 + pressure * 0.95));
    c.lineCap = "round"; c.lineJoin = "round";
  };

  const startPressureLoop = () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    const loop = () => {
      if (!drawing.current) return;
      // Stronger EMA — 0.92 weight on previous = much smoother
      smoothedPressure.current = smoothedPressure.current * 0.92 + livePressure.current * 0.08;
      // Deadband — only push if changed by more than 0.5%, kills micro-jitter
      const prev = pressureHistoryRef.current;
      if (Math.abs(smoothedPressure.current - prev) > 0.005) {
        pressureHistoryRef.current = smoothedPressure.current;
        pushPressure(smoothedPressure.current, liveArea.current);
      }
      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  };

  const stopPressureLoop = () => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse") return;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});

    // ── Triple tap = toggle ARMED ──
    const now = Date.now();
    if (now - lastTapTime.current < TRIPLE_TAP_MS) {
      tapCount.current += 1;
    } else {
      tapCount.current = 1;
    }
    lastTapTime.current = now;

    if (tapCount.current >= 3) {
      tapCount.current = 0;
      setIsArmed(prev => {
        const next = !prev;
        setTimeout(() => showToast(next ? "🔴 ARMED — SAVES ENABLED" : "⚪ DISARMED — SAVES OFF", next ? "success" : "error", 1800), 0);
        return next;
      });
      return;
    }

    if (decayTimer.current) clearInterval(decayTimer.current);
    const pos = getPos(e), pres = getPressure(e);
    livePressure.current  = pres;
    liveArea.current      = getArea(e);
    areaHistory.current    = [];
    onsetHistory.current   = [];
    featuresRef.current    = null;
    smoothedPressure.current  = pres;
    pressureHistoryRef.current = pres;
    drawing.current = true; lastPt.current = pos; lastPres.current = pres;
    setIsPainting(true);
    startPressureLoop();
  };

  const onPointerMove = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const pos = getPos(e), pres = getPressure(e);
    livePressure.current = pres;
    liveArea.current     = getArea(e);
    const c = ctx();
    if (!c) return;
    const avgPres = (lastPres.current + pres) / 2;
    applyStyle(c, avgPres);
    const mid = { x:(lastPt.current.x+pos.x)/2, y:(lastPt.current.y+pos.y)/2 };
    c.beginPath(); c.moveTo(lastPt.current.x, lastPt.current.y);
    c.quadraticCurveTo(lastPt.current.x, lastPt.current.y, mid.x, mid.y);
    c.stroke();
    lastPt.current = mid; lastPres.current = pres;
  };

  const onPointerUp = async () => {
    stopPressureLoop();
    drawing.current = false;
    setIsPainting(false);
    ctx() && (ctx().globalCompositeOperation = "source-over");

    // ── Save to Google Sheets ──
    // Use featuresRef (captured DURING press) not livePressure (which is 0 at lift)
    const feat = featuresRef.current;
    const stablePct = feat ? feat.pct : 0;
    const stableForce = stablePct / 100;

    const ct = stablePct >= 22 && stablePct <= 30 ? "22ct"
             : stablePct >= 31 && stablePct <= 35 ? "18ct"
             : stablePct > 35                     ? "Spurious"
             : null;

    if (ct && isArmed && stableForce > 0) {
      showToast("SAVING TO SHEETS…", "saving", 60000);
      const ok = await saveReading({
        force:     stableForce,
        ct,
        resonance: feat?.resonance ?? 0,
      });
      showToast(ok ? "✓ SAVED TO SHEETS" : "✗ SAVE FAILED", ok ? "success" : "error");
    }

    setFeatures(null);
    startDecay();
  };

  const currentForce = pressureHistory[pressureHistory.length - 1] ?? 0;
  const instantLabel = (() => {
    const p = currentForce * 100;
    if (!isPainting) return null;
    if (p >= 22 && p <= 30) return "22ct";
    if (p >= 31 && p <= 35) return "18ct";
    if (p > 35)             return "Spurious";
    return null;
  })();

  return (
    <div
      style={{ position:"fixed", inset:0, overflow:"hidden", display:"flex", userSelect:"none", WebkitUserSelect:"none", background:"#080a12" }}
      onContextMenu={e => e.preventDefault()}
    >
      <style>{`*{margin:0;padding:0;box-sizing:border-box;}html,body{width:100%;height:100%;overflow:hidden;background:#080a12;}html{height:-webkit-fill-available;}body{min-height:-webkit-fill-available;}`}</style>
      <canvas ref={canvasRef} style={{ display:"none" }} />

      {/* Toast */}
      <Toast message={toast.message} type={toast.type} />

      <div
        style={{
          width:"100%", height:"100%",
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"space-between",
          padding:"env(safe-area-inset-top, 20px) 16px env(safe-area-inset-bottom, 16px)",
          boxSizing:"border-box", touchAction:"none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >

        {/* ── TOP BAR ── */}
        <div style={{ width:"100%", display:"flex", alignItems:"flex-start", justifyContent:"space-between", paddingTop:4, gap:8 }}>
          <div style={{
            background:"#0a0c18", border:"1px solid #161c2a", borderRadius:14,
            padding:"10px 12px 6px",
            boxShadow:"0 4px 24px rgba(0,0,0,.6), inset 0 0 0 1px rgba(79,142,247,.05)",
            display:"flex", flexDirection:"column", alignItems:"center", minWidth:120,
          }}>
            <ForceMeter force={currentForce} isActive={isPainting} />
          </div>

          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, paddingTop:12, flex:1 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
              <span style={{
                fontSize:52, fontWeight:800, lineHeight:1,
                background:"linear-gradient(135deg,#4f8ef7,#f72585)",
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
              }}>{Math.round(currentForce * 100)}</span>
              <span style={{ fontSize:18, color:"#2a3050", fontWeight:700 }}>%</span>
            </div>
            <div style={{
              display:"flex", alignItems:"center", gap:7,
              background:"#0e1120", borderRadius:50, padding:"5px 12px", border:"1px solid #1a1f36",
            }}>
              <div style={{
                width:6, height:6, borderRadius:"50%",
                background: isPainting ? "#f72585" : "#1e2430",
                boxShadow: isPainting ? "0 0 8px #f72585" : "none", transition:"all .2s",
              }}/>
              <span style={{ fontSize:10, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase",
                color: isPainting ? "#f72585" : "#2a3050", transition:"color .2s" }}>
                {isPainting ? "LIVE" : "IDLE"}
              </span>
            </div>
            {/* ARMED indicator */}
            <div style={{
              display:"flex", alignItems:"center", gap:6,
              background: isArmed ? "#0a1a0a" : "#0e1120",
              borderRadius:50, padding:"4px 12px",
              border: `1px solid ${isArmed ? "#22c55e44" : "#1a1f36"}`,
              transition:"all .25s",
            }}>
              <div style={{
                width:6, height:6, borderRadius:"50%",
                background: isArmed ? "#22c55e" : "#1e2430",
                boxShadow: isArmed ? "0 0 8px #22c55e" : "none",
                transition:"all .25s",
              }}/>
              <span style={{
                fontSize:10, fontWeight:800, letterSpacing:".14em",
                color: isArmed ? "#22c55e" : "#2a3050", transition:"color .25s",
              }}>
                {isArmed ? "ARMED" : "DISARMED"}
              </span>
            </div>
            <span style={{ fontSize:8, color:"#1e2a3a", letterSpacing:".06em" }}>triple tap to {isArmed ? "disarm" : "save"}</span>
          </div>

          <SignalBars features={features} isPainting={isPainting} />
        </div>

        {/* ── GRAPH ── */}
        <div style={{ width:"100%", flex:1, padding:"12px 0" }}>
          <PressureGraph pressureHistory={pressureHistory} isDrawing={isPainting} features={features} />
        </div>

        {/* ── CARAT RESULT ── */}
        <ResonanceBadge label={instantLabel} confidence={features?.confidence ?? 0} />

        {/* ── BOTTOM ── */}
        <div style={{ paddingBottom:4, display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:9, fontWeight:800, color:"#1e2a3a", letterSpacing:".14em", textTransform:"uppercase" }}>✦ GOLD RESONANCE MONITOR</span>
          {features && (
            <span style={{ fontSize:9, fontWeight:700, fontFamily:"'SF Mono',monospace",
              color: features.contactVeto ? "#e63946" : "#1e2a3a" }}>
              A:{((features.latestArea ?? 0) * 10000).toFixed(1)}
              {" | "}FL:{Math.round((features.flatness ?? 0)*100)}
              {" | "}ON:{Math.round((features.onsetScore ?? 0)*100)}
              {features.contactVeto ? " ⚠ FINGER" : ""}
            </span>
          )}
          {/* Report Button */}
          <a
            href="https://docs.google.com/spreadsheets/d/1FlnJ4tRbPGyDmXA0P9-GQYqqqu8dp8rWskZNpJV93hg/edit?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:"flex", alignItems:"center", gap:6,
              background:"linear-gradient(135deg, #0d2a18 0%, #0a1f12 100%)",
              border:"1px solid #22c55e66",
              borderRadius:10, padding:"7px 14px",
              textDecoration:"none", cursor:"pointer",
              boxShadow:"0 0 16px rgba(34,197,94,0.15), inset 0 0 0 1px rgba(34,197,94,0.08)",
              transition:"all .2s",
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow="0 0 24px rgba(34,197,94,0.35), inset 0 0 0 1px rgba(34,197,94,0.2)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow="0 0 16px rgba(34,197,94,0.15), inset 0 0 0 1px rgba(34,197,94,0.08)"}
          >
            <div style={{
              width:18, height:18, borderRadius:4,
              background:"rgba(34,197,94,0.15)",
              border:"1px solid #22c55e44",
              display:"flex", alignItems:"center", justifyContent:"center",
              flexShrink:0,
            }}>
              <span style={{ fontSize:10, lineHeight:1 }}>📊</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
              <span style={{ fontSize:10, fontWeight:800, color:"#22c55e", letterSpacing:".14em", textTransform:"uppercase", lineHeight:1 }}>REPORT</span>
              <span style={{ fontSize:7, fontWeight:600, color:"#22c55e55", letterSpacing:".06em", lineHeight:1 }}>VIEW SHEET</span>
            </div>
            <div style={{
              width:5, height:5, borderRadius:"50%",
              background:"#22c55e",
              boxShadow:"0 0 6px #22c55e",
              animation:"pulse 2s infinite",
              marginLeft:2,
            }}/>
          </a>
        </div>

      </div>
    </div>
  );
}
