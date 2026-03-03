// ===========================================================
// BIKE POSTURE CHECKER — app.js
// ===========================================================
// i18n: t(), setLang(), TRANSLATIONS are defined globally in index.html <script>.
// This module calls t(key) to get translated strings.

// ---- MediaPipe lazy-load ----
let vision = null;

async function loadVision() {
  if (vision) return vision;
  const urls = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
    "https://unpkg.com/@mediapipe/tasks-vision@0.10.14",
  ];
  let lastErr = null;
  for (const u of urls) {
    try { vision = await import(u); return vision; }
    catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("Failed to load MediaPipe tasks-vision");
}

// ---- DOM refs ----
const el = (id) => document.getElementById(id);

const fileEl = el("file");
const btnLoad = el("btnLoad");
const btnGrab = el("btnGrab");
const btnAnalyze = el("btnAnalyze");
const btnReset = el("btnReset");
const video = el("video");
const overlay = el("overlay");
const ctx = overlay.getContext("2d");
const statusEl = el("status");
const statusDot = el("statusDot");
const pxDistEl = el("pxDist");
const scaleEl = el("scale");
const resultsEl = el("results");
const btnCopy = el("btnCopy");
const btnPick = el("btnPick");
const btnClearPts = el("btnClearPts");
const presetEl = el("preset");
const realMmEl = el("realMm");
const btnSetScale = el("btnSetScale");
const progressBar = el("progressBar");
const progressDetail = el("progressDetail");
const analysisProgress = el("analysisProgress");
const pickDot1 = el("pickDot1");
const pickDot2 = el("pickDot2");
const pickStatusText = el("pickStatusText");
const fileInfo = el("fileInfo");
const fileName = el("fileName");
const fileMetaText = el("fileMetaText");
const uploadZone = el("uploadZone");
const overlayToggleRow = el("overlayToggleRow");

// ---- State ----
let poseLandmarker = null;
let running = false;
let videoUrl = null;
let picking = false;
let points = [];
let pxPerMm = null;
let analyzedFrames = [];
let replayRAF = null;
let lastReplayIdx = 0;

// ---- Wizard step ----
let currentStep = 1;
let stepUnlocked = [true, false, false, false];

function goToStep(n) {
  if (n < 1 || n > 4) return;
  if (!stepUnlocked[n - 1]) return;
  currentStep = n;
  for (let i = 1; i <= 4; i++) {
    const content = el(`stepContent${i}`);
    const tab = el(`tab${i}`);
    if (content) content.style.display = i === n ? "" : "none";
    if (tab) {
      tab.classList.toggle("active", i === n);
      tab.classList.remove("disabled");
      if (!stepUnlocked[i - 1]) tab.classList.add("disabled");
    }
  }
  if (n === 1) {
    placePlayer(null);
  } else if (n === 2) {
    placePlayer("player2");
  } else if (n === 4) {
    placePlayer("player4wrap");
  }
}

function unlockStep(n) {
  stepUnlocked[n - 1] = true;
  const tab = el(`tab${n}`);
  if (tab) tab.classList.remove("disabled");
}

function markStepComplete(n) {
  const tab = el(`tab${n}`);
  if (tab) tab.classList.add("completed");
  const numEl = tab?.querySelector(".step-num");
  if (numEl) numEl.textContent = "✓";
}

// ---- Player placement ----
const playerDiv = el("player");
let playerTarget = null;

function placePlayer(targetId) {
  if (targetId === playerTarget) return;
  playerTarget = targetId;
  playerDiv.style.display = "block";

  const target = targetId ? el(targetId) : null;
  if (target) {
    target.appendChild(playerDiv);
  } else {
    const step1 = el("stepContent1");
    const ref = el("overlayToggleRow");
    if (ref && step1.contains(ref)) {
      step1.insertBefore(playerDiv, ref);
    } else {
      step1.appendChild(playerDiv);
    }
  }
  syncOverlayCssSize();
}

// ---- Overlay sync ----
function syncOverlayCssSize() {
  const cw = video.clientWidth || 0;
  const ch = video.clientHeight || 0;
  if (cw > 0) overlay.style.width = cw + "px";
  if (ch > 0) overlay.style.height = ch + "px";
  overlay.style.background = "transparent";
}

try {
  const ro = new ResizeObserver(() => syncOverlayCssSize());
  ro.observe(video);
  window.addEventListener("resize", () => syncOverlayCssSize(), { passive: true });
} catch (e) { }

// ---- Status ----
function setStatus(key, extra = "") {
  const msg = t(key) + (extra ? " " + extra : "");
  statusEl.textContent = msg;
  statusEl.dataset.statusKey = key;
  statusEl.dataset.statusExtra = extra;

  const isActive = ["statusLoading", "statusAnalyzing"].includes(key);
  const isError = key === "statusError";
  statusDot.className = "status-dot" + (isActive ? " active" : isError ? " error" : "");
}

// ---- Pose model ----
const LM = {
  left_shoulder: 11, right_shoulder: 12,
  left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16,
  left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28
};

function pickSide(lms) {
  const left = ["left_shoulder", "left_hip", "left_knee", "left_ankle"].map(k => lms[LM[k]]?.visibility ?? 0);
  const right = ["right_shoulder", "right_hip", "right_knee", "right_ankle"].map(k => lms[LM[k]]?.visibility ?? 0);
  return (Math.min(...right) > Math.min(...left)) ? "right" : "left";
}

function getP(lms, name) { return lms?.[LM[name]] ?? null; }

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
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  let ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (ang > 180) ang -= 180;
  if (ang > 90) ang = 180 - ang;
  return ang;
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function fmt(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return "—";
  return Number(x).toFixed(digits);
}

function pxDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (a.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

function mmOrNA(mm) {
  if (mm == null || Number.isNaN(mm)) return "—";
  return `${Math.round(mm)} mm`;
}

// ---- Canvas drawing ----
function toPx(p) { return { x: p.x * overlay.width, y: p.y * overlay.height }; }

function drawSegment(a, b, color, width = 4) {
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

function drawPoint(p, color, r = 6) {
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
  ctx.font = "bold 13px Inter, system-ui, sans-serif";
  const pad = 5;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(10,12,20,0.8)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(P.x + 10, P.y - 20, w + pad * 2, 22, 6);
    ctx.fill();
  } else {
    ctx.fillRect(P.x + 10, P.y - 20, w + pad * 2, 22);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, P.x + 10 + pad, P.y - 4);
  ctx.restore();
}

function drawCalibPoints() {
  if (!points.length) return;
  ctx.save();
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#4f7df7";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (points.length === 2) {
    ctx.strokeStyle = "rgba(79,125,247,0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawFrame() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawCalibPoints();
}

function setOverlayPointerEvents(enabled) {
  overlay.style.pointerEvents = enabled ? "auto" : "none";
}

// ---- Classify ----
function classifyKnee(k) { return k == null ? null : (k >= 140 && k <= 150) ? "good" : "bad"; }
function classifyElbow(e) { return e == null ? null : (e >= 150 && e <= 170) ? "good" : "bad"; }
function classifyTorso(v) { return v == null ? null : (v >= 25 && v <= 55) ? "good" : "bad"; }
function classifyHip(h) { return h == null ? null : (h >= 70 && h <= 105) ? "good" : "bad"; }

const GREEN = "#22c55e";
const RED = "#ef4444";
const AMBER = "#f59e0b";
function colorOf(cls) { return cls === "good" ? GREEN : cls === "bad" ? RED : AMBER; }

function drawFitOverlay(last) {
  if (!last?.lms) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const side = last.side;
  const shoulder = getP(last.lms, `${side}_shoulder`);
  const hip = getP(last.lms, `${side}_hip`);
  const knee = getP(last.lms, `${side}_knee`);
  const ankle = getP(last.lms, `${side}_ankle`);
  const elbow = getP(last.lms, `${side}_elbow`);
  const wrist = getP(last.lms, `${side}_wrist`);

  const kneeCls = classifyKnee(last.kneeAng);
  const elbowCls = classifyElbow(last.elbowAng);
  const torsoCls = classifyTorso(last.torsoAng);
  const hipCls = classifyHip(last.hipAng);

  drawSegment(hip, shoulder, colorOf(torsoCls), 5);
  drawSegment(shoulder, elbow, colorOf(elbowCls), 4);
  drawSegment(elbow, wrist, colorOf(elbowCls), 4);
  drawSegment(hip, knee, colorOf(kneeCls), 5);
  drawSegment(knee, ankle, colorOf(kneeCls), 5);
  [shoulder, hip, knee, ankle, elbow, wrist].forEach(p => drawPoint(p, "rgba(255,255,255,0.9)", 5));

  drawLabel(knee, `Knee ${fmt(last.kneeAng, 1)}°`, colorOf(kneeCls));
  drawLabel(elbow, `Elbow ${fmt(last.elbowAng, 1)}°`, colorOf(elbowCls));
  drawLabel(hip, `Hip ${fmt(last.hipAng, 1)}°`, colorOf(hipCls));
  if (hip && shoulder) {
    const mid = { x: (hip.x + shoulder.x) / 2, y: (hip.y + shoulder.y) / 2 };
    drawLabel(mid, `Torso ${fmt(last.torsoAng, 1)}°`, colorOf(torsoCls));
  }
  drawCalibPoints();
}

// ---- Calibration UI ----
function updatePickStatusText() {
  if (!pickStatusText) return;
  if (points.length === 0) {
    pickStatusText.innerHTML = t("pickWaiting");
    pickDot1.classList.remove("set"); pickDot1.textContent = "P1";
    pickDot2.classList.remove("set"); pickDot2.textContent = "P2";
  } else if (points.length === 1) {
    pickStatusText.innerHTML = t("pickPoint2");
    pickDot1.classList.add("set"); pickDot1.textContent = "✓";
    pickDot2.classList.remove("set"); pickDot2.textContent = "P2";
  } else {
    pickStatusText.innerHTML = t("pickDone");
    pickDot1.classList.add("set"); pickDot1.textContent = "✓";
    pickDot2.classList.add("set"); pickDot2.textContent = "✓";
  }
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
  updatePickStatusText();
}

// ---- Model loading ----
async function loadModel() {
  if (poseLandmarker) return;
  try {
    setStatus("statusLoading");
    await loadVision();
  } catch (e) {
    console.error(e);
    setStatus("statusError");
    throw e;
  }
  setStatus("statusAnalyzing");
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
    } catch (e) { lastErr = e; }
  }
  if (!filesetResolver) throw lastErr ?? new Error("Failed to load MediaPipe WASM");
  poseLandmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });
}

// ---- Video validation ----
function validateVideoLoaded() {
  return video.src && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
}

function enableControls() {
  btnGrab.disabled = !validateVideoLoaded();
  btnAnalyze.disabled = !validateVideoLoaded();
  btnPick.disabled = !validateVideoLoaded();
}

// ---- File input & auto-load ----
async function doLoadVideo(f) {
  if (!f) return;
  fileName.textContent = f.name;
  fileMetaText.textContent = `${(f.size / 1e6).toFixed(1)} MB`;
  fileInfo.classList.add("visible");
  uploadZone.classList.add("has-file");

  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(f);
  video.src = videoUrl;
  setStatus("statusLoading");
  await new Promise((res) => { video.onloadedmetadata = () => res(); });
  const w = 960;
  const ar = video.videoHeight / video.videoWidth;
  overlay.width = w;
  overlay.height = Math.round(w * ar);
  syncOverlayCssSize();
  fileMetaText.textContent = `${video.duration.toFixed(1)}s · ${video.videoWidth}×${video.videoHeight}`;
  setStatus("statusLoaded");
  drawFrame();
  enableControls();
  el("player").style.display = "block";
  overlayToggleRow.style.display = "flex";
  // Hide placeholder, show video
  const placeholder = el("step1Placeholder");
  if (placeholder) placeholder.style.display = "none";
  unlockStep(2);
  unlockStep(3);
  markStepComplete(1);
  el("resultsCard").style.display = "block";
  el("exportCard").style.display = "block";
  // Show Next: Calibrate button
  const btnNextCal = el("btnNextCalibrate");
  if (btnNextCal) btnNextCal.style.display = "";
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files?.[0];
  if (f) doLoadVideo(f);
});

uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const f = e.dataTransfer.files?.[0];
  if (f && f.type.startsWith("video/")) {
    doLoadVideo(f);
  }
});

// ---- Load button (hidden, kept for API compat) ----
btnLoad.addEventListener("click", async () => {
  const f = fileEl.files?.[0];
  if (f) doLoadVideo(f);
});

// ---- Reset ----
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
  resultsEl.innerHTML = `<span style="color:var(--text3);">${t("resultsWait")}</span>`;
  setStatus("statusIdle");

  btnLoad.disabled = !(fileEl.files?.[0]);
  btnGrab.disabled = true;
  btnAnalyze.disabled = true;
  btnPick.disabled = true;
  btnClearPts.disabled = true;
  btnSetScale.disabled = true;
  btnCopy.disabled = true;
  const saveTxtBtn2 = el("btnSaveTxt");
  if (saveTxtBtn2) saveTxtBtn2.disabled = true;
  savedReportText = "";

  const btnNextCal = el("btnNextCalibrate");
  if (btnNextCal) btnNextCal.style.display = "none";
  // Show placeholder image again
  const placeholder = el("step1Placeholder");
  if (placeholder) placeholder.style.display = "";

  fileInfo.classList.remove("visible");
  uploadZone.classList.remove("has-file");
  el("player").style.display = "none";
  overlayToggleRow.style.display = "none";
  el("resultsCard").style.display = "none";
  el("exportCard").style.display = "none";

  progressBar.style.width = "0%";
  progressDetail.textContent = "0%";
  analysisProgress.style.display = "none";

  setOverlayPointerEvents(false);
  drawFrame();

  stepUnlocked = [true, false, false, false];
  for (let i = 1; i <= 4; i++) {
    const tab = el(`tab${i}`);
    if (tab) {
      tab.classList.remove("completed", "active", "disabled");
      const num = tab.querySelector(".step-num");
      if (num) num.textContent = i;
      if (i === 1) tab.classList.add("active");
      else tab.classList.add("disabled");
    }
  }
  placePlayer(null);
  goToStep(1);
  updateCalibrationUI();
});

// ---- Grab calibration frame ----
btnGrab.addEventListener("click", async () => {
  if (!validateVideoLoaded()) return;
  video.pause();
  drawFrame();
  setStatus("statusGrabbed");
});

// ---- Pick points ----
btnPick.addEventListener("click", () => {
  if (!validateVideoLoaded()) return;
  picking = true;
  points = [];
  pxPerMm = null;
  updateCalibrationUI();
  drawFrame();
  setOverlayPointerEvents(true);
  setStatus("statusPickMode");
});

btnClearPts.addEventListener("click", () => {
  points = [];
  pxPerMm = null;
  updateCalibrationUI();
  drawFrame();
  setStatus("statusClearPts");
});

overlay.addEventListener("click", (evt) => {
  if (!picking) return;
  const rect = overlay.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (overlay.width / rect.width);
  const y = (evt.clientY - rect.top) * (overlay.height / rect.height);
  points.push({ x, y });
  if (points.length > 2) points = [points[1], points[2]];
  drawFrame();
  updateCalibrationUI();
  if (points.length === 2) {
    picking = false;
    setOverlayPointerEvents(false);
  }
});

realMmEl.addEventListener("input", updateCalibrationUI);

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
  setStatus("statusScaleSet", `${pxPerMm.toFixed(4)} px/mm`);
  markStepComplete(2);
});

// ---- Replay overlay ----
function nearestFrameIdx(t) {
  const a = analyzedFrames;
  if (!a.length) return -1;
  let i = lastReplayIdx;
  if (i < 0) i = 0;
  if (i >= a.length) i = a.length - 1;
  if (a[i].t <= t) {
    while (i + 1 < a.length && a[i + 1].t <= t) i++;
  } else {
    while (i - 1 >= 0 && a[i - 1].t >= t) i--;
  }
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
  const chk = el("chkOverlay4");
  if (!chk?.checked) { ctx.clearRect(0, 0, overlay.width, overlay.height); return; }
  const idx = nearestFrameIdx(video.currentTime);
  if (idx < 0) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawFitOverlay(analyzedFrames[idx]);
}

function startReplayLoop() {
  stopReplayLoop();
  const chk = el("chkOverlay4");
  if (!chk?.checked) return;
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
  if (replayRAF) { cancelAnimationFrame(replayRAF); replayRAF = null; }
}

el("chkOverlay4")?.addEventListener("change", () => {
  const chk = el("chkOverlay4");
  if (chk.checked) {
    if (!analyzedFrames.length) { chk.checked = false; return; }
    renderPlaybackOverlay();
    if (!video.paused && !video.ended) startReplayLoop();
  } else {
    stopReplayLoop();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawFrame();
  }
});

video.addEventListener("play", () => { if (el("chkOverlay4")?.checked) startReplayLoop(); });
video.addEventListener("pause", () => { stopReplayLoop(); if (el("chkOverlay4")?.checked) renderPlaybackOverlay(); });
video.addEventListener("ended", () => { stopReplayLoop(); if (el("chkOverlay4")?.checked) renderPlaybackOverlay(); });
video.addEventListener("seeked", () => { lastReplayIdx = 0; if (el("chkOverlay4")?.checked) renderPlaybackOverlay(); });

// ---- Analysis ----
btnAnalyze.addEventListener("click", async () => {
  if (!validateVideoLoaded()) return;
  goToStep(3);
  analysisProgress.style.display = "block";
  try { await loadModel(); }
  catch (e) { setStatus("statusError"); analysisProgress.style.display = "none"; return; }
  if (running) return;
  running = true;
  btnAnalyze.disabled = true;

  const stepSec = 0.10;
  const maxSec = Math.min(video.duration, 90);
  setStatus("statusAnalyzing");
  resultsEl.innerHTML = `<span style="color:var(--text3);">${t("analyzing")}</span>`;
  btnCopy.disabled = true;

  const frames = [];
  let lastGood = null;
  let maxKneeFrame = null;
  let good = 0;
  let total = 0;

  video.pause();
  const seekTo = (sec) => new Promise((res) => {
    const clamped = clamp(sec, 0, Math.max(0, video.duration - 0.001));
    video.currentTime = clamped;
    video.onseeked = () => res();
  });

  for (let sec = 0; sec <= maxSec; sec += stepSec) {
    total += 1;
    await seekTo(sec);
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

    const kneeAng = angleABC(hip, knee, ankle);
    const hipAng = angleABC(shoulder, hip, knee);
    const elbowAng = angleABC(shoulder, elbow, wrist);
    const torsoAng = torsoAngle(hip, shoulder);

    lastGood = { sec, side, lms, kneeAng, hipAng, elbowAng, torsoAng };
    if (kneeAng != null && (!maxKneeFrame || kneeAng > (maxKneeFrame.kneeAng ?? -Infinity))) {
      maxKneeFrame = { t: sec, side, lms, kneeAng, hipAng, elbowAng, torsoAng };
    }

    const frame = { t: sec, side, vis, kneeAng, hipAng, elbowAng, torsoAng, ankleX: ankle.x, kneeX: knee.x, lms };
    frames.push(frame);

    if (total % 3 === 0) {
      drawFitOverlay(frame);
      const pct = Math.min(100, Math.round((sec / maxSec) * 100));
      progressBar.style.width = pct + "%";
      progressDetail.textContent = `${pct}%`;
    }
    good += 1;
  }

  analyzedFrames = frames.slice().sort((a, b) => a.t - b.t);
  lastReplayIdx = 0;
  drawFrame();

  const goodPct = total ? (100 * good / total) : 0;
  progressBar.style.width = "100%";
  progressDetail.textContent = "100%";

  if (frames.length < 30) {
    setStatus("statusNotEnough");
    resultsEl.innerHTML = buildResultBlock(t("rProblem"), [
      `${frames.length} ${t("rNotEnough")}`,
      `${t("rGoodRate")} ${goodPct.toFixed(1)}%`
    ]);
    running = false;
    btnAnalyze.disabled = false;
    return;
  }

  // Stats
  const kneeAngles = frames.map(f => f.kneeAng).filter(x => x != null);
  const kneeP90 = percentile(kneeAngles, 0.90);
  const kneeBDC = mean(frames.filter(f => f.kneeAng != null && f.kneeAng >= kneeP90).map(f => f.kneeAng));

  const ankleXs = frames.map(f => f.ankleX);
  const ankleX95 = percentile(ankleXs, 0.95);
  const threeFrames = frames.filter(f => f.ankleX >= ankleX95);
  const kopsPx = threeFrames.length ? mean(threeFrames.map(f => (f.kneeX - f.ankleX) * overlay.width)) : null;

  const torsoAvg = mean(frames.map(f => f.torsoAng).filter(x => x != null));
  const hipAvg = mean(frames.map(f => f.hipAng).filter(x => x != null));
  const elbowAvg = mean(frames.map(f => f.elbowAng).filter(x => x != null));

  const targetKneeBDC = 145;
  let saddleDeltaMm = kneeBDC != null ? clamp((targetKneeBDC - kneeBDC) * 2.5, -20, 20) : null;
  let foreAftDeltaMm = (kopsPx != null && pxPerMm) ? clamp(-kopsPx / pxPerMm, -15, 15) : null;
  let stemDeltaMm = elbowAvg == null ? null : elbowAvg > 170 ? -15 : elbowAvg > 165 ? -10 : elbowAvg < 145 ? 10 : 0;

  const warnings = [];
  if (!pxPerMm) warnings.push(t("wNoScale"));
  if (goodPct < 40) warnings.push(t("wLowGood"));
  if (video.duration > 90) warnings.push(t("wLongVideo"));

  // Build results
  const blocks = [];
  blocks.push(buildResultBlock(t("rQuality"), [
    `${t("rFrames")}: ${total} &nbsp;·&nbsp; ${t("rGood")}: ${good} (${goodPct.toFixed(1)}%)`,
    t("rSide")
  ]));

  blocks.push(buildMetricGrid([
    { label: `🦵 ${t("legendKnee")}`, val: fmt(kneeBDC, 1) + "°", cls: classifyKnee(kneeBDC), note: `${t("rTarget")} 140–150°` },
    { label: `💪 ${t("legendElbow")}`, val: fmt(elbowAvg, 1) + "°", cls: classifyElbow(elbowAvg), note: `${t("rTarget")} 150–170°` },
    { label: `🏋 ${t("legendTorso")}`, val: fmt(torsoAvg, 1) + "°", cls: classifyTorso(torsoAvg), note: `${t("rTarget")} 25–55°` },
    { label: `⚙ ${t("legendHip")}`, val: fmt(hipAvg, 1) + "°", cls: classifyHip(hipAvg), note: `${t("rTarget")} 70–105°` },
  ]));

  const recLines = [];
  if (kneeBDC != null) {
    const dir = saddleDeltaMm > 0 ? t("rRaise") : saddleDeltaMm < 0 ? t("rLower") : t("rKeep");
    recLines.push(`${dir} ${t("rSaddleH")} <span class="k">${mmOrNA(Math.abs(saddleDeltaMm))}</span> ${t("rRetest")}`);
  } else { recLines.push(t("rSaddleHNA")); }

  if (kopsPx != null) {
    if (pxPerMm) {
      const dir = foreAftDeltaMm > 0 ? t("rSaddleFA_fwd") : foreAftDeltaMm < 0 ? t("rSaddleFA_back") : t("rSaddleFA_keep");
      recLines.push(`${dir} <span class="k">${mmOrNA(Math.abs(foreAftDeltaMm))}</span> ${t("rSaddleFA_kops")}`);
    } else { recLines.push(t("rSaddleFA_noScale")); }
  } else { recLines.push(t("rSaddleFA_na")); }

  if (stemDeltaMm != null) {
    if (stemDeltaMm === 0) recLines.push(t("rStem_ok"));
    else if (stemDeltaMm < 0) recLines.push(`${t("rStem_shorter")} <span class="k">${Math.abs(stemDeltaMm)} ${t("rStem_mm_shorter")}</span> ${t("rStem_elbows_open")}`);
    else recLines.push(`${t("rStem_longer")} <span class="k">${stemDeltaMm} ${t("rStem_mm_longer")}</span> ${t("rStem_elbows_closed")}`);
  }
  blocks.push(buildResultBlock(t("rRecs"), recLines));

  if (warnings.length) {
    blocks.push(buildResultBlock(t("rWarnings"), warnings.map(w => `<span style="color:var(--amber);">⚠ ${w}</span>`)));
  }

  // Clipboard
  const reportText = [
    t("clipTitle"),
    `${t("clipVideo")} ${fileMetaText.textContent}`,
    `${t("clipFrames")} ${total}, ${t("rGood")}: ${good} (${goodPct.toFixed(1)}%)`,
    `${t("clipScale")} ${pxPerMm ? pxPerMm.toFixed(4) : t("clipNA")}`,
    "",
    `${t("clipKnee")} ${fmt(kneeBDC, 1)}° (${t("rTarget")} ~${targetKneeBDC}°)`,
    `${t("clipHip")} ${fmt(hipAvg, 1)}°`,
    `${t("clipTorso")} ${fmt(torsoAvg, 1)}°`,
    `${t("clipElbow")} ${fmt(elbowAvg, 1)}°`,
    "",
    `${t("clipSaddleH")} ${saddleDeltaMm != null ? Math.round(saddleDeltaMm) + " mm" : t("clipNA")} (${t("clipPosRaise")})`,
    `${t("clipSaddleFA")} ${foreAftDeltaMm != null ? Math.round(foreAftDeltaMm) + " mm" : t("clipNA")} (${t("clipPosFwd")})`,
    `${t("clipStem")} ${stemDeltaMm != null ? stemDeltaMm + " mm" : t("clipNA")} (${t("clipNegShorter")})`,
    "",
    ...(warnings.length ? [t("clipWarnings"), ...warnings.map(w => "- " + w)] : [])
  ].join("\n");

  resultsEl.innerHTML = blocks.join("");
  btnCopy.disabled = false;
  const saveTxtBtn = el("btnSaveTxt");
  if (saveTxtBtn) saveTxtBtn.disabled = false;
  savedReportText = reportText;
  btnCopy.onclick = async () => {
    await navigator.clipboard.writeText(reportText);
    setStatus("statusCopied");
  };

  try {
    const best = maxKneeFrame || lastGood;
    if (best) { await seekTo(best.t); drawFitOverlay(best); }
  } catch (e) { console.warn("Overlay draw failed", e); }

  setStatus("statusDone");
  running = false;
  btnAnalyze.disabled = false;

  unlockStep(4);
  markStepComplete(3);
  goToStep(4);
});

// ---- Result builders ----
function buildResultBlock(title, lines) {
  return `<div class="result-section"><h4>${title}</h4>${lines.map(l => `<div class="result-line">${l}</div>`).join("")}</div>`;
}

function buildMetricGrid(items) {
  const cards = items.map(({ label, val, cls, note }) =>
    `<div class="metric-card ${cls ?? ""}">
      <div class="metric-label">${label}</div>
      <div class="metric-value ${cls ?? "neutral"}">${val}</div>
      <div class="metric-note">${note}</div>
    </div>`).join("");
  return `<div class="metric-grid">${cards}</div>`;
}

// ---- Wire up language + step tabs ----
el("langEn")?.addEventListener("click", () => setLang("en"));
el("langFr")?.addEventListener("click", () => setLang("fr"));
el("tab1")?.addEventListener("click", () => goToStep(1));
el("tab2")?.addEventListener("click", () => goToStep(2));
el("tab3")?.addEventListener("click", () => goToStep(3));
el("tab4")?.addEventListener("click", () => goToStep(4));
el("btnNextAnalyse")?.addEventListener("click", () => goToStep(3));
el("btnNextCalibrate")?.addEventListener("click", () => goToStep(2));

// ---- Save TXT ----
let savedReportText = "";
el("btnSaveTxt")?.addEventListener("click", () => {
  if (!savedReportText) return;
  const blob = new Blob([savedReportText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const videoName = (el("fileName")?.textContent || "report").replace(/\.[^.]+$/, "");
  a.download = `bike_posture_${videoName}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---- Init ----
updateCalibrationUI();
setStatus("statusIdle");
