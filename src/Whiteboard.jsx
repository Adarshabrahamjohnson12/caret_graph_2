import { useState, useRef, useEffect, useCallback } from "react";

/* ─── SIGNAL ANALYSIS ENGINE ─────────────────────────────────── */
// 6 independent anti-finger signals:
//  1. MAGNITUDE     — pressure in gold zones (25–38%) vs spurious (39+)
//  2. STABILITY     — low CV = object not wobbling
//  3. SMOOTHNESS    — low dP/dt = no finger micro-movement
//  4. CONTACT SIZE  — e.width×e.height: metal tiny, finger large → HARD VETO
//  5. ONSET SLOPE   — gold hits pressure fast (<5 frames), finger ramps slowly
//  6. FLATNESS      — peak-to-peak range after settling: gold ~0, finger drifts

const WINDOW      = 20;  // rolling analysis window
const ONSET_FRAMES = 6;  // frames to measure onset slope
const AREA_VETO   = 0.018; // contact area threshold — above this = finger veto
                            // (e.width and e.height are 0–1 normalised by browser)

function computeSignalFeatures(history, areaHistory, onsetHistory) {
  if (history.length < 3) return null;
  const win = history.slice(-WINDOW);
  const n   = win.length;

  // ── 1. Magnitude ──
  const mean = win.reduce((a, b) => a + b, 0) / n;
  const pct  = mean * 100;

  // ── 2. Stability (CV) ──
  const variance = win.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std       = Math.sqrt(variance);
  const cv        = mean > 0.01 ? std / mean : 1;
  const stability = Math.max(0, Math.min(1, 1 - cv * 2.5));

  // ── 3. Smoothness (velocity variance) ──
  const deltas   = [];
  for (let i = 1; i < win.length; i++) deltas.push(Math.abs(win[i] - win[i - 1]));
  const avgDelta  = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const smoothness = Math.max(0, Math.min(1, 1 - avgDelta * 18));

  // ── 4. Contact size HARD VETO ──
  // Browser reports e.width/e.height in CSS px (finger ~40–80px, stylus/metal <5px)
  // We normalise by screen width to get a 0–1 scale
  const latestArea = areaHistory.length > 0 ? areaHistory[areaHistory.length - 1] : 0;
  const avgArea    = areaHistory.length > 0
    ? areaHistory.slice(-10).reduce((a,b)=>a+b,0) / Math.min(areaHistory.slice(-10).length, 10)
    : 0;
  // Finger contact area is typically > 0.01 (1% of screen width × height)
  // Metal object (ring, chain) is typically < 0.003
  const contactVeto = avgArea > AREA_VETO; // true = finger detected = block gold

  // ── 5. Onset slope ──
  // How fast did pressure rise in first ONSET_FRAMES?
  // Gold: steep rise (>0.015/frame), finger: gradual (<0.008/frame)
  let onsetScore = 0.5; // neutral default
  if (onsetHistory.length >= ONSET_FRAMES) {
    const onset = onsetHistory.slice(0, ONSET_FRAMES);
    const slope = (onset[onset.length-1] - onset[0]) / ONSET_FRAMES;
    // steep positive slope = gold-like (fast press)
    onsetScore = Math.max(0, Math.min(1, slope * 40 + 0.5));
  }

  // ── 6. Flatness (peak-to-peak after settling) ──
  // After first 8 frames, how much does pressure fluctuate?
  // Gold resting still: range < 0.005; finger: range > 0.015
  let flatness = 0.5;
  if (history.length > 10) {
    const settled = history.slice(-10);
    const hi = Math.max(...settled), lo = Math.min(...settled);
    const range = hi - lo;
    flatness = Math.max(0, Math.min(1, 1 - range * 50)); // 0.02 range = 0 flatness
  }

  // ── Per-zone magnitude score ──
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

  // ── Resonance composite ──
  let resonance = 0;
  if (zone && zone !== "Spurious") {
    resonance = magnitudeScore * 0.25
              + stability      * 0.20
              + smoothness     * 0.15
              + onsetScore     * 0.20
              + flatness       * 0.20;
  }

  // ── Final classification ──
  // contactVeto is a HARD block — if finger-sized contact, never show gold
  let label = zone;
  if (contactVeto && zone !== "Spurious") {
    label = null; // blocked by contact size
  }

  const confidence = resonance;

  return {
    pct, stability, smoothness, magnitudeScore, resonance,
    label, confidence, zone, mean,
    contactVeto, latestArea: avgArea, onsetScore, flatness
  };
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
      minWidth:130,
      boxShadow:"inset 0 0 0 1px rgba(79,142,247,.04)",
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
            <span style={{
              fontSize:8, fontWeight:800, letterSpacing:".12em",
              color: highlight ? col : "#2a3050",
              textTransform:"uppercase",
            }}>{label}</span>
            <span style={{ fontSize:9, fontWeight:800, color: val > 0.6 ? col : "#2a3050", fontFamily:"'SF Mono', monospace" }}>
              {Math.round(val * 100)}
            </span>
          </div>
          <div style={{ height:3, background:"#0d1020", borderRadius:2, overflow:"hidden", position:"relative" }}>
            <div style={{
              position:"absolute", left:0, top:0, height:"100%",
              width:`${Math.round(val * 100)}%`,
              background: highlight
                ? `linear-gradient(90deg, #f72585, #f7258588)`
                : col,
              borderRadius:2,
              boxShadow: highlight && val > 0.5 ? `0 0 6px ${col}88` : "none",
              transition:"width .08s linear",
            }} />
            {/* Gold zone markers for magnitude bar */}
            {key === "magnitudeScore" && (
              <>
                <div style={{ position:"absolute", left:"25%", top:0, width:1, height:"100%", background:"#f9c74f33" }} />
                <div style={{ position:"absolute", left:"32%", top:0, width:1, height:"100%", background:"#f9c74f22" }} />
                <div style={{ position:"absolute", left:"33%", top:0, width:1, height:"100%", background:"#f4a26133" }} />
                <div style={{ position:"absolute", left:"38%", top:0, width:1, height:"100%", background:"#f4a26122" }} />
                <div style={{ position:"absolute", left:"39%", top:0, width:1, height:"100%", background:"#e6394633" }} />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── PRESSURE GRAPH ─────────────────────────────────────────── */
function PressureGraph({ pressureHistory, isDrawing, features }) {
  const graphRef = useRef(null);
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
    c.fillStyle = "#0a0c14";
    c.fillRect(0, 0, cw, ch);

    // ── Gold zone bands ──
    // 22ct: 25–32%
    c.fillStyle = "rgba(249,199,79,0.04)";
    c.fillRect(0, ch - 0.30 * ch, cw, 0.08 * ch);
    // 18ct: 31–35%
    c.fillStyle = "rgba(244,162,97,0.04)";
    c.fillRect(0, ch - 0.35 * ch, cw, 0.04 * ch);
    // Spurious: 35%+
    c.fillStyle = "rgba(230,57,70,0.03)";
    c.fillRect(0, 0, cw, ch - 0.35 * ch);

    // Zone labels on right
    c.font = "bold 7px monospace";
    c.textAlign = "right";
    c.fillStyle = "rgba(249,199,79,0.3)";
    c.fillText("22ct", cw - 3, ch - 0.24 * ch);
    c.fillStyle = "rgba(244,162,97,0.3)";
    c.fillText("18ct", cw - 3, ch - 0.32 * ch);
    c.fillStyle = "rgba(230,57,70,0.25)";
    c.fillText("SPUR", cw - 3, ch - 0.37 * ch);

    [0.25, 0.33, 0.39, 0.5, 0.75, 1.0].forEach(v => {
      const y = ch - v * ch;
      c.beginPath();
      c.strokeStyle = "#161c2a";
      c.lineWidth = 1;
      c.setLineDash([2, 4]);
      c.moveTo(0, y); c.lineTo(cw, y); c.stroke();
      c.setLineDash([]);
    });

    [25, 50, 75, 100].forEach(v => {
      const y = ch - (v / 100) * ch;
      c.fillStyle = "#2a3050"; c.font = "bold 7px sans-serif";
      c.textAlign = "left";
      c.fillText(`${v}`, 3, y - 2);
    });

    if (pressureHistory.length < 2) {
      c.beginPath(); c.strokeStyle = "#1e2a3a"; c.lineWidth = 1;
      c.setLineDash([3, 5]); c.moveTo(0, ch - 2); c.lineTo(cw, ch - 2); c.stroke();
      c.setLineDash([]);
      return;
    }

    const pts = pressureHistory.slice(-cw);
    const step = cw / Math.max(pts.length - 1, 1);

    // Fill
    const grad = c.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, "rgba(247,37,133,0.55)");
    grad.addColorStop(0.4, "rgba(79,142,247,0.35)");
    grad.addColorStop(1, "rgba(79,142,247,0.04)");
    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step, y = ch - p * ch;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.lineTo((pts.length - 1) * step, ch); c.lineTo(0, ch);
    c.closePath(); c.fillStyle = grad; c.fill();

    // Line — color by zone
    c.beginPath();
    pts.forEach((p, i) => {
      const x = i * step, y = ch - p * ch;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    const lineGrad = c.createLinearGradient(0, 0, cw, 0);
    lineGrad.addColorStop(0, "#4f8ef7");
    lineGrad.addColorStop(1, "#f72585");
    c.strokeStyle = lineGrad; c.lineWidth = 1.5;
    c.lineCap = "round"; c.lineJoin = "round"; c.stroke();

    // Dot
    const last = pts[pts.length - 1];
    const dotX = (pts.length - 1) * step, dotY = ch - last * ch;
    const glowGrad = c.createRadialGradient(dotX, dotY, 0, dotX, dotY, 6);
    glowGrad.addColorStop(0, isDrawing ? "rgba(247,37,133,0.9)" : "rgba(79,142,247,0.6)");
    glowGrad.addColorStop(1, "rgba(0,0,0,0)");
    c.beginPath(); c.arc(dotX, dotY, 6, 0, Math.PI * 2); c.fillStyle = glowGrad; c.fill();
    c.beginPath(); c.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    c.fillStyle = isDrawing ? "#f72585" : "#4f8ef7"; c.fill();

    // ── Stability band (rolling std shading) ──
    if (features && pressureHistory.length >= WINDOW) {
      const win = pressureHistory.slice(-WINDOW);
      const wMean = win.reduce((a,b)=>a+b,0)/win.length;
      const wStd = Math.sqrt(win.reduce((a,b)=>a+Math.pow(b-wMean,2),0)/win.length);
      const bandTop    = ch - (wMean + wStd) * ch;
      const bandBottom = ch - Math.max(0, wMean - wStd) * ch;
      c.fillStyle = "rgba(168,237,234,0.06)";
      c.fillRect(dotX - 30, bandTop, 30, bandBottom - bandTop);
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
      <div style={{ position:"absolute", top:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>100</div>
      <div style={{ position:"absolute", bottom:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>0</div>
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
          <span style={{
            fontSize: s.fs, fontWeight:800, letterSpacing:".04em",
            color: s.col, textShadow: s.glow,
            transition:"all .15s", lineHeight:1,
          }}>{label}</span>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, fontWeight:700, color: s.col + "88", letterSpacing:".12em" }}>{s.sub}</span>
            {label !== "Spurious" && (
              <div style={{
                display:"flex", alignItems:"center", gap:4,
                background:"#0a0f1c", borderRadius:50, padding:"2px 8px",
                border:`1px solid ${s.col}44`,
              }}>
                <div style={{
                  width:5, height:5, borderRadius:"50%", background: s.col,
                  boxShadow:`0 0 6px ${s.col}`,
                  animation: "pulse 1s infinite",
                }}/>
                <span style={{ fontSize:9, fontWeight:800, color: s.col, fontFamily:"'SF Mono', monospace" }}>
                  {Math.round(confidence * 100)}% CONF
                </span>
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
const TOOLS = { PEN:"pen" };
const hexToRgb = (hex) => ({ r:parseInt(hex.slice(1,3),16), g:parseInt(hex.slice(3,5),16), b:parseInt(hex.slice(5,7),16) });

export default function Whiteboard() {
  const canvasRef    = useRef(null);
  const drawing      = useRef(false);
  const lastPt       = useRef(null);
  const lastPres     = useRef(0.5);
  const snapshotR    = useRef(null);
  const startPtR     = useRef(null);
  const decayTimer   = useRef(null);
  const livePressure = useRef(0);
  const liveArea     = useRef(0);
  const rafId        = useRef(null);

  const [pressureHistory, setPressureHistory] = useState([]);
  const [isPainting, setIsPainting]           = useState(false);
  const [features, setFeatures]               = useState(null);
  const areaHistory  = useRef([]);   // contact area per frame
  const onsetHistory = useRef([]);   // first N pressure frames of each touch

  const tool      = TOOLS.PEN;
  const color     = "#0d0d0d";
  const strokeSize = 5;

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

  const pushPressure = useCallback((p, area) => {
    // Track contact area
    areaHistory.current = [...areaHistory.current.slice(-30), area ?? 0];
    // Track onset (first ONSET_FRAMES of each press)
    if (onsetHistory.current.length < 10) {
      onsetHistory.current = [...onsetHistory.current, p];
    }
    setPressureHistory(h => {
      const next = h.length > 200 ? [...h.slice(-200), p] : [...h, p];
      const feat = computeSignalFeatures(next, areaHistory.current, onsetHistory.current);
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
    const {r,g,b} = hexToRgb(color);
    const alpha = Math.pow(pressure, 0.65);
    const width = strokeSize * (0.25 + pressure * 0.95);
    c.globalCompositeOperation = "source-over";
    c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    c.lineWidth   = Math.max(0.5, width);
    c.lineCap = "round"; c.lineJoin = "round";
  };

  // ── RAF loop: pushes current pressure every ~16ms while finger is held ──
  const startPressureLoop = () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    const loop = () => {
      if (!drawing.current) return;
      pushPressure(livePressure.current, liveArea.current);
      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
  };

  const stopPressureLoop = () => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  const getArea = (e) => {
    // e.width/e.height are contact dimensions in CSS px
    // Normalise by screen diagonal to get a device-independent 0–1 area estimate
    const w = e.width  ?? 0;
    const h = e.height ?? 0;
    const diag = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
    return (w * h) / (diag * diag);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse") return;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
    if (decayTimer.current) clearInterval(decayTimer.current);
    const pos = getPos(e), pres = getPressure(e);
    const area = getArea(e);
    livePressure.current  = pres;
    liveArea.current      = area;
    areaHistory.current   = [];   // fresh on each touch
    onsetHistory.current  = [];   // fresh on each touch
    drawing.current = true; lastPt.current = pos; lastPres.current = pres;
    setIsPainting(true);
    const c = ctx();
    if (!c) return;
    snapshotR.current = c.getImageData(0,0,canvasRef.current.width,canvasRef.current.height);
    startPtR.current  = pos;
    startPressureLoop();
  };

  const onPointerMove = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const pos = getPos(e), pres = getPressure(e);
    livePressure.current = pres;
    liveArea.current     = getArea(e); // update live area — RAF loop will push it
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

  const onPointerUp = () => {
    stopPressureLoop();
    drawing.current = false; setIsPainting(false);
    ctx() && (ctx().globalCompositeOperation = "source-over");
    setFeatures(null);
    startDecay();
  };

  const currentForce = pressureHistory[pressureHistory.length - 1] ?? 0;

  return (
    <div
      style={{ position:"fixed", inset:0, overflow:"hidden", display:"flex", userSelect:"none", WebkitUserSelect:"none", background:"#080a12" }}
      onContextMenu={e => e.preventDefault()}
    >
      <style>{`*{margin:0;padding:0;box-sizing:border-box;}html,body{width:100%;height:100%;overflow:hidden;background:#080a12;}html{height:-webkit-fill-available;}body{min-height:-webkit-fill-available;}`}</style>
      <canvas ref={canvasRef} style={{ display:"none" }} />

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

          {/* Force meter */}
          <div style={{
            background:"#0a0c18", border:"1px solid #161c2a", borderRadius:14,
            padding:"10px 12px 6px",
            boxShadow:"0 4px 24px rgba(0,0,0,.6), inset 0 0 0 1px rgba(79,142,247,.05)",
            display:"flex", flexDirection:"column", alignItems:"center", minWidth:120,
          }}>
            <ForceMeter force={currentForce} isActive={isPainting} />
          </div>

          {/* Big % + LIVE/IDLE */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, paddingTop:12, flex:1 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
              <span style={{
                fontSize:52, fontWeight:800, lineHeight:1,
                background:"linear-gradient(135deg,#4f8ef7,#f72585)",
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
              }}>
                {Math.round(currentForce * 100)}
              </span>
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
          </div>

          {/* Signal bars */}
          <SignalBars features={features} isPainting={isPainting} />
        </div>

        {/* ── GRAPH ── */}
        <div style={{ width:"100%", flex:1, padding:"12px 0" }}>
          <PressureGraph pressureHistory={pressureHistory} isDrawing={isPainting} features={features} />
        </div>

        {/* ── CARAT RESULT ── */}
        <ResonanceBadge label={features?.label ?? null} confidence={features?.confidence ?? 0} />

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
        </div>

      </div>
    </div>
  );
}

//moble version

// import { useState, useRef, useEffect, useCallback } from "react";

// /* ─── SIGNAL ANALYSIS ENGINE ─────────────────────────────────── */
// // Instead of raw pressure threshold only, we compute 4 independent signals:
// //  1. MAGNITUDE   — pressure level (the original single feature)
// //  2. STABILITY   — inverse coefficient of variation; real gold = consistent force
// //  3. SMOOTHNESS  — low dP/dt variance; dense objects don't spike/jitter
// //  4. RESONANCE   — weighted composite → final gold score

// const WINDOW = 12; // frames for rolling analysis

// function computeSignalFeatures(history) {
//   if (history.length < 3) return null;
//   const win = history.slice(-WINDOW);
//   const n = win.length;

//   // ── Magnitude ──
//   const mean = win.reduce((a, b) => a + b, 0) / n;
//   const pct = mean * 100;

//   // ── Stability: 1 - CV (coefficient of variation) ──
//   const variance = win.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
//   const std = Math.sqrt(variance);
//   const cv = mean > 0.01 ? std / mean : 1;
//   const stability = Math.max(0, Math.min(1, 1 - cv * 2.5)); // scale so CV>0.4 = 0

//   // ── Smoothness: low velocity variance ──
//   const deltas = [];
//   for (let i = 1; i < win.length; i++) deltas.push(Math.abs(win[i] - win[i - 1]));
//   const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
//   const smoothness = Math.max(0, Math.min(1, 1 - avgDelta * 18)); // 0.056/frame = fully rough

//   // ── Per-zone magnitude score ──
//   // 22ct zone: 25-32, 18ct zone: 33-38, neither = 0
//   let magnitudeScore = 0;
//   let zone = null;
//   if (pct >= 25 && pct <= 32) {
//     // Gaussian peak at 28.5 (centre of 25–32)
//     magnitudeScore = Math.exp(-Math.pow(pct - 28.5, 2) / (2 * 3.5 * 3.5));
//     zone = "22ct";
//   } else if (pct >= 33 && pct <= 38) {
//     // Gaussian peak at 35.5 (centre of 33–38)
//     magnitudeScore = Math.exp(-Math.pow(pct - 35.5, 2) / (2 * 2.5 * 2.5));
//     zone = "18ct";
//   } else if (pct >= 39) {
//     zone = "Spurious";
//     magnitudeScore = 0;
//   }

//   // ── Resonance composite (weighted) ──
//   // For non-spurious: magnitude band + stability + smoothness
//   let resonance = 0;
//   if (zone && zone !== "Spurious") {
//     resonance = magnitudeScore * 0.40 + stability * 0.35 + smoothness * 0.25;
//   } else if (zone === "Spurious") {
//     resonance = 0;
//   }

//   // ── Final classification — instant, no confidence gate ──
//   let label = zone;
//   let confidence = resonance;

//   return { pct, stability, smoothness, magnitudeScore, resonance, label, confidence, zone, mean };
// }

// /* ─── FORCE METER ────────────────────────────────────────────── */
// function ForceMeter({ force, isActive }) {
//   const canvasRef = useRef(null);
//   const SIZE = 110;
//   const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//     const c = canvas.getContext("2d");
//     c.setTransform(dpr, 0, 0, dpr, 0, 0);
//     const W = SIZE, H = SIZE;
//     c.clearRect(0, 0, W, H);
//     const cx = W / 2, cy = H / 2 + 8, R = 38;
//     const startAngle = (210 * Math.PI) / 180;
//     const endAngle   = (330 * Math.PI) / 180;
//     const sweep = (240 * Math.PI) / 180;

//     c.beginPath(); c.arc(cx, cy, R, startAngle, endAngle);
//     c.strokeStyle = "#1a1f36"; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

//     for (let i = 0; i <= 10; i++) {
//       const angle = startAngle + (i / 10) * sweep;
//       const x1 = cx + Math.cos(angle) * (R + 2), y1 = cy + Math.sin(angle) * (R + 2);
//       const x2 = cx + Math.cos(angle) * (R - 5), y2 = cy + Math.sin(angle) * (R - 5);
//       c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
//       c.strokeStyle = i % 5 === 0 ? "#2a3560" : "#161c2a";
//       c.lineWidth = i % 5 === 0 ? 1.5 : 1; c.lineCap = "round"; c.stroke();
//     }

//     if (force > 0.001) {
//       const dangerStart = startAngle + 0.8 * sweep;
//       c.beginPath(); c.arc(cx, cy, R, dangerStart, endAngle);
//       c.strokeStyle = "rgba(230,57,70,0.18)"; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

//       const arcEnd = startAngle + force * sweep;
//       let arcColor;
//       if (force < 0.4) {
//         const t = force / 0.4;
//         arcColor = `rgb(${Math.round(79 + t * 170)},${Math.round(142 + t * 57)},${Math.round(247 - t * 168)})`;
//       } else {
//         const t = (force - 0.4) / 0.6;
//         arcColor = `rgb(${Math.round(249 + t * -19)},${Math.round(199 + t * -142)},${Math.round(79 - t * 9)})`;
//       }

//       c.beginPath(); c.arc(cx, cy, R, startAngle, arcEnd);
//       c.strokeStyle = arcColor; c.lineWidth = 7; c.lineCap = "round"; c.stroke();

//       const nAngle = startAngle + force * sweep;
//       const nx = cx + Math.cos(nAngle) * (R - 2), ny = cy + Math.sin(nAngle) * (R - 2);
//       const [ar, ag, ab] = (arcColor.match(/\d+/g) || [79, 142, 247]).map(Number);
//       const glow = c.createRadialGradient(nx, ny, 0, nx, ny, 8);
//       glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.8)`);
//       glow.addColorStop(1, "rgba(0,0,0,0)");
//       c.beginPath(); c.arc(nx, ny, 8, 0, Math.PI * 2); c.fillStyle = glow; c.fill();
//       c.beginPath(); c.arc(nx, ny, 3, 0, Math.PI * 2); c.fillStyle = arcColor; c.fill();
//     }

//     const pct = Math.round(force * 100);
//     c.font = `bold ${pct >= 100 ? 16 : 18}px 'SF Mono', monospace`;
//     c.fillStyle = force > 0.001 ? (force > 0.8 ? "#e63946" : force > 0.4 ? "#f9c74f" : "#4f8ef7") : "#1e2430";
//     c.textAlign = "center"; c.textBaseline = "middle";
//     c.fillText(`${pct}`, cx, cy - 4);
//     c.font = "bold 7px 'SF Mono', monospace"; c.fillStyle = "#2a3050";
//     c.fillText("FORCE %", cx, cy + 12);
//     c.font = "bold 7px monospace"; c.fillStyle = "#1e2a3a";
//     c.textAlign = "left";
//     const lx = cx + Math.cos(startAngle) * (R + 10), ly = cy + Math.sin(startAngle) * (R + 10);
//     c.fillText("0", lx - 4, ly + 3);
//     c.textAlign = "right";
//     const mx = cx + Math.cos(endAngle) * (R + 10), my = cy + Math.sin(endAngle) * (R + 10);
//     c.fillText("100", mx + 4, my + 3);
//   }, [force, isActive]);

//   return (
//     <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
//       <div style={{ fontSize:9, fontWeight:800, letterSpacing:".2em", color: isActive ? "#4f8ef7" : "#1e2430", textTransform:"uppercase", transition:"color .2s", marginBottom:-4 }}>◈ FORCE</div>
//       <canvas ref={canvasRef} width={SIZE * dpr} height={SIZE * dpr} style={{ width:SIZE, height:SIZE, display:"block" }} />
//       <div style={{ display:"flex", gap:3, marginTop:-10 }}>
//         {[
//           { label:"LOW",  col:"#4f8ef7", active: force > 0 && force <= 0.4 },
//           { label:"MID",  col:"#f9c74f", active: force > 0.4 && force <= 0.79 },
//           { label:"HIGH", col:"#e63946", active: force > 0.79 },
//         ].map(({ label, col, active }) => (
//           <div key={label} style={{
//             fontSize:7, fontWeight:800, letterSpacing:".1em",
//             color: active ? col : "#1a1f36", padding:"2px 5px", borderRadius:3,
//             background: active ? `${col}18` : "transparent",
//             border:`1px solid ${active ? col + "44" : "#1a1f36"}`, transition:"all .15s",
//           }}>{label}</div>
//         ))}
//       </div>
//     </div>
//   );
// }

// /* ─── SIGNAL BARS ────────────────────────────────────────────── */
// function SignalBars({ features, isPainting }) {
//   const bars = [
//     { key:"magnitudeScore", label:"MAGNITUDE", col:"#4f8ef7", val: features?.magnitudeScore ?? 0 },
//     { key:"stability",      label:"STABILITY",  col:"#a8edea", val: features?.stability ?? 0 },
//     { key:"smoothness",     label:"SMOOTHNESS", col:"#f9c74f", val: features?.smoothness ?? 0 },
//     { key:"resonance",      label:"RESONANCE",  col:"#f72585", val: features?.resonance ?? 0, highlight: true },
//   ];

//   return (
//     <div style={{
//       background:"#080b15", border:"1px solid #161c2a", borderRadius:12,
//       padding:"10px 14px", display:"flex", flexDirection:"column", gap:7,
//       minWidth:130,
//       boxShadow:"inset 0 0 0 1px rgba(79,142,247,.04)",
//     }}>
//       <div style={{ fontSize:8, fontWeight:800, letterSpacing:".18em", color:"#1e2a3a", marginBottom:2, textTransform:"uppercase" }}>
//         ◈ SIGNAL
//       </div>
//       {bars.map(({ key, label, col, val, highlight }) => (
//         <div key={key} style={{ display:"flex", flexDirection:"column", gap:3 }}>
//           <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
//             <span style={{
//               fontSize:8, fontWeight:800, letterSpacing:".12em",
//               color: highlight ? col : "#2a3050",
//               textTransform:"uppercase",
//             }}>{label}</span>
//             <span style={{ fontSize:9, fontWeight:800, color: val > 0.6 ? col : "#2a3050", fontFamily:"'SF Mono', monospace" }}>
//               {Math.round(val * 100)}
//             </span>
//           </div>
//           <div style={{ height:3, background:"#0d1020", borderRadius:2, overflow:"hidden", position:"relative" }}>
//             <div style={{
//               position:"absolute", left:0, top:0, height:"100%",
//               width:`${Math.round(val * 100)}%`,
//               background: highlight
//                 ? `linear-gradient(90deg, #f72585, #f7258588)`
//                 : col,
//               borderRadius:2,
//               boxShadow: highlight && val > 0.5 ? `0 0 6px ${col}88` : "none",
//               transition:"width .08s linear",
//             }} />
//             {/* Gold zone markers for magnitude bar */}
//             {key === "magnitudeScore" && (
//               <>
//                 <div style={{ position:"absolute", left:"25%", top:0, width:1, height:"100%", background:"#f9c74f33" }} />
//                 <div style={{ position:"absolute", left:"32%", top:0, width:1, height:"100%", background:"#f9c74f22" }} />
//                 <div style={{ position:"absolute", left:"33%", top:0, width:1, height:"100%", background:"#f4a26133" }} />
//                 <div style={{ position:"absolute", left:"38%", top:0, width:1, height:"100%", background:"#f4a26122" }} />
//                 <div style={{ position:"absolute", left:"39%", top:0, width:1, height:"100%", background:"#e6394633" }} />
//               </>
//             )}
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// }

// /* ─── PRESSURE GRAPH ─────────────────────────────────────────── */
// function PressureGraph({ pressureHistory, isDrawing, features }) {
//   const graphRef = useRef(null);
//   const containerRef = useRef(null);
//   const [dims, setDims] = useState({ w: 220, h: 100 });

//   useEffect(() => {
//     if (!containerRef.current) return;
//     const ro = new ResizeObserver(entries => {
//       const { width, height } = entries[0].contentRect;
//       setDims({ w: Math.floor(width), h: Math.floor(height) });
//     });
//     ro.observe(containerRef.current);
//     return () => ro.disconnect();
//   }, []);

//   const W = dims.w, H = dims.h;

//   useEffect(() => {
//     const canvas = graphRef.current;
//     if (!canvas) return;
//     const c = canvas.getContext("2d");
//     const dpr = window.devicePixelRatio || 1;
//     c.setTransform(dpr, 0, 0, dpr, 0, 0);
//     const cw = W, ch = H;
//     c.clearRect(0, 0, cw, ch);
//     c.fillStyle = "#0a0c14";
//     c.fillRect(0, 0, cw, ch);

//     // ── Gold zone bands ──
//     // 22ct: 25–32%
//     c.fillStyle = "rgba(249,199,79,0.04)";
//     c.fillRect(0, ch - 0.32 * ch, cw, 0.07 * ch);
//     // 18ct: 33–38%
//     c.fillStyle = "rgba(244,162,97,0.04)";
//     c.fillRect(0, ch - 0.38 * ch, cw, 0.05 * ch);
//     // Spurious: 39%+
//     c.fillStyle = "rgba(230,57,70,0.03)";
//     c.fillRect(0, 0, cw, ch - 0.39 * ch);

//     // Zone labels on right
//     c.font = "bold 7px monospace";
//     c.textAlign = "right";
//     c.fillStyle = "rgba(249,199,79,0.3)";
//     c.fillText("22ct", cw - 3, ch - 0.27 * ch);
//     c.fillStyle = "rgba(244,162,97,0.3)";
//     c.fillText("18ct", cw - 3, ch - 0.35 * ch);
//     c.fillStyle = "rgba(230,57,70,0.25)";
//     c.fillText("SPUR", cw - 3, ch - 0.41 * ch);

//     [0.25, 0.33, 0.39, 0.5, 0.75, 1.0].forEach(v => {
//       const y = ch - v * ch;
//       c.beginPath();
//       c.strokeStyle = "#161c2a";
//       c.lineWidth = 1;
//       c.setLineDash([2, 4]);
//       c.moveTo(0, y); c.lineTo(cw, y); c.stroke();
//       c.setLineDash([]);
//     });

//     [25, 50, 75, 100].forEach(v => {
//       const y = ch - (v / 100) * ch;
//       c.fillStyle = "#2a3050"; c.font = "bold 7px sans-serif";
//       c.textAlign = "left";
//       c.fillText(`${v}`, 3, y - 2);
//     });

//     if (pressureHistory.length < 2) {
//       c.beginPath(); c.strokeStyle = "#1e2a3a"; c.lineWidth = 1;
//       c.setLineDash([3, 5]); c.moveTo(0, ch - 2); c.lineTo(cw, ch - 2); c.stroke();
//       c.setLineDash([]);
//       return;
//     }

//     const pts = pressureHistory.slice(-cw);
//     const step = cw / Math.max(pts.length - 1, 1);

//     // Fill
//     const grad = c.createLinearGradient(0, 0, 0, ch);
//     grad.addColorStop(0, "rgba(247,37,133,0.55)");
//     grad.addColorStop(0.4, "rgba(79,142,247,0.35)");
//     grad.addColorStop(1, "rgba(79,142,247,0.04)");
//     c.beginPath();
//     pts.forEach((p, i) => {
//       const x = i * step, y = ch - p * ch;
//       if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
//     });
//     c.lineTo((pts.length - 1) * step, ch); c.lineTo(0, ch);
//     c.closePath(); c.fillStyle = grad; c.fill();

//     // Line — color by zone
//     c.beginPath();
//     pts.forEach((p, i) => {
//       const x = i * step, y = ch - p * ch;
//       if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
//     });
//     const lineGrad = c.createLinearGradient(0, 0, cw, 0);
//     lineGrad.addColorStop(0, "#4f8ef7");
//     lineGrad.addColorStop(1, "#f72585");
//     c.strokeStyle = lineGrad; c.lineWidth = 1.5;
//     c.lineCap = "round"; c.lineJoin = "round"; c.stroke();

//     // Dot
//     const last = pts[pts.length - 1];
//     const dotX = (pts.length - 1) * step, dotY = ch - last * ch;
//     const glowGrad = c.createRadialGradient(dotX, dotY, 0, dotX, dotY, 6);
//     glowGrad.addColorStop(0, isDrawing ? "rgba(247,37,133,0.9)" : "rgba(79,142,247,0.6)");
//     glowGrad.addColorStop(1, "rgba(0,0,0,0)");
//     c.beginPath(); c.arc(dotX, dotY, 6, 0, Math.PI * 2); c.fillStyle = glowGrad; c.fill();
//     c.beginPath(); c.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
//     c.fillStyle = isDrawing ? "#f72585" : "#4f8ef7"; c.fill();

//     // ── Stability band (rolling std shading) ──
//     if (features && pressureHistory.length >= WINDOW) {
//       const win = pressureHistory.slice(-WINDOW);
//       const wMean = win.reduce((a,b)=>a+b,0)/win.length;
//       const wStd = Math.sqrt(win.reduce((a,b)=>a+Math.pow(b-wMean,2),0)/win.length);
//       const bandTop    = ch - (wMean + wStd) * ch;
//       const bandBottom = ch - Math.max(0, wMean - wStd) * ch;
//       c.fillStyle = "rgba(168,237,234,0.06)";
//       c.fillRect(dotX - 30, bandTop, 30, bandBottom - bandTop);
//     }

//   }, [pressureHistory, isDrawing, features, W, H]);

//   const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

//   return (
//     <div ref={containerRef} style={{
//       position:"relative", border:"1px solid #161c2a", borderRadius:8, overflow:"hidden",
//       boxShadow:"0 4px 20px rgba(0,0,0,.5), inset 0 0 0 1px rgba(79,142,247,.06)",
//       width:"100%", height:"100%", flexShrink:0,
//     }}>
//       <canvas ref={graphRef} width={W * dpr} height={H * dpr} style={{ width:"100%", height:"100%", display:"block" }} />
//       <div style={{ position:"absolute", top:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>100</div>
//       <div style={{ position:"absolute", bottom:4, left:6, fontSize:10, fontWeight:700, color:"#1e2a4a" }}>0</div>
//     </div>
//   );
// }

// /* ─── RESONANCE BADGE ────────────────────────────────────────── */
// function ResonanceBadge({ label, confidence }) {
//   const STYLES = {
//     "22ct":     { col:"#f9c74f", glow:"0 0 32px rgba(249,199,79,.7)", fs:52, sub:"YELLOW GOLD" },
//     "18ct":     { col:"#f4a261", glow:"0 0 32px rgba(244,162,97,.7)", fs:52, sub:"ROSE GOLD" },
//     "Spurious": { col:"#e63946", glow:"0 0 36px rgba(230,57,70,.8)",  fs:38, sub:"NON-GOLD DETECTED" },
//   };
//   const s = label ? STYLES[label] : null;

//   return (
//     <div style={{ minHeight:90, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, width:"100%" }}>
//       {s ? (
//         <>
//           <span style={{
//             fontSize: s.fs, fontWeight:800, letterSpacing:".04em",
//             color: s.col, textShadow: s.glow,
//             transition:"all .15s", lineHeight:1,
//           }}>{label}</span>
//           <div style={{ display:"flex", alignItems:"center", gap:8 }}>
//             <span style={{ fontSize:10, fontWeight:700, color: s.col + "88", letterSpacing:".12em" }}>{s.sub}</span>
//             {label !== "Spurious" && (
//               <div style={{
//                 display:"flex", alignItems:"center", gap:4,
//                 background:"#0a0f1c", borderRadius:50, padding:"2px 8px",
//                 border:`1px solid ${s.col}44`,
//               }}>
//                 <div style={{
//                   width:5, height:5, borderRadius:"50%", background: s.col,
//                   boxShadow:`0 0 6px ${s.col}`,
//                   animation: "pulse 1s infinite",
//                 }}/>
//                 <span style={{ fontSize:9, fontWeight:800, color: s.col, fontFamily:"'SF Mono', monospace" }}>
//                   {Math.round(confidence * 100)}% CONF
//                 </span>
//               </div>
//             )}
//           </div>
//         </>
//       ) : (
//         <span style={{ fontSize:22, fontWeight:700, color:"#1e2430", letterSpacing:".1em" }}>— —</span>
//       )}
//       <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
//     </div>
//   );
// }

// /* ─── MAIN ───────────────────────────────────────────────────── */
// const TOOLS = { PEN:"pen" };
// const hexToRgb = (hex) => ({ r:parseInt(hex.slice(1,3),16), g:parseInt(hex.slice(3,5),16), b:parseInt(hex.slice(5,7),16) });

// export default function Whiteboard() {
//   const canvasRef    = useRef(null);
//   const drawing      = useRef(false);
//   const lastPt       = useRef(null);
//   const lastPres     = useRef(0.5);
//   const snapshotR    = useRef(null);
//   const startPtR     = useRef(null);
//   const decayTimer   = useRef(null);
//   const livePressure = useRef(0);
//   const rafId        = useRef(null);

//   const [pressureHistory, setPressureHistory] = useState([]);
//   const [isPainting, setIsPainting]           = useState(false);
//   const [features, setFeatures]               = useState(null);

//   const tool      = TOOLS.PEN;
//   const color     = "#0d0d0d";
//   const strokeSize = 5;

//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;
//     const dpr = window.devicePixelRatio || 1;
//     canvas.width  = (window.innerWidth / 2) * dpr;
//     canvas.height = window.innerHeight * dpr;
//     const c = canvas.getContext("2d");
//     c.scale(dpr, dpr);
//     c.fillStyle = "#ffffff";
//     c.fillRect(0, 0, window.innerWidth / 2, window.innerHeight);
//   }, []);

//   const ctx    = () => canvasRef.current?.getContext("2d");
//   const getPos = (e) => {
//     const canvas = canvasRef.current;
//     const rect   = canvas.getBoundingClientRect();
//     const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
//     const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? 0);
//     const dpr = window.devicePixelRatio || 1;
//     return { x:(cx-rect.left)*(canvas.width/rect.width/dpr), y:(cy-rect.top)*(canvas.height/rect.height/dpr) };
//   };
//   const getPressure = (e) => Math.max(0.02, Math.min(1, e.pressure ?? 0.5));

//   const pushPressure = useCallback((p) => {
//     setPressureHistory(h => {
//       const next = h.length > 200 ? [...h.slice(-200), p] : [...h, p];
//       const feat = computeSignalFeatures(next);
//       setFeatures(feat);
//       return next;
//     });
//   }, []);

//   const startDecay = () => {
//     if (decayTimer.current) clearInterval(decayTimer.current);
//     decayTimer.current = setInterval(() => {
//       setPressureHistory(h => {
//         if (!h.length) { clearInterval(decayTimer.current); return h; }
//         const last = h[h.length - 1];
//         if (last <= 0.02) { clearInterval(decayTimer.current); return [...h, 0]; }
//         return [...h, Math.max(0, last * 0.82)];
//       });
//     }, 30);
//   };

//   const applyStyle = (c, pressure) => {
//     const {r,g,b} = hexToRgb(color);
//     const alpha = Math.pow(pressure, 0.65);
//     const width = strokeSize * (0.25 + pressure * 0.95);
//     c.globalCompositeOperation = "source-over";
//     c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
//     c.lineWidth   = Math.max(0.5, width);
//     c.lineCap = "round"; c.lineJoin = "round";
//   };

//   // ── RAF loop: pushes current pressure every ~16ms while finger is held ──
//   const startPressureLoop = () => {
//     if (rafId.current) cancelAnimationFrame(rafId.current);
//     const loop = () => {
//       if (!drawing.current) return;
//       pushPressure(livePressure.current);
//       rafId.current = requestAnimationFrame(loop);
//     };
//     rafId.current = requestAnimationFrame(loop);
//   };

//   const stopPressureLoop = () => {
//     if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
//   };

//   const onPointerDown = (e) => {
//     e.preventDefault();
//     if (e.pointerType === "mouse") return;
//     if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
//     if (decayTimer.current) clearInterval(decayTimer.current);
//     const pos = getPos(e), pres = getPressure(e);
//     livePressure.current = pres;
//     drawing.current = true; lastPt.current = pos; lastPres.current = pres;
//     setIsPainting(true);
//     const c = ctx();
//     if (!c) return;
//     snapshotR.current = c.getImageData(0,0,canvasRef.current.width,canvasRef.current.height);
//     startPtR.current  = pos;
//     startPressureLoop();
//   };

//   const onPointerMove = (e) => {
//     e.preventDefault();
//     if (!drawing.current) return;
//     const pos = getPos(e), pres = getPressure(e);
//     livePressure.current = pres; // update live value — RAF loop will push it
//     const c = ctx();
//     if (!c) return;
//     const avgPres = (lastPres.current + pres) / 2;
//     applyStyle(c, avgPres);
//     const mid = { x:(lastPt.current.x+pos.x)/2, y:(lastPt.current.y+pos.y)/2 };
//     c.beginPath(); c.moveTo(lastPt.current.x, lastPt.current.y);
//     c.quadraticCurveTo(lastPt.current.x, lastPt.current.y, mid.x, mid.y);
//     c.stroke();
//     lastPt.current = mid; lastPres.current = pres;
//   };

//   const onPointerUp = () => {
//     stopPressureLoop();
//     drawing.current = false; setIsPainting(false);
//     ctx() && (ctx().globalCompositeOperation = "source-over");
//     setFeatures(null);
//     startDecay();
//   };

//   const currentForce = pressureHistory[pressureHistory.length - 1] ?? 0;

//   return (
//     <div
//       style={{ position:"fixed", inset:0, overflow:"hidden", display:"flex", userSelect:"none", WebkitUserSelect:"none", background:"#080a12" }}
//       onContextMenu={e => e.preventDefault()}
//     >
//       <style>{`*{margin:0;padding:0;box-sizing:border-box;}html,body{width:100%;height:100%;overflow:hidden;background:#080a12;}html{height:-webkit-fill-available;}body{min-height:-webkit-fill-available;}`}</style>
//       <canvas ref={canvasRef} style={{ display:"none" }} />

//       <div
//         style={{
//           width:"100%", height:"100%",
//           display:"flex", flexDirection:"column",
//           alignItems:"center", justifyContent:"space-between",
//           padding:"env(safe-area-inset-top, 20px) 16px env(safe-area-inset-bottom, 16px)",
//           boxSizing:"border-box", touchAction:"none",
//         }}
//         onPointerDown={onPointerDown}
//         onPointerMove={onPointerMove}
//         onPointerUp={onPointerUp}
//         onPointerLeave={onPointerUp}
//         onPointerCancel={onPointerUp}
//       >

//         {/* ── TOP BAR ── */}
//         <div style={{ width:"100%", display:"flex", alignItems:"flex-start", justifyContent:"space-between", paddingTop:4, gap:8 }}>

//           {/* Force meter */}
//           <div style={{
//             background:"#0a0c18", border:"1px solid #161c2a", borderRadius:14,
//             padding:"10px 12px 6px",
//             boxShadow:"0 4px 24px rgba(0,0,0,.6), inset 0 0 0 1px rgba(79,142,247,.05)",
//             display:"flex", flexDirection:"column", alignItems:"center", minWidth:120,
//           }}>
//             <ForceMeter force={currentForce} isActive={isPainting} />
//           </div>

//           {/* Big % + LIVE/IDLE */}
//           <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, paddingTop:12, flex:1 }}>
//             <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
//               <span style={{
//                 fontSize:52, fontWeight:800, lineHeight:1,
//                 background:"linear-gradient(135deg,#4f8ef7,#f72585)",
//                 WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
//               }}>
//                 {Math.round(currentForce * 100)}
//               </span>
//               <span style={{ fontSize:18, color:"#2a3050", fontWeight:700 }}>%</span>
//             </div>
//             <div style={{
//               display:"flex", alignItems:"center", gap:7,
//               background:"#0e1120", borderRadius:50, padding:"5px 12px", border:"1px solid #1a1f36",
//             }}>
//               <div style={{
//                 width:6, height:6, borderRadius:"50%",
//                 background: isPainting ? "#f72585" : "#1e2430",
//                 boxShadow: isPainting ? "0 0 8px #f72585" : "none", transition:"all .2s",
//               }}/>
//               <span style={{ fontSize:10, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase",
//                 color: isPainting ? "#f72585" : "#2a3050", transition:"color .2s" }}>
//                 {isPainting ? "LIVE" : "IDLE"}
//               </span>
//             </div>
//           </div>

//           {/* Signal bars */}
//           <SignalBars features={features} isPainting={isPainting} />
//         </div>

//         {/* ── GRAPH ── */}
//         <div style={{ width:"100%", flex:1, padding:"12px 0" }}>
//           <PressureGraph pressureHistory={pressureHistory} isDrawing={isPainting} features={features} />
//         </div>

//         {/* ── CARAT RESULT ── */}
//         <ResonanceBadge label={features?.label ?? null} confidence={features?.confidence ?? 0} />

//         {/* ── BOTTOM ── */}
//         <div style={{ paddingBottom:4, display:"flex", gap:12, alignItems:"center" }}>
//           <span style={{ fontSize:9, fontWeight:800, color:"#1e2a3a", letterSpacing:".14em", textTransform:"uppercase" }}>✦ GOLD RESONANCE MONITOR</span>
//           {features && (
//             <span style={{ fontSize:9, fontWeight:700, fontFamily:"'SF Mono',monospace", color:"#1e2a3a" }}>
//               CV:{((1 - (features.stability ?? 0)) * 100).toFixed(0)} | dP:{((1 - (features.smoothness ?? 0)) * 100).toFixed(0)}
//             </span>
//           )}
//         </div>

//       </div>
//     </div>
//   );
// }

