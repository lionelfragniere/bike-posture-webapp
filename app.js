// NOTE:
// We intentionally DO NOT import MediaPipe Tasks at top-level.
// If the CDN is blocked (corporate proxy / CSP / offline), a top-level import
// would prevent *all* UI logic from running (including enabling the Load button).
// Instead, we lazy-load the dependency only when the user clicks "Analyze".
let vision = null;

async function loadVision() {
  if (vision) return vision;
  const urls = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
    "https://unpkg.com/@mediapipe/tasks-vision@0.10.14",
  ];
  let lastErr = null;
  for (const u of urls) {
    try {
      vision = await import(u);
      return vision;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Failed to load MediaPipe tasks-vision");
}

const el = (id) => document.getElementById(id);

const fileEl = el("file");
const btnLoad = el("btnLoad");
const btnGrab = el("btnGrab");
const btnAnalyze = el("btnAnalyze");
const btnReset = el("btnReset");

const video = el("video");
const overlay = el("overlay");
const ctx = overlay.getContext("2d");

// Keep overlay canvas visually aligned with the rendered <video> element (no cropping).
function syncOverlayCssSize() {
  const cw = video.clientWidth || 0;
  const ch = video.clientHeight || 0;
  if (cw > 0) overlay.style.width = cw + "px";
  if (ch > 0) overlay.style.height = ch + "px";
  overlay.style.background = "transparent";
}

// Keep overlay aligned to the displayed video size.
try {
  const ro = new ResizeObserver(() => syncOverlayCssSize());
  ro.observe(video);
  window.addEventListener("resize", () => syncOverlayCssSize(), { passive: true });
} catch (e) {
  // ResizeObserver may be unavailable in some embedded browsers; we still sync on load.
}


const statusEl = el("status");
const vidInfo = el("vidInfo");

const btnPick = el("btnPick");
const btnClearPts = el("btnClearPts");
const presetEl = el("preset");
const realMmEl = el("realMm");
const btnSetScale = el("btnSetScale");
const pxDistEl = el("pxDist");
const scaleEl = el("scale");

const resultsEl = el("results");
const btnCopy = el("btnCopy");
const chkOverlay = el("chkOverlay");
const legendEl = el("legend");

let poseLandmarker = null;

// Language (FR default) — lightweight i18n
const langSel = el("langSel");
const tTitle = el("tTitle");
const tSub = el("tSub");
const tLangLabel = el("tLangLabel");
const tStep1 = el("tStep1");
const tStep2 = el("tStep2");
const tStep3 = el("tStep3");
const st1 = el("st1"), st2 = el("st2"), st3 = el("st3");
const st1s = el("st1s"), st2s = el("st2s"), st3s = el("st3s");
const tPreset = el("tPreset");
const tCrankLen = el("tCrankLen");

const crankPreset = el("crankPreset");
const crankMmEl = el("crankMm");

const I18N = {
  fr: {
    title: "Bike Posture Checker (Route) — Import vidéo",
    sub: "Analyse la posture localement dans ton navigateur. Calibre avec une mesure visible dans la vidéo (sans cibles imprimées).",
    lang: "Langue:",
    step1: "Importer la vidéo",
    step2: "Étalonnage (optionnel)",
    step3: "Analyser",
    pending: "en attente",
    optional: "optionnel",
    done: "ok",
    preset: "Préréglage:",
    crank: "Longueur de manivelle:",
    statusIdle: "Inactif",
    statusLoaded: "Vidéo chargée.",
    statusCalibGrabbed: "Image d’étalonnage capturée (pause).",
    statusAnalyzing: "Analyse… (échantillonnage des images)",
    statusDone: "Analyse terminée."
  },
  en: {
    title: "Bike Posture Checker (Road Fit) — Video Upload",
    sub: "Runs pose locally in your browser. Calibrate using a known measurement visible in the video (no printed targets).",
    lang: "Language:",
    step1: "Upload video",
    step2: "Calibration (optional)",
    step3: "Analyze",
    pending: "pending",
    optional: "optional",
    done: "done",
    preset: "Preset:",
    crank: "Crank length:",
    statusIdle: "Idle",
    statusLoaded: "Video loaded.",
    statusCalibGrabbed: "Calibration frame grabbed (paused).",
    statusAnalyzing: "Analyzing… (sampling frames)",
    statusDone: "Analysis completed."
  }
};

let currentLang = "fr";
function tr(key){ return (I18N[currentLang] && I18N[currentLang][key]) || key; }
function applyLang(lang){
  currentLang = (lang === "en") ? "en" : "fr";
  document.documentElement.lang = currentLang;
  if (tTitle) tTitle.textContent = tr("title");
  if (tSub) tSub.textContent = tr("sub");
  if (tLangLabel) tLangLabel.textContent = tr("lang");
  if (tStep1) tStep1.textContent = tr("step1");
  if (tStep2) tStep2.textContent = tr("step2");
  if (tStep3) tStep3.textContent = tr("step3");
  if (st1s) st1s.textContent = tr("pending");
  if (st2s) st2s.textContent = tr("optional");
  if (st3s) st3s.textContent = tr("pending");
  if (tPreset) tPreset.textContent = tr("preset");
  if (tCrankLen) tCrankLen.textContent = tr("crank");
}
if (langSel){
  langSel.addEventListener("change", () => applyLang(langSel.value));
}
applyLang(langSel?.value || "fr");

// Stepper helper
function setStep(step){
  const mark = (el, state) => {
    if (!el) return;
    el.classList.remove("active","done");
    if (state === "active") el.classList.add("active");
    if (state === "done") el.classList.add("done");
  };
  if (step === 1){
    mark(st1,"active"); mark(st2,null); mark(st3,null);
  } else if (step === 2){
    mark(st1,"done"); mark(st2,"active"); mark(st3,null);
  } else if (step === 3){
    mark(st1,"done"); mark(st2, scalePxPerMm ? "done" : null); mark(st3,"active");
  } else if (step === 4){
    mark(st1,"done"); mark(st2, scalePxPerMm ? "done" : null); mark(st3,"done");
  }
}
if (crankPreset && crankMmEl){
  crankPreset.addEventListener("change", () => {
    if (crankPreset.value) crankMmEl.value = crankPreset.value;
  });
}
let running = false;

let videoUrl = null;

// Calibration
let picking = false;
let points = []; // [{x,y}] in canvas coords
let pxPerMm = null;

// Analysis frames (stored for replay overlay)
let analyzedFrames = []; // [{t, side, lms, kneeAng, hipAng, elbowAng, torsoAng, vis, ankleX, kneeX}]
let replayRAF = null;
let lastReplayIdx = 0;

// Model landmark indices (MediaPipe Pose)
const LM = {
  left_shoulder: 11, right_shoulder: 12,
  left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16,
  left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28
};

// Choose one side: use the side with better visibility per frame.
// We'll compute both and take whichever has higher min visibility.
function pickSide(lms) {
  const left = ["left_shoulder","left_hip","left_knee","left_ankle"].map(k => lms[LM[k]]?.visibility ?? 0);
  const right = ["right_shoulder","right_hip","right_knee","right_ankle"].map(k => lms[LM[k]]?.visibility ?? 0);
  const minL = Math.min(...left);
  const minR = Math.min(...right);
  return (minR > minL) ? "right" : "left";
}

function getP(lms, name) {
  return lms?.[LM[name]] ?? null;
}


// ---- Geometry helpers ----
function fitCircleKasa(points){
  // points: [{x,y}] in pixels; returns {cx, cy, r} or null
  if (!points || points.length < 12) return null;
  // Solve x^2 + y^2 = a*x + b*y + c
  let sumX=0,sumY=0,sumXX=0,sumYY=0,sumXY=0,sumZ=0,sumXZ=0,sumYZ=0;
  const n=points.length;
  for (const p of points){
    const x=p.x, y=p.y;
    const z = x*x + y*y;
    sumX += x; sumY += y;
    sumXX += x*x; sumYY += y*y; sumXY += x*y;
    sumZ += z; sumXZ += x*z; sumYZ += y*z;
  }
  // Build normal equations for least squares:
  // [sumXX sumXY sumX] [a] = [sumXZ]
  // [sumXY sumYY sumY] [b] = [sumYZ]
  // [sumX  sumY  n   ] [c] = [sumZ ]
  const A = [
    [sumXX, sumXY, sumX],
    [sumXY, sumYY, sumY],
    [sumX , sumY , n   ],
  ];
  const B = [sumXZ, sumYZ, sumZ];

  function det3(m){
    return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  }
  const D = det3(A);
  if (Math.abs(D) < 1e-9) return null;

  function replaceCol(mat, col, vec){
    const m = mat.map(r => r.slice());
    for (let i=0;i<3;i++) m[i][col]=vec[i];
    return m;
  }
  const Da = det3(replaceCol(A,0,B));
  const Db = det3(replaceCol(A,1,B));
  const Dc = det3(replaceCol(A,2,B));

  const a = Da / D;
  const b = Db / D;
  const c = Dc / D;

  const cx = a/2;
  const cy = b/2;
  const r2 = cx*cx + cy*cy + c;
  if (r2 <= 0) return null;
  return {cx, cy, r: Math.sqrt(r2)};
}

function fmtDeg(x){ return (x==null || !isFinite(x)) ? "—" : `${x.toFixed(1)}°`; }

function angleABC(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.hypot(ba.x, ba.y);
  const magBC = Math.hypot(bc.x, bc.y);
  if (!magBA || !magBC) return null;
  let cos = dot / (magBA * magBC);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function torsoAngle(hip, shoulder) {
  // 0 = horizontal, 90 = vertical
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  let ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (ang > 180) ang -= 180;
  if (ang > 90) ang = 180 - ang;
  return ang;
}

function drawFrame() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  // draw calibration points
  if (points.length) {
    ctx.save();
    ctx.fillStyle = "lime";
    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function setOverlayPointerEvents(enabled) {
  overlay.style.pointerEvents = enabled ? "auto" : "none";
}


// ---- Overlay drawing for fit measures ----
function toPx(p) {
  return { x: p.x * overlay.width, y: p.y * overlay.height };
}

function drawSegment(a, b, color, width=4) {
  if (!a || !b) return;
  const A = toPx(a), B = toPx(b);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  ctx.restore();
}

function drawPoint(p, color, r=6) {
  if (!p) return;
  const P = toPx(p);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLabel(p, text, color) {
  if (!p) return;
  const P = toPx(p);
  ctx.save();
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  const pad = 4;
  const w = ctx.measureText(text).width;
  ctx.fillRect(P.x + 10, P.y - 18, w + pad*2, 18);
  ctx.fillStyle = color;
  ctx.fillText(text, P.x + 10 + pad, P.y - 5);
  ctx.restore();
}

function classifyKnee(k) {
  if (k == null) return null;
  // Road fit starter "good" band (adjustable): 140-150
  if (k >= 140 && k <= 150) return "good";
  return "bad";
}
function classifyElbow(e) {
  if (e == null) return null;
  // Slight bend good; locked/cramped bad
  if (e >= 150 && e <= 170) return "good";
  return "bad";
}
function classifyTorso(t) {
  if (t == null) return null;
  // Broad road range; too low or too upright flagged
  if (t >= 25 && t <= 55) return "good";
  return "bad";
}
function classifyHip(h) {
  if (h == null) return null;
  // Very approximate; keep broad
  if (h >= 70 && h <= 105) return "good";
  return "bad";
}

function legendHTML() {
  return [
    `<div>✅ Knee @ BDC: <span class="k">140–150°</span></div>`,
    `<div>✅ Elbow: <span class="k">150–170°</span> (avoid locked &gt;170°)</div>`,
    `<div>✅ Torso: <span class="k">25–55°</span> (discipline-dependent)</div>`,
    `<div>✅ Hip: <span class="k">70–105°</span> (broad)</div>`,
    `<div class="small muted" style="margin-top:6px;">These are starter thresholds for a road-fit MVP. We can add profiles (race/endurance) later.</div>`
  ].join("");
}

function drawFitOverlay(last) {
  if (!last?.lms) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  // Video itself is visible underneath; canvas draws only overlay.

  const side = last.side;

  const shoulder = getP(last.lms, `${side}_shoulder`);
  const hip = getP(last.lms, `${side}_hip`);
  const knee = getP(last.lms, `${side}_knee`);
  const ankle = getP(last.lms, `${side}_ankle`);
  const elbow = getP(last.lms, `${side}_elbow`);
  const wrist = getP(last.lms, `${side}_wrist`);

  // Colors
  const GREEN = "#1bb35e";
  const RED = "#e43d30";
  const AMBER = "#f0a500";

  const kneeCls = classifyKnee(last.kneeAng);
  const elbowCls = classifyElbow(last.elbowAng);
  const torsoCls = classifyTorso(last.torsoAng);
  const hipCls = classifyHip(last.hipAng);

  const kneeColor = kneeCls === "good" ? GREEN : (kneeCls === "bad" ? RED : AMBER);
  const elbowColor = elbowCls === "good" ? GREEN : (elbowCls === "bad" ? RED : AMBER);
  const torsoColor = torsoCls === "good" ? GREEN : (torsoCls === "bad" ? RED : AMBER);
  const hipColor = hipCls === "good" ? GREEN : (hipCls === "bad" ? RED : AMBER);

  // Skeleton segments
  drawSegment(hip, shoulder, torsoColor, 6);
  drawSegment(shoulder, elbow, elbowColor, 5);
  drawSegment(elbow, wrist, elbowColor, 5);
  drawSegment(hip, knee, kneeColor, 6);
  drawSegment(knee, ankle, kneeColor, 6);

  // Points
  [shoulder, hip, knee, ankle, elbow, wrist].forEach(p => drawPoint(p, "rgba(255,255,255,0.85)", 5));

  // Labels
  drawLabel(knee, `Knee ${fmt(last.kneeAng,1)}°`, kneeColor);
  drawLabel(elbow, `Elbow ${fmt(last.elbowAng,1)}°`, elbowColor);
  drawLabel(hip, `Hip ${fmt(last.hipAng,1)}°`, hipColor);
  // Put torso label near mid-torso
  if (hip && shoulder) {
    const mid = { x: (hip.x + shoulder.x)/2, y: (hip.y + shoulder.y)/2 };
    drawLabel(mid, `Torso ${fmt(last.torsoAng,1)}°`, torsoColor);
  }

  // Redraw calibration points (if any) on top
  if (points.length) {
    ctx.save();
    ctx.fillStyle = "lime";
    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
// ---- end overlay drawing ----

function setStatus(s) { statusEl.textContent = s; }

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function fmt(x, digits=1) {
  if (x == null || Number.isNaN(x)) return "—";
  return Number(x).toFixed(digits);
}

function pxDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateCalibrationUI() {
  if (points.length === 2) {
    const d = pxDistance(points[0], points[1]);
    pxDistEl.textContent = `${d.toFixed(1)} px`;
    btnSetScale.disabled = !(realMmEl.value && Number(realMmEl.value) > 0);
  } else {
    pxDistEl.textContent = "—";
    btnSetScale.disabled = true;
  }
  scaleEl.textContent = pxPerMm ? `${pxPerMm.toFixed(4)}` : "—";
  btnClearPts.disabled = points.length === 0;
}

async function loadModel() {
  if (poseLandmarker) return;
  try {
    setStatus("Loading pose runtime…");
    await loadVision();
  } catch (e) {
    console.error(e);
    setStatus("Failed to load pose runtime. Check DevTools Console / network blocks.");
    throw e;
  }

  setStatus("Loading pose model…");
  // Try multiple CDN bases for the WASM bundle.
  const wasmBases = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/wasm",
  ];
  let filesetResolver = null;
  let lastErr = null;
  for (const base of wasmBases) {
    try {
      filesetResolver = await vision.FilesetResolver.forVisionTasks(base);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!filesetResolver) throw lastErr ?? new Error("Failed to load MediaPipe WASM bundle");
  poseLandmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });
  setStatus("Model ready.");
}

function validateVideoLoaded() {
  return video.src && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
}

function enableControls() {
  btnGrab.disabled = !validateVideoLoaded();
  btnAnalyze.disabled = !validateVideoLoaded();
  btnPick.disabled = !validateVideoLoaded();
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files?.[0];
  btnLoad.disabled = !f;
  if (f) vidInfo.textContent = `${f.name}`;
});

// Initialize legend
if (legendEl) legendEl.innerHTML = legendHTML();

btnLoad.addEventListener("click", async () => {
  const f = fileEl.files?.[0];
  if (!f) return;

  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(f);
  video.src = videoUrl;

  setStatus("Loading video…");
  if (st1s) st1s.textContent = tr("pending");
  setStep(1);

  await new Promise((res) => {
    video.onloadedmetadata = () => res();
  });

  // Set overlay size to maintain aspect ratio (fit width 960)
  const w = 960;
  const ar = video.videoHeight / video.videoWidth;
  overlay.width = w;
  overlay.height = Math.round(w * ar);
  syncOverlayCssSize();

  vidInfo.textContent = `Loaded • ${video.duration.toFixed(1)}s • ${video.videoWidth}×${video.videoHeight}`;
  setStatus(tr("statusLoaded"));
  if (st1s) st1s.textContent = tr("done");
  if (st3s) st3s.textContent = tr("pending");
  setStep(2);

  drawFrame();

  enableControls();
});

btnReset.addEventListener("click", () => {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  video.removeAttribute("src");
  video.load();
  poseLandmarker = null;
  running = false;

  picking = false;
  points = [];
  pxPerMm = null;
  analyzedFrames = [];
  lastReplayIdx = 0;

  pxDistEl.textContent = "—";
  scaleEl.textContent = "—";
  resultsEl.textContent = "Run analysis to see angles + suggestions.";
  vidInfo.textContent = "No video";
  setStatus(tr("statusIdle"));
  if (st1s) st1s.textContent = tr("pending");
  if (st2s) st2s.textContent = tr("optional");
  if (st3s) st3s.textContent = tr("pending");
  setStep(1);


  btnLoad.disabled = !(fileEl.files?.[0]);
  btnGrab.disabled = true;
  btnAnalyze.disabled = true;
  btnPick.disabled = true;
  btnClearPts.disabled = true;
  btnSetScale.disabled = true;
  btnCopy.disabled = true;

  setOverlayPointerEvents(false);

  drawFrame();
});

btnGrab.addEventListener("click", async () => {
  if (!validateVideoLoaded()) return;
  // Pause and draw current frame
  video.pause();
  drawFrame();
  setStatus(tr("statusCalibGrabbed"));
  if (st2s) st2s.textContent = tr("done");
  setStep(3);

});

btnPick.addEventListener("click", () => {
  if (!validateVideoLoaded()) return;
  picking = true;
  points = [];
  pxPerMm = null;
  updateCalibrationUI();
  drawFrame();
  setOverlayPointerEvents(true);
  setStatus("Pick 2 points on the frame (click on the image).");
});

btnClearPts.addEventListener("click", () => {
  points = [];
  pxPerMm = null;
  updateCalibrationUI();
  drawFrame();
  setStatus("Cleared calibration points.");
});

overlay.addEventListener("click", (evt) => {
  if (!picking) return;
  const rect = overlay.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (overlay.width / rect.width);
  const y = (evt.clientY - rect.top) * (overlay.height / rect.height);
  points.push({x,y});
  if (points.length > 2) points = [points[1], points[2]];
  drawFrame();
  updateCalibrationUI();
  if (points.length === 2) {
    setStatus("2 points picked. Enter real distance (mm) and click Set scale.");
  }
});

realMmEl.addEventListener("input", updateCalibrationUI);

// Presets simply fill the "Real distance (mm)" box.
// The user still picks 2 points on the frame that match that real-world distance.
presetEl?.addEventListener("change", () => {
  const v = presetEl.value;
  if (!v) return;
  realMmEl.value = v;
  updateCalibrationUI();
});

btnSetScale.addEventListener("click", () => {
  if (points.length !== 2) return;
  const realMm = Number(realMmEl.value);
  if (!realMm || realMm <= 0) return;
  const dpx = pxDistance(points[0], points[1]);
  pxPerMm = dpx / realMm;
  picking = false;
  setOverlayPointerEvents(false);
  updateCalibrationUI();
  setStatus(`Scale set: ${pxPerMm.toFixed(4)} px/mm`);
});

function toCanvasXY(p) {
  return { x: p.x * overlay.width, y: p.y * overlay.height };
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

function percentile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = (a.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi]-a[lo])*(idx-lo);
}

function nearestFrameIdx(t) {
  const a = analyzedFrames;
  if (!a.length) return -1;
  // Fast path: start search near last index (playback is monotonic)
  let i = lastReplayIdx;
  if (i < 0) i = 0;
  if (i >= a.length) i = a.length - 1;
  if (a[i].t <= t) {
    while (i + 1 < a.length && a[i + 1].t <= t) i++;
  } else {
    while (i - 1 >= 0 && a[i - 1].t >= t) i--;
  }
  // Choose closer of i and i+1
  let best = i;
  if (i + 1 < a.length) {
    const d0 = Math.abs(a[i].t - t);
    const d1 = Math.abs(a[i + 1].t - t);
    if (d1 < d0) best = i + 1;
  }
  lastReplayIdx = best;
  return best;
}

function renderPlaybackOverlay() {
  if (!chkOverlay?.checked) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  const idx = nearestFrameIdx(video.currentTime);
  if (idx < 0) return;
  // Clear and draw overlay only
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawFitOverlay(analyzedFrames[idx]);
}

function startReplayLoop() {
  stopReplayLoop();
  if (!chkOverlay?.checked) return;
  const tick = () => {
    renderPlaybackOverlay();
    if (!video.paused && !video.ended) {
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => tick());
      } else {
        replayRAF = requestAnimationFrame(tick);
      }
    }
  };
  tick();
}

function stopReplayLoop() {
  if (replayRAF) {
    cancelAnimationFrame(replayRAF);
    replayRAF = null;
  }
}

function reportBlock(title, lines) {
  return `<div style="margin:10px 0;">
    <div><b>${title}</b></div>
    <div class="muted">${lines.join("<br/>")}</div>
  </div>`;
}

function mmOrNA(mm) {
  if (mm == null || Number.isNaN(mm)) return "—";
  return `${Math.round(mm)} mm`;
}

btnAnalyze.addEventListener("click", async () => {
  if (!validateVideoLoaded()) return;
  await loadModel();

  if (running) return;
  running = true;

  // Processing parameters (MVP)
  const stepSec = 0.10; // 10 fps sampling
  const maxSec = Math.min(video.duration, 90); // cap
  const startSec = 0.0;

  setStatus(tr("statusAnalyzing"));
  resultsEl.innerHTML = `<div class="muted">Analyzing…</div>`;
  btnCopy.disabled = true;

  // Collect per-frame measurements
  const frames = [];
  let lastGood = null;
  let maxKneeFrame = null;

  let good = 0;
  let total = 0;

  // Ensure paused while seeking
  video.pause();

  // Helper: seek reliably
  const seekTo = (t) => new Promise((res) => {
    const clamped = clamp(t, 0, Math.max(0, video.duration - 0.001));
    video.currentTime = clamped;
    video.onseeked = () => res();
  });

  for (let t = startSec; t <= maxSec; t += stepSec) {
    total += 1;
    await seekTo(t);

    const ts = performance.now();
    const res = poseLandmarker.detectForVideo(video, ts);
    const lms = res?.landmarks?.[0];
    if (!lms) continue;

    const side = pickSide(lms);

    const shoulder = getP(lms, `${side}_shoulder`);
    const hip = getP(lms, `${side}_hip`);
    const knee = getP(lms, `${side}_knee`);
    const ankle = getP(lms, `${side}_ankle`);
    const elbow = getP(lms, `${side}_elbow`);
    const wrist = getP(lms, `${side}_wrist`);

    const vis = Math.min(
      shoulder?.visibility ?? 0, hip?.visibility ?? 0, knee?.visibility ?? 0,
      ankle?.visibility ?? 0, elbow?.visibility ?? 0, wrist?.visibility ?? 0
    );

    if (vis < 0.55) continue;

    // Angles
    const kneeAng = angleABC(hip, knee, ankle);
    const hipAng = angleABC(shoulder, hip, knee);
    const elbowAng = angleABC(shoulder, elbow, wrist);
    const torsoAng = torsoAngle(hip, shoulder);

    // Keep last good frame for overlay
    lastGood = { t, side, lms, kneeAng, hipAng, elbowAng, torsoAng };

    if (kneeAng != null && (!maxKneeFrame || kneeAng > (maxKneeFrame.kneeAng ?? -Infinity))) {
      maxKneeFrame = { t, side, lms, kneeAng, hipAng, elbowAng, torsoAng };
    }

    // For phase proxy: use ankle x in normalized coords
    const ankleX = ankle.x;
    const kneeX = knee.x;

    const frame = { t, side, vis, kneeAng, hipAng, elbowAng, torsoAng, ankleX, kneeX, lms };
    frames.push(frame);
    // Live overlay while analyzing (skeleton + measures)
    if (total % 3 === 0) {
      drawFitOverlay(frame);
      setStatus(`${tr("statusAnalyzing")} ${Math.min(100, Math.round((t/maxSec)*100))}%`);
    }
    good += 1;
  }

  // Persist for replay overlay
  analyzedFrames = frames.slice().sort((a,b)=>a.t-b.t);
  lastReplayIdx = 0;
  drawFrame();

  const goodPct = total ? (100 * good / total) : 0;


  // Crank length sanity check (needs mm scale + user crank length)
  let crankCheckMsg = null;
  const crankUser = crankMmEl && crankMmEl.value ? parseFloat(crankMmEl.value) : null;
  if (pxPerMm && anklePts.length >= 24) {
    const circ = fitCircleKasa(anklePts);
    if (circ && isFinite(circ.r)) {
      const ankleOrbitMm = circ.r / pxPerMm; // NOTE: ankle != pedal spindle; used as a sanity check only
      if (crankUser && isFinite(crankUser)) {
        const diff = Math.abs(ankleOrbitMm - crankUser);
        if (diff > 25) {
          crankCheckMsg = `Crank-length check: your input is <span class="k">${crankUser} mm</span>, but the estimated ankle-orbit radius is <span class="k">${Math.round(ankleOrbitMm)} mm</span>. That gap is large → calibration or side-view geometry may be off (or this estimator is noisy).`;
        } else {
          crankCheckMsg = `Crank-length check: input <span class="k">${crankUser} mm</span> vs estimated ankle-orbit radius <span class="k">${Math.round(ankleOrbitMm)} mm</span> (OK as a rough sanity check).`;
        }
      } else {
        crankCheckMsg = `Crank-length check (optional): estimated ankle-orbit radius is <span class="k">${Math.round(ankleOrbitMm)} mm</span>. Enter your crank length to compare.`;
      }
    }
  } else if (crankUser) {
    crankCheckMsg = `Crank-length check: entered <span class="k">${crankUser} mm</span>, but no mm scale is set — cannot sanity-check.`;
  }


  if (frames.length < 30) {
    setStatus("Not enough confident frames.");
    resultsEl.innerHTML = reportBlock("Problem", [
      `Only ${frames.length} good frames found. Try better lighting, true side view, and keep joints visible.`,
      `Good frame rate: ${goodPct.toFixed(1)}%`
    ]);
    running = false;
    return;
  }

  // Estimate BDC knee angle using top 10% knee angles (max extension)
  const kneeAngles = frames.map(f => f.kneeAng).filter(x => x != null);
  const kneeP90 = percentile(kneeAngles, 0.90);
  const bdcFrames = frames.filter(f => f.kneeAng != null && f.kneeAng >= kneeP90);
  const kneeBDC = mean(bdcFrames.map(f => f.kneeAng));

  // Estimate 3 o'clock using ankleX max (most forward)
  const ankleXs = frames.map(f => f.ankleX);
  const ankleX95 = percentile(ankleXs, 0.95);
  const threeFrames = frames.filter(f => f.ankleX >= ankleX95);
  const kopsPx = (() => {
    if (!threeFrames.length) return null;
    // knee x - ankle x at that phase, in pixels
    const diffs = threeFrames.map(f => (f.kneeX - f.ankleX) * overlay.width);
    return mean(diffs);
  })();

  // Other average angles (steady posture)
  const torsoAvg = mean(frames.map(f => f.torsoAng).filter(x => x != null));
  const hipAvg = mean(frames.map(f => f.hipAng).filter(x => x != null));
  const elbowAvg = mean(frames.map(f => f.elbowAng).filter(x => x != null));

  // --- Recommendations (heuristic MVP) ---
  // Targets (road fit starter)
  const targetKneeBDC = 145; // degrees
  const kneeMmPerDeg = 2.5;  // heuristic conversion

  let saddleDeltaMm = null;
  if (kneeBDC != null) {
    saddleDeltaMm = (targetKneeBDC - kneeBDC) * kneeMmPerDeg;
    saddleDeltaMm = clamp(saddleDeltaMm, -20, 20); // conservative
  }

  // KOPS target: knee roughly over pedal spindle => kneeX - ankleX ~ 0 (proxy)
  // Note: we use ankle as pedal spindle proxy; sign indicates ahead/behind.
  let foreAftDeltaMm = null;
  if (kopsPx != null && pxPerMm) {
    const kopsMm = kopsPx / pxPerMm;
    // If knee is ahead of ankle (positive), move saddle back (negative)
    foreAftDeltaMm = -kopsMm;
    foreAftDeltaMm = clamp(foreAftDeltaMm, -15, 15);
  }

  // Reach/stem suggestion: based on elbow angle only (mm mapping is coarse)
  let stemDeltaMm = null;
  if (elbowAvg != null) {
    if (elbowAvg > 170) stemDeltaMm = -15;
    else if (elbowAvg > 165) stemDeltaMm = -10;
    else if (elbowAvg < 145) stemDeltaMm = +10;
    else stemDeltaMm = 0;
  }

  // If no scale, we can still show mm deltas for saddle height (angle-based) but mark as "estimated".
  const mmAvailable = !!pxPerMm;

  const warnings = [];
  if (!pxPerMm) warnings.push("No scale set: only angle-based mm estimate for saddle height; fore-aft needs calibration.");
  if (goodPct < 40) warnings.push("Low good-frame ratio: results may be noisy.");
  if (video.duration > 90) warnings.push("Long video: analysis capped at first 90 seconds.");

  // Render
  const blocks = [];

  blocks.push(reportBlock("Quality", [
    `Frames sampled: ${total} • good: ${good} (${goodPct.toFixed(1)}%)`,
    `Side used: auto (per frame best visibility)`
  ]));

  blocks.push(reportBlock("Angles (road fit)", [
    `Knee angle @ BDC (estimated): <span class="k">${fmt(kneeBDC,1)}°</span> (target ~${targetKneeBDC}°)`,
    `Hip angle (avg): <span class="k">${fmt(hipAvg,1)}°</span>`,
    `Torso angle (avg): <span class="k">${fmt(torsoAvg,1)}°</span>`,
    `Elbow angle (avg): <span class="k">${fmt(elbowAvg,1)}°</span>`
  ]));

  const recLines = [];

  if (kneeBDC != null) {
    const dir = saddleDeltaMm > 0 ? "Raise" : (saddleDeltaMm < 0 ? "Lower" : "Keep");
    recLines.push(`${dir} saddle height by <span class="k">${mmOrNA(Math.abs(saddleDeltaMm))}</span> (conservative step; re-test).`);
  } else {
    recLines.push("Saddle height: — (knee angle not detected reliably).");
  }

  if (kopsPx != null) {
    if (pxPerMm) {
      const dir = foreAftDeltaMm > 0 ? "Move saddle forward" : (foreAftDeltaMm < 0 ? "Move saddle back" : "Keep");
      recLines.push(`${dir} by <span class="k">${mmOrNA(Math.abs(foreAftDeltaMm))}</span> (KOPS proxy at ~3 o'clock).`);
    } else {
      recLines.push("Saddle fore-aft: needs scale calibration (set px/mm).");
    }
  } else {
    recLines.push("Saddle fore-aft: — (3 o'clock phase not detected reliably).");
  }

  if (stemDeltaMm != null) {
    if (stemDeltaMm === 0) recLines.push("Reach/stem: looks OK (elbows not locked/cramped).");
    else if (stemDeltaMm < 0) recLines.push(`Reach/stem: consider a <span class="k">${Math.abs(stemDeltaMm)} mm shorter</span> stem (elbows too open).`);
    else recLines.push(`Reach/stem: consider a <span class="k">${stemDeltaMm} mm longer</span> stem (elbows very closed).`);
  }

  blocks.push(reportBlock("Concrete corrections (starter)", recLines));

  if (crankCheckMsg) {
    blocks.push(reportBlock("Crank-length sanity check", [crankCheckMsg]));
  }

  if (warnings.length) {
    blocks.push(reportBlock("Warnings", warnings.map(w => `<span class="warn">${w}</span>`)));
  }

  // Clipboard report
  const reportText = [
    "Bike Posture Checker Report",
    `Video: ${vidInfo.textContent}`,
    `Frames sampled: ${total}, good: ${good} (${goodPct.toFixed(1)}%)`,
    `Scale (px/mm): ${pxPerMm ? pxPerMm.toFixed(4) : "N/A"}`,
    "",
    `Knee @ BDC: ${fmt(kneeBDC,1)}° (target ~${targetKneeBDC}°)`,
    `Hip avg: ${fmt(hipAvg,1)}°`,
    `Torso avg: ${fmt(torsoAvg,1)}°`,
    `Elbow avg: ${fmt(elbowAvg,1)}°`,
    "",
    `Saddle height delta: ${saddleDeltaMm != null ? Math.round(saddleDeltaMm) + " mm" : "N/A"} (positive=raise)`,
    `Saddle fore-aft delta: ${foreAftDeltaMm != null ? Math.round(foreAftDeltaMm) + " mm" : "N/A"} (positive=forward)`,
    `Stem suggestion: ${stemDeltaMm != null ? stemDeltaMm + " mm" : "N/A"} (negative=shorter)`,
    "",
    ...(warnings.length ? ["Warnings:", ...warnings.map(w => "- " + w)] : [])
  ].join("\n");

  resultsEl.innerHTML = blocks.join("\n");
  btnCopy.disabled = false;

  btnCopy.onclick = async () => {
    await navigator.clipboard.writeText(reportText);
    setStatus("Report copied to clipboard.");
  };

  // Draw overlay on the frame where knee angle is highest (max extension)
  try {
    const best = maxKneeFrame || lastGood;
    if (best) {
      await seekTo(best.t);
      drawFitOverlay(best);
    }
  } catch (e) {
    console.warn("Overlay draw failed", e);
  }

  setStatus(tr("statusDone"));
  if (st3s) st3s.textContent = tr("done");
  setStep(4);

  running = false;
});

// Playback overlay controls
chkOverlay?.addEventListener("change", () => {
  if (chkOverlay.checked) {
    // Require analysis frames
    if (!analyzedFrames.length) {
      setStatus("Enable overlay: run Analyze first.");
      chkOverlay.checked = false;
      return;
    }
    renderPlaybackOverlay();
    if (!video.paused && !video.ended) startReplayLoop();
  } else {
    stopReplayLoop();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawFrame();
  }
});

video.addEventListener("play", () => {
  if (chkOverlay?.checked) startReplayLoop();
});
video.addEventListener("pause", () => {
  stopReplayLoop();
  if (chkOverlay?.checked) renderPlaybackOverlay();
});
video.addEventListener("ended", () => {
  stopReplayLoop();
  if (chkOverlay?.checked) renderPlaybackOverlay();
});
video.addEventListener("seeked", () => {
  lastReplayIdx = 0;
  if (chkOverlay?.checked) renderPlaybackOverlay();
});
