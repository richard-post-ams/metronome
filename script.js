// SECTION: Audio & Metronome Engine
let audioCtx;
let masterGain;
let isRunning = false;
let bpm = 120;
let beatInterval = 0; // seconds between quarter notes
let currentBeatInBar = 0;
let currentBar = 1;
let scheduleAheadTime = 0.1; // seconds
let lookahead = 25; // ms
let nextNoteTime = 0; // next quarter-note time in seconds
let timerID;

// Subdivision and mixer
const subdivisionSettings = {
  quarter: { enabled: true, gainNode: null, volumeEl: null },
  eighth: { enabled: true, gainNode: null, volumeEl: null },
  sixteenth: { enabled: true, gainNode: null, volumeEl: null },
  triplet: { enabled: true, gainNode: null, volumeEl: null },
};

// Time signature & polyrhythm
let timeSigTop = 4;
let timeSigBottom = 4;
let polyX = 0;
let polyY = 0;

// Speed trainer
let speedTrainerEnabled = false;
let speedStep = 2;
let speedEveryBars = 4;
let speedMax = 180;

// Gap click
let gapClickEnabled = false;
let gapPlayBars = 4;
let gapMuteBars = 2;

// Tap tempo
const tapTimes = [];
let lastTapTime = 0;
const TAP_RESET_MS = 2000;

// Timing analyzer
let hitSource = "button"; // 'button' or 'mic'
let lastClickTime = 0;
let barBeatIndex = 0;
let accentEnabled = true;
let hitCount = 0;
let sumOffsets = 0;
let micStream;
let micAnalyzer;
let micDataArray;
let micThreshold = 0.4;
let micListenerActive = false;

// DOM references
const bpmValueEl = document.getElementById("bpmValue");
const bpmDialValueEl = document.getElementById("bpmDialValue");
const bpmDialEl = document.getElementById("bpmDial");
const dialIndicatorEl = bpmDialEl.querySelector(".dial-indicator");
const borderFlashEl = document.querySelector(".border-flash");
const beatIndicatorEl = document.getElementById("beatIndicator");
const subdivisionIndicatorEl = document.getElementById("subdivisionIndicator");
const startStopBtn = document.getElementById("startStopBtn");
const tapTempoBtn = document.getElementById("tapTempoBtn");
const downbeatBtn = document.getElementById("downbeatBtn");
const transportStatusEl = document.getElementById("transportStatus");

// Mode controls
const speedTrainerEnabledEl = document.getElementById("speedTrainerEnabled");
const speedTrainerStatusEl = document.getElementById("speedTrainerStatus");
const gapClickEnabledEl = document.getElementById("gapClickEnabled");
const gapClickStatusEl = document.getElementById("gapClickStatus");

const offsetBarsEl = document.getElementById("offsetBars");
const avgOffsetEl = document.getElementById("avgOffset");
const lastOffsetEl = document.getElementById("lastOffset");
const hitCountEl = document.getElementById("hitCount");

// SECTION: Utility
function initAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(audioCtx.destination);

    // Create gain nodes for subdivisions
    Object.keys(subdivisionSettings).forEach((key) => {
      const gain = audioCtx.createGain();
      gain.gain.value = 1;
      gain.connect(masterGain);
      subdivisionSettings[key].gainNode = gain;
    });

    updateMixerGains();
  }
}

function updateBpm(newBpm) {
  bpm = Math.max(30, Math.min(260, newBpm));
  beatInterval = 60 / bpm;
  bpmValueEl.textContent = Math.round(bpm);
  bpmDialValueEl.textContent = Math.round(bpm);
  bpmDialEl.setAttribute("aria-valuenow", Math.round(bpm));
  updateDialIndicator();
}

function updateDialIndicator() {
  const minBpm = 30;
  const maxBpm = 260;
  const ratio = (bpm - minBpm) / (maxBpm - minBpm);
  const minAngle = -140;
  const maxAngle = 140;
  const angle = minAngle + ratio * (maxAngle - minAngle);
  dialIndicatorEl.style.transform = `rotate(${angle}deg)`;
}

function scheduleClick(time, type) {
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  let frequency = 1000;
  switch (type) {
    case "accent":
      frequency = 1600;
      break;
    case "sub":
      frequency = 900;
      break;
    case "polyX":
      frequency = 1800;
      break;
    case "polyY":
      frequency = 700;
      break;
    default:
      frequency = 1200;
  }

  const duration = 0.035;

  osc.frequency.value = frequency;
  osc.connect(gain);

  // Route through subdivision mixer based on type
  let targetGain = masterGain;
  if (type === "quarter" || type === "accent") {
    targetGain = subdivisionSettings.quarter.gainNode;
  } else if (type === "eighth") {
    targetGain = subdivisionSettings.eighth.gainNode;
  } else if (type === "sixteenth") {
    targetGain = subdivisionSettings.sixteenth.gainNode;
  } else if (type === "triplet") {
    targetGain = subdivisionSettings.triplet.gainNode;
  }

  gain.connect(targetGain);

  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(1, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.start(time);
  osc.stop(time + duration);

  if (type === "accent" || type === "quarter") {
    lastClickTime = time;
  }
}

function flashBorder() {
  borderFlashEl.classList.add("active");
  setTimeout(() => borderFlashEl.classList.remove("active"), 120);
}

function pulseBeatIndicators(isDownbeat, hasSubdivision) {
  if (isDownbeat) {
    beatIndicatorEl.classList.add("active");
    flashBorder();
    setTimeout(() => beatIndicatorEl.classList.remove("active"), 120);
  } else {
    beatIndicatorEl.classList.add("active");
    setTimeout(() => beatIndicatorEl.classList.remove("active"), 80);
  }

  if (hasSubdivision) {
    subdivisionIndicatorEl.classList.add("active");
    setTimeout(() => subdivisionIndicatorEl.classList.remove("active"), 80);
  }
}

// Update subdivision mixer gain values
function updateMixerGains() {
  const volQuarterEl = document.getElementById("volQuarter");
  const volEighthEl = document.getElementById("volEighth");
  const volSixteenthEl = document.getElementById("volSixteenth");
  const volTripletEl = document.getElementById("volTriplet");

  if (subdivisionSettings.quarter.gainNode && volQuarterEl) {
    subdivisionSettings.quarter.gainNode.gain.value = parseFloat(volQuarterEl.value);
  }
  if (subdivisionSettings.eighth.gainNode && volEighthEl) {
    subdivisionSettings.eighth.gainNode.gain.value = parseFloat(volEighthEl.value);
  }
  if (subdivisionSettings.sixteenth.gainNode && volSixteenthEl) {
    subdivisionSettings.sixteenth.gainNode.gain.value = parseFloat(volSixteenthEl.value);
  }
  if (subdivisionSettings.triplet.gainNode && volTripletEl) {
    subdivisionSettings.triplet.gainNode.gain.value = parseFloat(volTripletEl.value);
  }
}

// SECTION: Scheduler
function nextNote() {
  // advance to next quarter note
  nextNoteTime += beatInterval;
  barBeatIndex++;

  if (barBeatIndex >= timeSigTop) {
    barBeatIndex = 0;
    currentBar++;
    handleBarAdvanced();
  }
}

function scheduleNotes() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    const isDownbeat = barBeatIndex === 0;

    // Gap click logic
    const totalCycle = gapPlayBars + gapMuteBars;
    let inMuteSection = false;
    if (gapClickEnabled && totalCycle > 0) {
      const barIndexInCycle = (currentBar - 1) % totalCycle;
      inMuteSection = barIndexInCycle >= gapPlayBars;
    }

    if (!inMuteSection) {
      // Quarter note (respect accent toggle)
      let type = "quarter";
      if (isDownbeat && accentEnabled) {
        type = "accent";
      }
      scheduleClick(nextNoteTime, type);

      // Subdivisions: eighths, sixteenths, triplets
      const eighthInterval = beatInterval / 2;
      const sixteenthInterval = beatInterval / 4;
      const tripletInterval = beatInterval / 3;

      // eighth note on the "and" of the beat
      scheduleClick(nextNoteTime + eighthInterval, "eighth");

      // sixteenth notes: e, &, a
      scheduleClick(nextNoteTime + sixteenthInterval, "sixteenth");
      scheduleClick(nextNoteTime + sixteenthInterval * 2, "sixteenth");
      scheduleClick(nextNoteTime + sixteenthInterval * 3, "sixteenth");

      // triplet 2 and 3
      scheduleClick(nextNoteTime + tripletInterval, "triplet");
      scheduleClick(nextNoteTime + 2 * tripletInterval, "triplet");

      // Polyrhythm (X over Y): treat X as beats over a bar, Y as against bar
      if (polyX > 0 && polyY > 0) {
        const barDuration = beatInterval * timeSigTop;
        const polyXInterval = barDuration / polyX;
        const polyYInterval = barDuration / polyY;

        for (let i = 0; i < polyX; i++) {
          const t = nextNoteTime + i * polyXInterval;
          if (t >= nextNoteTime && t < nextNoteTime + beatInterval) {
            scheduleClick(t, "polyX");
          }
        }

        for (let j = 0; j < polyY; j++) {
          const t = nextNoteTime + j * polyYInterval;
          if (t >= nextNoteTime && t < nextNoteTime + beatInterval) {
            scheduleClick(t, "polyY");
          }
        }
      }
    }

    // Visual pulse is approximated with setTimeout synced to audio time
    const now = audioCtx.currentTime;
    const delay = Math.max(0, (nextNoteTime - now) * 1000);
    const beatIndexForVisual = barBeatIndex;
    const hasSubdivision = true;
    // Use a helper to avoid declaring a function inside the loop body
    scheduleVisualPulse(delay, beatIndexForVisual, hasSubdivision);

    nextNote();
  }
}

function scheduleVisualPulse(delayMs, beatIndex, hasSubdivision) {
  setTimeout(function () {
    const isDb = beatIndex === 0;
    pulseBeatIndicators(isDb, hasSubdivision);
  }, delayMs);
}

function scheduler() {
  if (!isRunning) return;
  scheduleNotes();
  timerID = setTimeout(scheduler, lookahead);
}

function handleBarAdvanced() {
  if (speedTrainerEnabled) {
    const newBpm = Math.min(speedMax, bpm + speedStep);
    if (newBpm !== bpm) {
      updateBpm(newBpm);
      speedTrainerStatusEl.textContent = `Ramping: ${Math.round(bpm)} BPM`;
    } else {
      speedTrainerStatusEl.textContent = `Maxed at ${Math.round(bpm)} BPM`;
    }
  }

  if (!speedTrainerEnabled) {
    speedTrainerStatusEl.textContent = "Idle";
  }

  if (gapClickEnabled) {
    const totalCycle = gapPlayBars + gapMuteBars;
    if (totalCycle > 0) {
      const barIndexInCycle = (currentBar - 1) % totalCycle;
      if (barIndexInCycle < gapPlayBars) {
        gapClickStatusEl.textContent = `Clicking (bar ${barIndexInCycle + 1}/${gapPlayBars})`;
      } else {
        gapClickStatusEl.textContent = `Muted (bar ${barIndexInCycle - gapPlayBars + 1}/${gapMuteBars})`;
      }
    }
  } else {
    gapClickStatusEl.textContent = "Playing always";
  }
}

// SECTION: Transport
function startMetronome() {
  initAudioContext();
  if (isRunning) return;

  beatInterval = 60 / bpm;
  currentBeatInBar = 0;
  barBeatIndex = 0;
  currentBar = 1;

  nextNoteTime = audioCtx.currentTime + 0.1;
  isRunning = true;
  scheduler();

  startStopBtn.querySelector(".btn-label").textContent = "Stop";
  startStopBtn.setAttribute("aria-pressed", "true");
  transportStatusEl.textContent = `Running at ${Math.round(bpm)} BPM`;
}

function stopMetronome() {
  isRunning = false;
  if (timerID) clearTimeout(timerID);
  startStopBtn.querySelector(".btn-label").textContent = "Start";
  startStopBtn.setAttribute("aria-pressed", "false");
  transportStatusEl.textContent = "Stopped";
}

// SECTION: Tap Tempo
function handleTap() {
  const now = performance.now();

  if (now - lastTapTime > TAP_RESET_MS) {
    tapTimes.length = 0;
  }

  tapTimes.push(now);
  lastTapTime = now;

  if (tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const tappedBpm = 60000 / avgIntervalMs;
    updateBpm(tappedBpm);
  }
}

// SECTION: Timing Analyzer
function registerHit(source) {
  if (!audioCtx) return;
  if (!lastClickTime) return;

  const nowTime = audioCtx.currentTime;
  // Convert click time to nearest beat center
  const clickTime = lastClickTime;
  const offsetSec = nowTime - clickTime;
  const offsetMs = offsetSec * 1000;

  addOffsetMarker(offsetMs);
}

function addOffsetMarker(offsetMs) {
  const clamped = Math.max(-60, Math.min(60, offsetMs));
  const normalized = (clamped + 60) / 120; // 0..1
  const xPercent = normalized * 100;

  const marker = document.createElement("div");
  marker.classList.add("offset-marker");

  const absOffset = Math.abs(offsetMs);
  if (absOffset <= 10) marker.classList.add("green");
  else if (absOffset <= 30) marker.classList.add("orange");
  else marker.classList.add("red");

  marker.style.left = `${xPercent}%`;
  offsetBarsEl.appendChild(marker);

  // Keep only last ~25 hits to avoid clutter
  if (offsetBarsEl.children.length > 25) {
    offsetBarsEl.removeChild(offsetBarsEl.firstChild);
  }

  hitCount++;
  hitCountEl.textContent = hitCount.toString();
  sumOffsets += offsetMs;

  const avg = sumOffsets / hitCount;
  avgOffsetEl.textContent = `${avg.toFixed(1)} ms`;
  lastOffsetEl.textContent = `${offsetMs.toFixed(1)} ms`;
}

async function enableMic() {
  if (micListenerActive) return;
  try {
    initAudioContext();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const micSource = audioCtx.createMediaStreamSource(micStream);
    micAnalyzer = audioCtx.createAnalyser();
    micAnalyzer.fftSize = 2048;
    micDataArray = new Float32Array(micAnalyzer.fftSize);
    micSource.connect(micAnalyzer);
    micListenerActive = true;
    listenMic();
  } catch (e) {
    console.error("Mic access error", e);
  }
}

function listenMic() {
  if (!micListenerActive || !micAnalyzer) return;
  micAnalyzer.getFloatTimeDomainData(micDataArray);

  // simple transient detection based on amplitude threshold
  let peak = 0;
  for (let i = 0; i < micDataArray.length; i++) {
    const v = Math.abs(micDataArray[i]);
    if (v > peak) peak = v;
  }

  if (peak > micThreshold) {
    registerHit("mic");
  }

  requestAnimationFrame(listenMic);
}

function disableMic() {
  micListenerActive = false;
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

// SECTION: Dial Interaction
let dialDragging = false;
let dialStartAngle = 0;
let dialStartBpm = bpm;

function getAngleFromEvent(e) {
  const rect = bpmDialEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const dx = clientX - cx;
  const dy = clientY - cy;
  let angle = Math.atan2(dy, dx); // -PI..PI
  return angle;
}

function onDialPointerDown(e) {
  e.preventDefault();
  dialDragging = true;
  dialStartAngle = getAngleFromEvent(e);
  dialStartBpm = bpm;
  document.addEventListener("mousemove", onDialPointerMove);
  document.addEventListener("mouseup", onDialPointerUp);
  document.addEventListener("touchmove", onDialPointerMove, { passive: false });
  document.addEventListener("touchend", onDialPointerUp);
}

function onDialPointerMove(e) {
  if (!dialDragging) return;
  e.preventDefault();
  const angle = getAngleFromEvent(e);
  let delta = angle - dialStartAngle;
  // normalize
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;

  const sensitivity = 130; // radians to bpm mapping
  const bpmDelta = (delta / (Math.PI * 2)) * sensitivity * 10;
  const newBpm = dialStartBpm + bpmDelta;
  updateBpm(newBpm);
}

function onDialPointerUp() {
  dialDragging = false;
  document.removeEventListener("mousemove", onDialPointerMove);
  document.removeEventListener("mouseup", onDialPointerUp);
  document.removeEventListener("touchmove", onDialPointerMove);
  document.removeEventListener("touchend", onDialPointerUp);
}

function onDialWheel(e) {
  e.preventDefault();
  const delta = e.deltaY;
  const change = delta > 0 ? -1 : 1;
  updateBpm(bpm + change);
}

// SECTION: Mode Tabs & Controls
function initModeTabs() {
  const tabs = document.querySelectorAll(".mode-tab");
  const panels = document.querySelectorAll(".mode-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`mode-${mode}`).classList.add("active");
    });
  });
}

function initHitSourceSwitch() {
  const btnSource = document.getElementById("hitSourceButton");
  const micSourceBtn = document.getElementById("hitSourceMic");

  btnSource.addEventListener("click", () => {
    hitSource = "button";
    btnSource.classList.add("active");
    micSourceBtn.classList.remove("active");
    disableMic();
  });

  micSourceBtn.addEventListener("click", async () => {
    hitSource = "mic";
    micSourceBtn.classList.add("active");
    btnSource.classList.remove("active");
    await enableMic();
  });
}

// SECTION: Event Handlers
function initControls() {
  updateBpm(bpm);

  bpmDialEl.addEventListener("mousedown", onDialPointerDown);
  bpmDialEl.addEventListener("touchstart", onDialPointerDown, { passive: false });
  bpmDialEl.addEventListener("wheel", onDialWheel, { passive: false });

  startStopBtn.addEventListener("click", () => {
    if (!isRunning) {
      startMetronome();
    } else {
      stopMetronome();
    }
  });

  tapTempoBtn.addEventListener("click", handleTap);

  document.getElementById("timeSigTop").addEventListener("change", (e) => {
    timeSigTop = Math.max(1, parseInt(e.target.value, 10) || 4);
  });

  document.getElementById("timeSigBottom").addEventListener("change", (e) => {
    timeSigBottom = Math.max(1, parseInt(e.target.value, 10) || 4);
  });

  document.getElementById("polyX").addEventListener("change", (e) => {
    polyX = Math.max(0, parseInt(e.target.value, 10) || 0);
  });

  document.getElementById("polyY").addEventListener("change", (e) => {
    polyY = Math.max(0, parseInt(e.target.value, 10) || 0);
  });

  document.getElementById("volQuarter").addEventListener("input", updateMixerGains);
  document.getElementById("volEighth").addEventListener("input", updateMixerGains);
  document.getElementById("volSixteenth").addEventListener("input", updateMixerGains);
  document.getElementById("volTriplet").addEventListener("input", updateMixerGains);

  document.getElementById("speedStep").addEventListener("change", (e) => {
    speedStep = Math.max(1, parseInt(e.target.value, 10) || 1);
  });

  document.getElementById("speedEveryBars").addEventListener("change", (e) => {
    speedEveryBars = Math.max(1, parseInt(e.target.value, 10) || 4);
  });

  document.getElementById("speedMax").addEventListener("change", (e) => {
    speedMax = Math.max(30, parseInt(e.target.value, 10) || 180);
  });

  speedTrainerEnabledEl.addEventListener("change", (e) => {
    speedTrainerEnabled = e.target.checked;
  });

  document.getElementById("gapPlayBars").addEventListener("change", (e) => {
    gapPlayBars = Math.max(1, parseInt(e.target.value, 10) || 4);
  });

  document.getElementById("gapMuteBars").addEventListener("change", (e) => {
    gapMuteBars = Math.max(0, parseInt(e.target.value, 10) || 2);
  });

  gapClickEnabledEl.addEventListener("change", (e) => {
    gapClickEnabled = e.target.checked;
  });

  // Accent toggle button
  downbeatBtn.addEventListener("click", () => {
    accentEnabled = !accentEnabled;
    if (accentEnabled) {
      downbeatBtn.classList.remove("active-off");
      downbeatBtn.textContent = "Accent: On";
    } else {
      downbeatBtn.classList.add("active-off");
      downbeatBtn.textContent = "Accent: Off";
    }
  });

  const hitButton = document.getElementById("hitButton");
  hitButton.addEventListener("click", () => {
    if (hitSource === "button") {
      registerHit("button");
    }
  });

  const micThresholdEl = document.getElementById("micThreshold");
  micThresholdEl.addEventListener("input", (e) => {
    micThreshold = parseFloat(e.target.value);
  });

  initModeTabs();
  initHitSourceSwitch();
}

window.addEventListener("load", initControls);
