// Bike Posture Checker — Video Upload (static webapp)
//
// Goals (v11):
// - Always enable "Load" when a file is selected, even if other parts fail.
// - Full FR/EN translation coverage for UI text.
// - Keep video visible (no black overlay), show overlay on top.
// - Optional calibration by 2 clicked points to get px/mm scale.
// - Analyze sampled frames with MediaPipe Pose (lazy-loaded).
// - Show overlay on the frame of maximum knee angle (max extension).
// - Optional overlay during playback (frame-by-frame).

let vision = null;

async function loadVision() {
  if (vision) return vision;
  const u = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  // IMPORTANT: tasks-vision exports named bindings, not default.
  vision = await import(u);
  return vision;
}

const el = (id) => document.getElementById(id);

const fileEl = el("file");
const vidInfo = el("vidInfo");
const btnLoad = el("btnLoad");
const btnGrab = el("btnGrab");
const btnAnalyze = el("btnAnalyze");
const btnReset = el("btnReset");
const video = el("video");
const overlay = el("overlay");
const ctx = overlay.getContext("2d");
const chkOverlay = el("chkOverlay");

const statusEl = el("status");
const legendEl = el("legend");
const resultsEl = el("results");
const btnCopy = el("btnCopy");

const presetEl = el("preset");
const btnPick = el("btnPick");
const btnClearPts = el("btnClearPts");
const realMmEl = el("realMm");
const btnSetScale = el("btnSetScale");
const pxDistEl = el("pxDist");
const scaleEl = el("scale");

const st1s = el("st1s");
const st2s = el("st2s");
const st3s = el("st3s");
const langSel = el("langSel");

// ---------- i18n ----------
const I18N = {
  fr: {
    title: "Bike Posture Checker (Route) — Import vidéo",
    sub: "Analyse la posture localement dans ton navigateur. Calibre avec une mesure visible dans la vidéo (sans cibles imprimées).",
    lang: "Langue:",
    uploadLabel: "1) Importer une vidéo de profil :",
    noVideo: "Aucune vidéo",
    load: "Charger",
    grab: "Capturer une image d'étalonnage",
    analyze: "Analyser la vidéo",
    reset: "Réinitialiser",
    showOverlay: "Afficher squelette + mesures pendant la lecture",
    tips: "Conseils : vraie vue de profil, corps entier visible, caméra stable, clip 20–40 s. Compatibilité: MP4 (H.264) conseillé.",
    statusReady: "Prêt.",
    statusLoaded: "Vidéo chargée.",
    statusGrabbed: "Image d'étalonnage capturée (pause).",
    statusAnalyzing: (p) => `Analyse… (échantillonnage des images) ${p}%`,
    statusDone: "Analyse terminée.",
    statusError: (m) => `Erreur: ${m}`,
    step1: "Importer la vidéo",
    step2: "Étalonnage (optionnel)",
    step3: "Analyser",
    pillTodo: "en attente",
    pillOptional: "optionnel",
    pillDone: "terminé",
    pillWarn: "à vérifier",
    calibTitle: "2) Étalonnage (mm) :",
    calibHelp: "Clique 2 points sur l’image d’étalonnage (ex : extrémités du diamètre de la roue), puis entre la distance réelle en mm.",
    preset: "Préréglage:",
    pick2: "Choisir 2 points",
    clear: "Effacer",
    realDist: "Distance réelle (mm):",
    setScale: "Définir l’échelle",
    pxDist: "Distance (pixels):",
    scale: "Échelle:",
    resultsTitle: "3) Résultats :",
    legendTitle: "Légende des seuils (road fit) :",
    exportTitle: "Export :",
    copy: "Copier le rapport",
    privacy: "Rien n’est téléversé : tout reste local dans ce MVP.",
    warnNoScale: "Aucune échelle: seules des recommandations angulaires seront données (les mm sont indicatifs).",
    warnCodec: "Impossible de décoder la vidéo. Essaie un MP4 (H.264) ou WebM, ou ré-exporte la vidéo.",
    crankHeuristicTitle: "Manivelles (heuristique):",
    crankTooLong: "Possiblement trop longues (genou très fermé en haut de pédale). Vérifie d’abord hauteur/avancée de selle.",
    crankTooShort: "Possiblement trop courtes (genou très ouvert en haut de pédale). Vérifie d’abord hauteur/avancée de selle.",
    crankOK: "Rien d’évident (dans les limites de l’heuristique).",
  },
  en: {
    title: "Bike Posture Checker (Road Fit) — Video Upload",
    sub: "Runs locally in your browser. Calibrate using a known measurement visible in the video (no printed targets).",
    lang: "Language:",
    uploadLabel: "1) Upload side-view video:",
    noVideo: "No video",
    load: "Load",
    grab: "Grab calibration frame",
    analyze: "Analyze video",
    reset: "Reset",
    showOverlay: "Show skeleton + measurements during playback",
    tips: "Tips: true side view, full body visible, stable camera, 20–40s clip. Best compatibility: MP4 (H.264).",
    statusReady: "Ready.",
    statusLoaded: "Video loaded.",
    statusGrabbed: "Calibration frame grabbed (paused).",
    statusAnalyzing: (p) => `Analyzing… (sampling frames) ${p}%`,
    statusDone: "Analysis complete.",
    statusError: (m) => `Error: ${m}`,
    step1: "Import video",
    step2: "Calibration (optional)",
    step3: "Analyze",
    pillTodo: "pending",
    pillOptional: "optional",
    pillDone: "done",
    pillWarn: "check",
    calibTitle: "2) Calibration (mm):",
    calibHelp: "Click 2 points on the calibration frame (e.g., wheel diameter endpoints), then enter the real distance in mm.",
    preset: "Preset:",
    pick2: "Pick 2 points",
    clear: "Clear",
    realDist: "Real distance (mm):",
    setScale: "Set scale",
    pxDist: "Pixels distance:",
    scale: "Scale:",
    resultsTitle: "3) Results:",
    legendTitle: "Threshold legend (road fit):",
    exportTitle: "Export:",
    copy: "Copy report",
    privacy: "Nothing is uploaded: everything stays local in this MVP.",
    warnNoScale: "No scale set: angle-based guidance only (mm are indicative).",
    warnCodec: "Video could not be decoded. Try MP4 (H.264) or WebM, or re-export the clip.",
    crankHeuristicTitle: "Crank length (heuristic):",
    crankTooLong: "Possibly too long (very closed knee at top of stroke). Check saddle height/fore-aft first.",
    crankTooShort: "Possibly too short (very open knee at top of stroke). Check saddle height/fore-aft first.",
    crankOK: "Nothing obvious (within heuristic limits).",
  }
};

let LANG = "fr";
function t(key, ...args) {
  const v = I18N[LANG]?.[key];
  return typeof v === "function" ? v(...args) : (v ?? key);
}

function applyI18n() {
  el("tTitle").textContent = t("title");
  el("tSub").textContent = t("sub");
  el("tLangLabel").textContent = t("lang");
  el("tUploadLabel").textContent = t("uploadLabel");
  btnLoad.textContent = t("load");
  btnGrab.textContent = t("grab");
  btnAnalyze.textContent = t("analyze");
  btnReset.textContent = t("reset");
  el("tShowOverlay").textContent = t("showOverlay");
  el("tTips").textContent = t("tips");
  el("tStep1").textContent = t("step1");
  el("tStep2").textContent = t("step2");
  el("tStep3").textContent = t("step3");
  el("tCalibTitle").innerHTML = `<b>${t("calibTitle")}</b>`;
  el("tCalibHelp").textContent = t("calibHelp");
  el("tPreset").textContent = t("preset");
  btnPick.textContent = t("pick2");
  btnClearPts.textContent = t("clear");
  el("tRealDist").textContent = t("realDist");
  btnSetScale.textContent = t("setScale");
  el("tPxDistLabel").textContent = t("pxDist");
  el("tScaleLabel").textContent = t("scale");
  el("tResultsTitle").innerHTML = `<b>${t("resultsTitle")}</b>`;
  el("tLegendTitle").innerHTML = `<b>${t("legendTitle")}</b>`;
  el("tExportTitle").innerHTML = `<b>${t("exportTitle")}</b>`;
  btnCopy.textContent = t("copy");
  el("tPrivacy").textContent = t("privacy");
  if (!fileEl.files?.[0]) vidInfo.textContent = t("noVideo");
  renderLegend();
}

// ---------- UI safety: always bind the file handler early ----------
fileEl.addEventListener("change", () => {
  try {
    const f = fileEl.files?.[0];
    btnLoad.disabled = !f;
    if (f) {
      vidInfo.textContent = `${f.name}`;
      setStep(1, "done");
    } else {
      vidInfo.textContent = t("noVideo");
      setStep(1, "todo");
    }
  } catch (e) {
    // If something very unexpected happens, still keep UI usable.
    btnLoad.disabled = false;
  }
});

// ---------- state ----------
let videoURL = null;
let gotCalibFrame = false;

let calib = {
  picking: false,
  pts: [], // [{x,y} in canvas px]
  pxDist: null,
  pxPerMm: null,
};

let analyzedFrames = []; // each: {t, landmarks, metrics, side}
let bestFrameIdx = null; // max knee angle (extension)
let analysisReportText = "";

// ---------- utilities ----------
function setStatus(msg) { statusEl.textContent = msg; }

function setStep(n, state) {
  const map = { todo: ["pill todo", t("pillTodo")], optional: ["pill todo", t("pillOptional")], done: ["pill done", t("pillDone")], warn: ["pill warn", t("pillWarn")] };
  const [cls, txt] = map[state] || map.todo;
  const target = n === 1 ? st1s : (n === 2 ? st2s : st3s);
  target.className = cls;
  target.textContent = txt;
}

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function syncOverlaySizeToVideo() {
  // match the displayed size for drawing in pixel space
  const w = video.clientWidth || video.videoWidth || 0;
  const h = video.clientHeight || video.videoHeight || 0;
  if (!w || !h) return;
  // Use devicePixelRatio for crisp lines
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  overlay.style.width = w + "px";
  overlay.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawDot(x, y, r=4, color="lime") {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawLine(a, b, color="lime", width=3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawLabel(text, x, y, color) {
  ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 4;
  ctx.strokeText(text, x+6, y-6);
  ctx.fillText(text, x+6, y-6);
}

function angleABC(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.hypot(ba.x, ba.y);
  const magBC = Math.hypot(bc.x, bc.y);
  if (magBA === 0 || magBC === 0) return null;
  let cos = dot / (magBA * magBC);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function torsoAngle(hip, shoulder) {
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  let ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (ang > 90) ang = 180 - ang;
  return ang;
}

// MediaPipe Pose landmark indices
const IDX = {
  left_shoulder: 11, right_shoulder: 12,
  left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16,
  left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28,
};

function lm(lms, side, name) {
  const k = `${side}_${name}`;
  const i = IDX[k];
  const p = lms?.[i];
  if (!p) return null;
  const vis = (p.visibility ?? 1);
  if (vis < 0.5) return null;
  return p;
}

function pickBestSide(lms) {
  // Decide per frame which side is more visible (average visibility of key joints)
  function score(side) {
    const keys = ["shoulder","hip","knee","ankle","elbow","wrist"];
    let s=0, c=0;
    for (const k of keys) {
      const p = lm(lms, side, k);
      if (p) { s += (p.visibility ?? 1); c++; }
    }
    return c ? s/c : 0;
  }
  const sl = score("left");
  const sr = score("right");
  return sr > sl ? "right" : "left";
}

// ---------- legend & thresholds ----------
const TH = {
  kneeBDC: { min: 140, max: 150 },
  elbow: { min: 150, max: 170, lock: 170 },
  torso: { min: 25, max: 55 },
  hip: { min: 70, max: 105 },
  // crank heuristic uses knee @ TDC (very rough)
  kneeTDC: { tooClosed: 70, tooOpen: 110 }, // in degrees
};

function inRange(val, min, max) { return val != null && val >= min && val <= max; }

function renderLegend() {
  legendEl.innerHTML = `
    <div>✅ ${LANG==="fr" ? "Genou @ PMB" : "Knee @ BDC"} : ${TH.kneeBDC.min}–${TH.kneeBDC.max}°</div>
    <div>✅ ${LANG==="fr" ? "Coude" : "Elbow"} : ${TH.elbow.min}–${TH.elbow.max}° (${LANG==="fr" ? "éviter verrouillé" : "avoid locked"} >${TH.elbow.lock}°)</div>
    <div>✅ ${LANG==="fr" ? "Torse" : "Torso"} : ${TH.torso.min}–${TH.torso.max}°</div>
    <div>✅ ${LANG==="fr" ? "Hanche" : "Hip"} : ${TH.hip.min}–${TH.hip.max}°</div>
    <div>✅ ${LANG==="fr" ? "Manivelles (heur.) – genou en haut" : "Crank (heur.) – knee @ TDC"} : ${LANG==="fr" ? "trop fermé" : "too closed"} <${TH.kneeTDC.tooClosed}° ; ${LANG==="fr" ? "trop ouvert" : "too open"} >${TH.kneeTDC.tooOpen}°</div>
  `;
}

// ---------- calibration (2 clicks) ----------
function resetCalibration() {
  calib.picking = false;
  calib.pts = [];
  calib.pxDist = null;
  calib.pxPerMm = null;
  pxDistEl.textContent = "—";
  scaleEl.textContent = "—";
  btnPick.disabled = !gotCalibFrame;
  btnClearPts.disabled = true;
  btnSetScale.disabled = true;
  realMmEl.value = "";
  setStep(2, "optional");
}

function updateCalibButtons() {
  btnPick.disabled = !gotCalibFrame || calib.picking;
  btnClearPts.disabled = calib.pts.length === 0;
  btnSetScale.disabled = !(calib.pts.length === 2 && Number(realMmEl.value) > 0);

  // When picking calibration points, capture clicks on the overlay (and prevent accidental video play).
  if (calib.picking) {
    overlay.style.pointerEvents = "auto";
    try { video.pause(); } catch (_) {}
    video.controls = false;
  } else {
    overlay.style.pointerEvents = "none";
    // restore controls only if a video is loaded (avoid showing disabled controls on blank)
    video.controls = true;
  }
}

btnPick.addEventListener("click", () => {
  calib.picking = true;
  calib.pts = [];
  updateCalibButtons();
  setStatus(t("statusGrabbed"));
});

btnClearPts.addEventListener("click", () => {
  calib.pts = [];
  calib.pxDist = null;
  calib.pxPerMm = null;
  pxDistEl.textContent = "—";
  scaleEl.textContent = "—";
  calib.picking = false;
  updateCalibButtons();
});

presetEl.addEventListener("change", () => {
  const v = presetEl.value;
  if (v) realMmEl.value = v;
  updateCalibButtons();
});

realMmEl.addEventListener("input", () => updateCalibButtons());

btnSetScale.addEventListener("click", () => {
  if (calib.pts.length !== 2) return;
  const mm = Number(realMmEl.value);
  if (!(mm > 0)) return;
  const dx = calib.pts[1].x - calib.pts[0].x;
  const dy = calib.pts[1].y - calib.pts[0].y;
  const distPx = Math.hypot(dx, dy);
  calib.pxDist = distPx;
  calib.pxPerMm = distPx / mm;
  pxDistEl.textContent = `${distPx.toFixed(1)} px`;
  scaleEl.textContent = `${calib.pxPerMm.toFixed(4)} px/mm`;
  setStep(2, "done");
  calib.picking = false;
  updateCalibButtons();
});

// Click capture points on overlay (uses rendered video coords)
overlay.addEventListener("click", (ev) => {
  if (!calib.picking) return;
  const rect = overlay.getBoundingClientRect();
  const x = (ev.clientX - rect.left);
  const y = (ev.clientY - rect.top);
  calib.pts.push({x, y});
  if (calib.pts.length >= 2) {
    calib.picking = false;
  }
  updateCalibButtons();
});

// ---------- video load ----------
function validateVideoLoaded() {
  return !!(video && video.readyState >= 2 && video.duration && isFinite(video.duration));
}

btnLoad.addEventListener("click", async () => {
  try {
    const f = fileEl.files?.[0];
    if (!f) return;
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(f);
    video.src = videoURL;
    await video.play().catch(() => {});
    video.pause();
    await new Promise((res) => {
      if (video.readyState >= 2) return res();
      video.onloadeddata = () => res();
      video.onerror = () => res();
    });

    if (!validateVideoLoaded()) {
      setStatus(t("warnCodec"));
      return;
    }

    syncOverlaySizeToVideo();
    clearOverlay();
    gotCalibFrame = false;
    resetCalibration();
    btnGrab.disabled = false;
    btnAnalyze.disabled = false;
    setStatus(t("statusLoaded"));
    setStep(1, "done");
    setStep(3, "todo");
  } catch (e) {
    setStatus(t("statusError", e?.message || String(e)));
  }
});

btnGrab.addEventListener("click", () => {
  if (!validateVideoLoaded()) return;
  video.pause();
  gotCalibFrame = true;
  syncOverlaySizeToVideo();
  clearOverlay();
  // draw calibration points if any
  for (const p of calib.pts) drawDot(p.x, p.y, 5, "yellow");
  btnPick.disabled = false;
  updateCalibButtons();
  setStatus(t("statusGrabbed"));
});

// ---------- overlay during playback ----------
let rafId = null;
function stopRAF() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

function drawOverlayFromNearestTime() {
  if (!chkOverlay.checked || analyzedFrames.length === 0) {
    clearOverlay();
    return;
  }
  const tsec = video.currentTime;
  // find nearest analyzed frame by time
  let best = 0, bestD = Infinity;
  for (let i=0;i<analyzedFrames.length;i++){
    const d = Math.abs(analyzedFrames[i].t - tsec);
    if (d < bestD) { bestD = d; best = i; }
  }
  renderFrameOverlay(analyzedFrames[best], /*dim*/ false);
}

function loopPlaybackOverlay() {
  drawOverlayFromNearestTime();
  rafId = requestAnimationFrame(loopPlaybackOverlay);
}

video.addEventListener("play", () => {
  stopRAF();
  if (chkOverlay.checked) loopPlaybackOverlay();
});
video.addEventListener("pause", () => {
  stopRAF();
  if (!chkOverlay.checked) clearOverlay();
});
chkOverlay.addEventListener("change", () => {
  if (!chkOverlay.checked) {
    stopRAF();
    clearOverlay();
  } else if (!video.paused) {
    loopPlaybackOverlay();
  } else {
    drawOverlayFromNearestTime();
  }
});

// ---------- analysis ----------
async function ensureModel() {
  const v = await loadVision();
  const filesetResolver = await v.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  const poseLandmarker = await v.PoseLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });
  return poseLandmarker;
}

function computeMetrics(lms) {
  const side = pickBestSide(lms);
  const shoulder = lm(lms, side, "shoulder");
  const hip = lm(lms, side, "hip");
  const knee = lm(lms, side, "knee");
  const ankle = lm(lms, side, "ankle");
  const elbow = lm(lms, side, "elbow");
  const wrist = lm(lms, side, "wrist");

  if (!shoulder || !hip || !knee || !ankle || !elbow || !wrist) return null;

  const torso = torsoAngle({x: hip.x, y: hip.y}, {x: shoulder.x, y: shoulder.y});
  const hipAng = angleABC({x: shoulder.x, y: shoulder.y}, {x: hip.x, y: hip.y}, {x: knee.x, y: knee.y});
  const kneeAng = angleABC({x: hip.x, y: hip.y}, {x: knee.x, y: knee.y}, {x: ankle.x, y: ankle.y});
  const elbowAng = angleABC({x: shoulder.x, y: shoulder.y}, {x: elbow.x, y: elbow.y}, {x: wrist.x, y: wrist.y});

  return {
    side,
    pts: {
      shoulder:{x: shoulder.x, y: shoulder.y},
      hip:{x: hip.x, y: hip.y},
      knee:{x: knee.x, y: knee.y},
      ankle:{x: ankle.x, y: ankle.y},
      elbow:{x: elbow.x, y: elbow.y},
      wrist:{x: wrist.x, y: wrist.y}
    },
    angles: { torso, hip: hipAng, knee: kneeAng, elbow: elbowAng }
  };
}

function renderFrameOverlay(frame, dim=true) {
  syncOverlaySizeToVideo();
  clearOverlay();

  const m = frame?.metrics;
  if (!m) return;

  // Map normalized landmark coords to displayed video pixels.
  // NOTE: MediaPipe gives normalized coords relative to the input image.
  // We render on the displayed <video> (object-fit: contain). For v11 MVP,
  // we approximate by mapping directly to displayed width/height.
  // This works best when the video fills the element without letterboxing.
  const W = video.clientWidth;
  const H = video.clientHeight;

  const P = {};
  for (const [k,v] of Object.entries(m.pts)) {
    P[k] = { x: v.x * W, y: v.y * H };
  }

  // Decide colors by thresholds
  const kneeOk = inRange(m.angles.knee, TH.kneeBDC.min, TH.kneeBDC.max);
  const elbowOk = inRange(m.angles.elbow, TH.elbow.min, TH.elbow.max);
  const torsoOk = inRange(m.angles.torso, TH.torso.min, TH.torso.max);
  const hipOk = inRange(m.angles.hip, TH.hip.min, TH.hip.max);

  const cGood = "#22c55e"; // green
  const cBad = "#ef4444";  // red

  // limbs colored by their related metric
  drawLine(P.hip, P.shoulder, torsoOk ? cGood : cBad, 4);
  drawLine(P.hip, P.knee, hipOk ? cGood : cBad, 4);
  drawLine(P.knee, P.ankle, kneeOk ? cGood : cBad, 4);
  drawLine(P.shoulder, P.elbow, elbowOk ? cGood : cBad, 4);
  drawLine(P.elbow, P.wrist, elbowOk ? cGood : cBad, 4);

  // joints
  for (const k of ["shoulder","hip","knee","ankle","elbow","wrist"]) drawDot(P[k].x, P[k].y, 4, "white");

  // labels
  drawLabel(`Torse ${m.angles.torso.toFixed(1)}°`, P.shoulder.x, P.shoulder.y, torsoOk ? cGood : cBad);
  drawLabel(`Hanche ${m.angles.hip.toFixed(1)}°`, P.hip.x, P.hip.y, hipOk ? cGood : cBad);
  drawLabel(`Genou ${m.angles.knee.toFixed(1)}°`, P.knee.x, P.knee.y, kneeOk ? cGood : cBad);
  drawLabel(`Coude ${m.angles.elbow.toFixed(1)}°`, P.elbow.x, P.elbow.y, elbowOk ? cGood : cBad);

  // calibration points display (when grabbed)
  if (gotCalibFrame && calib.pts.length) {
    for (const p of calib.pts) drawDot(p.x, p.y, 6, "yellow");
  }
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = (p/100)*(a.length-1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo===hi) return a[lo];
  const t = idx-lo;
  return a[lo]*(1-t)+a[hi]*t;
}

function buildReportText(summary) {
  const fr = (LANG === "fr");
  const pct = (summary.good/Math.max(1,summary.sampled)*100);
  const lines = [];
  if (fr) {
    lines.push("Qualité");
    lines.push(`Images échantillonnées : ${summary.sampled} • bonnes : ${summary.good} (${pct.toFixed(1)}%)`);
    lines.push("Côté utilisé : auto (meilleure visibilité par image)");
    lines.push("");
    lines.push("Angles (road fit)");
    lines.push(`Angle du genou @ PMB (estimé) : ${summary.kneeBDC.toFixed(1)}° (cible ~145°)`);
    lines.push(`Angle de hanche (moy.) : ${summary.hipAvg.toFixed(1)}°`);
    lines.push(`Angle du torse (moy.) : ${summary.torsoAvg.toFixed(1)}°`);
    lines.push(`Angle du coude (moy.) : ${summary.elbowAvg.toFixed(1)}°`);
    lines.push("");
    lines.push(`Manivelles (heur.) : ${summary.crankText}`);
    lines.push("");
    lines.push("Corrections (starter)");
    for (const c of summary.corrections) lines.push(`- ${c}`);
  } else {
    lines.push("Quality");
    lines.push(`Frames sampled: ${summary.sampled} • good: ${summary.good} (${pct.toFixed(1)}%)`);
    lines.push("Side used: auto (per-frame best visibility)");
    lines.push("");
    lines.push("Angles (road fit)");
    lines.push(`Knee angle @ BDC (estimated): ${summary.kneeBDC.toFixed(1)}° (target ~145°)`);
    lines.push(`Hip angle (avg): ${summary.hipAvg.toFixed(1)}°`);
    lines.push(`Torso angle (avg): ${summary.torsoAvg.toFixed(1)}°`);
    lines.push(`Elbow angle (avg): ${summary.elbowAvg.toFixed(1)}°`);
    lines.push("");
    lines.push(`Cranks (heur.): ${summary.crankText}`);
    lines.push("");
    lines.push("Concrete corrections (starter)");
    for (const c of summary.corrections) lines.push(`- ${c}`);
  }
  return lines.join("
");
}

function buildReportHTML(summary) {
  const fr = (LANG === "fr");
  const pct = (summary.good/Math.max(1,summary.sampled)*100);
  const rows = (label, value) => `<div class="rrow"><div class="rlabel">${label}</div><div class="rval">${value}</div></div>`;
  const esc = (s) => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const corrections = summary.corrections.map(c => `<li>${esc(c)}</li>`).join("");
  const qualityTitle = fr ? "Qualité" : "Quality";
  const anglesTitle = fr ? "Angles (road fit)" : "Angles (road fit)";
  const crankTitle = fr ? "Manivelles (heuristique)" : "Cranks (heuristic)";
  const corrTitle = fr ? "Corrections (starter)" : "Concrete corrections (starter)";
  const sideTxt = fr ? "Auto (meilleure visibilité par image)" : "Auto (per-frame best visibility)";
  return `
    <div class="report">
      <h3>${qualityTitle}</h3>
      ${rows(fr ? "Images échantillonnées" : "Frames sampled", `${summary.sampled}`)}
      ${rows(fr ? "Bonnes images" : "Good frames", `${summary.good} (${pct.toFixed(1)}%)`)}
      ${rows(fr ? "Côté utilisé" : "Side used", sideTxt)}
      <h3 style="margin-top:10px;">${anglesTitle}</h3>
      ${rows(fr ? "Genou @ PMB (estimé)" : "Knee @ BDC (est.)", `${summary.kneeBDC.toFixed(1)}° (≈145°)`)}
      ${rows(fr ? "Hanche (moy.)" : "Hip (avg)", `${summary.hipAvg.toFixed(1)}°`)}
      ${rows(fr ? "Torse (moy.)" : "Torso (avg)", `${summary.torsoAvg.toFixed(1)}°`)}
      ${rows(fr ? "Coude (moy.)" : "Elbow (avg)", `${summary.elbowAvg.toFixed(1)}°`)}
      <h3 style="margin-top:10px;">${crankTitle}</h3>
      <div class="small muted">${esc(summary.crankText)}</div>
      <h3 style="margin-top:10px;">${corrTitle}</h3>
      <ul class="rlist">${corrections || `<li>${fr ? "Aucune recommandation." : "No suggestions."}</li>`}</ul>
    </div>
  `;
}

function computeCorrections(summary) {
  const out = [];
  // saddle height heuristic: 2.5 mm per degree towards target 145
  const target = 145;
  const deltaDeg = target - summary.kneeBDC;
  const mm = Math.max(-20, Math.min(20, deltaDeg * 2.5)); // conservative step
  const mmAbs = Math.round(Math.abs(mm));
  if (mm > 3) out.push(`Raise saddle height by ${mmAbs} mm (conservative step; re-test).`);
  else if (mm < -3) out.push(`Lower saddle height by ${mmAbs} mm (conservative step; re-test).`);
  else out.push(`Saddle height: within range (no strong change suggested).`);

  // reach heuristic
  if (summary.elbowAvg > TH.elbow.lock) out.push(`Reach/stem: consider a 10–20 mm shorter stem (elbows too open).`);
  else if (summary.elbowAvg < TH.elbow.min) out.push(`Reach/stem: consider a slightly longer stem or move hoods forward (elbows too closed).`);
  else out.push(`Reach/stem: within starter range.`);

  // KOPS proxy not implemented in v11 (requires BB/pedal spindle); keep placeholder
  out.push(`Saddle fore-aft: add BB/pedal click calibration for a meaningful KOPS proxy (future).`);
  return out;
}

function crankHeuristic(kneeAtTopDeg) {
  if (kneeAtTopDeg == null) return t("crankOK");
  if (kneeAtTopDeg < TH.kneeTDC.tooClosed) return t("crankTooLong");
  if (kneeAtTopDeg > TH.kneeTDC.tooOpen) return t("crankTooShort");
  return t("crankOK");
}

btnAnalyze.addEventListener("click", async () => {
  try {
    if (!validateVideoLoaded()) return;

    setStep(3, "todo");
    resultsEl.innerHTML = "";
    setStatus(t("statusAnalyzing", 0));

    const poseLandmarker = await ensureModel();

    analyzedFrames = [];
    bestFrameIdx = null;

    // Sample frames evenly across the clip.
    const duration = video.duration;
    const sampleCount = 105; // ~10s clip at 10 fps equivalent sampling
    const times = [];
    for (let i=0;i<sampleCount;i++){
      times.push((i/(sampleCount-1))*duration);
    }

    let good = 0;
    const kneeAngles = [];
    const hipAngles = [];
    const torsoAngles = [];
    const elbowAngles = [];

    let maxKnee = -Infinity;
    let kneeAtTop = Infinity; // min knee angle across cycle approx TDC

    for (let i=0;i<times.length;i++){
      const p = Math.round((i/(times.length-1))*100);
      setStatus(t("statusAnalyzing", p));

      video.currentTime = times[i];
      await new Promise((res) => {
        const onSeek = () => { video.removeEventListener("seeked", onSeek); res(); };
        video.addEventListener("seeked", onSeek);
      });

      syncOverlaySizeToVideo();

      const res = poseLandmarker.detectForVideo(video, performance.now());
      const lms = res?.landmarks?.[0];
      if (!lms) continue;

      const metrics = computeMetrics(lms);
      if (!metrics) continue;

      good++;
      kneeAngles.push(metrics.angles.knee);
      hipAngles.push(metrics.angles.hip);
      torsoAngles.push(metrics.angles.torso);
      elbowAngles.push(metrics.angles.elbow);

      if (metrics.angles.knee > maxKnee) {
        maxKnee = metrics.angles.knee;
        bestFrameIdx = analyzedFrames.length;
      }
      if (metrics.angles.knee < kneeAtTop) kneeAtTop = metrics.angles.knee;

      const frame = { t: times[i], landmarks: lms, metrics };
      analyzedFrames.push(frame);

      // Live overlay while sampling: show current frame skeleton
      renderFrameOverlay(frame, true);
    }

    // finalize
    const kneeBDC = maxKnee; // max extension as BDC proxy
    const hipAvg = hipAngles.reduce((a,b)=>a+b,0)/Math.max(1,hipAngles.length);
    const torsoAvg = torsoAngles.reduce((a,b)=>a+b,0)/Math.max(1,torsoAngles.length);
    const elbowAvg = elbowAngles.reduce((a,b)=>a+b,0)/Math.max(1,elbowAngles.length);

    const crankText = crankHeuristic(kneeAtTop);

    const summary = {
      sampled: times.length,
      good,
      kneeBDC,
      hipAvg,
      torsoAvg,
      elbowAvg,
      crankText,
      corrections: computeCorrections({kneeBDC, hipAvg, torsoAvg, elbowAvg}),
    };

    analysisReportText = buildReportText(summary);
    resultsEl.innerHTML = buildReportHTML(summary);
    btnCopy.disabled = !analysisReportText;

    setStatus(t("statusDone"));
    setStep(3, "done");

    // Jump to best (max knee) frame and draw overlay there
    if (bestFrameIdx != null && analyzedFrames[bestFrameIdx]) {
      video.currentTime = analyzedFrames[bestFrameIdx].t;
      await new Promise((res) => {
        const onSeek = () => { video.removeEventListener("seeked", onSeek); res(); };
        video.addEventListener("seeked", onSeek);
      });
      renderFrameOverlay(analyzedFrames[bestFrameIdx], false);
    } else {
      clearOverlay();
    }
  } catch (e) {
    console.error(e);
    setStatus(t("statusError", e?.message || String(e)));
    setStep(3, "warn");
  }
});

btnCopy.addEventListener("click", async () => {
  try {
    if (!analysisReportText) return;
    await navigator.clipboard.writeText(analysisReportText);
  } catch (e) {
    // ignore
  }
});

btnReset.addEventListener("click", () => {
  try {
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = null;
    fileEl.value = "";
    video.removeAttribute("src");
    video.load();
    vidInfo.textContent = t("noVideo");
    btnLoad.disabled = true;
    btnGrab.disabled = true;
    btnAnalyze.disabled = true;
    analyzedFrames = [];
    bestFrameIdx = null;
    analysisReportText = "";
    resultsEl.innerHTML = "";
    btnCopy.disabled = true;
    gotCalibFrame = false;
    resetCalibration();
    clearOverlay();
    setStatus(t("statusReady"));
    setStep(1, "todo");
    setStep(2, "optional");
    setStep(3, "todo");
  } catch {}
});

// Language switch
langSel.addEventListener("change", () => {
  LANG = langSel.value === "en" ? "en" : "fr";
  applyI18n();
});

// Initial setup
(function init() {
  try {
    LANG = (langSel.value === "en") ? "en" : "fr";
    applyI18n();
    setStatus(t("statusReady"));
    setStep(1, "todo");
    setStep(2, "optional");
    setStep(3, "todo");

    // overlay sizing after metadata load
    video.addEventListener("loadedmetadata", () => {
      syncOverlaySizeToVideo();
      clearOverlay();
    });

    // keep overlay aligned on resize
    try {
      const ro = new ResizeObserver(() => {
        syncOverlaySizeToVideo();
        if (chkOverlay.checked) drawOverlayFromNearestTime();
      });
      ro.observe(video);
      window.addEventListener("resize", () => {
        syncOverlaySizeToVideo();
      }, {passive:true});
    } catch {}
  } catch (e) {
    console.error(e);
    setStatus(`Init error: ${e?.message || e}`);
  }
})();
