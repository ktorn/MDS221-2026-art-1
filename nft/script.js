"use strict";

// Teia OBJKT params (injected after mint; false locally if viewer not synced)
const creator = new URLSearchParams(window.location.search).get("creator");
const viewer = new URLSearchParams(window.location.search).get("viewer");

let sourcePainting;
let baseLayer;
let spiralLayer;
let spiralTempLayer;
let smudgeLayer;

const sensor = {
  moveY: 0,
  rotation: 0,
  tilt: 0
};

const mockTargets = {
  moveY: 0,
  rotation: 0,
  tilt: 0
};

let showDebugPanes = false;
let autoDriftPhase = 0;
const KEYBOARD_INACTIVITY_MS = 30000;
const FPS_SAMPLE_MS = 500;
const BASE_OVERSCAN = 1.35;
const SMUDGE_SCALE = 0.5;
const MAX_SMUDGE_STEPS = 8;
const SMUDGE_TILT_THRESHOLD = 0.03;
const IDLE_WAVE_SPEED = 0.007;
const IDLE_WAVE_MOVE_AMP = 0.22;
const IDLE_WAVE_ROT_AMP = 0.05;
const REST_WAVE_MOVE_AMP = 0.04;
const REST_WAVE_ROT_AMP = 0.015;
let lastControlActivityMs = 0;
let hasUserInteracted = false;
let fpsDisplay = 0;
let fpsFrameCount = 0;
let fpsWindowStartMs = 0;

function preload() {
  sourcePainting = loadImage("assets/source-painting.png");
}

function setup() {
  lastControlActivityMs = millis();
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  rebuildLayers();
}

function draw() {
  updateFps();
  background(12);
  updateSensorState();
  renderBasePainting();
  applySpiralWarp();
  applyTiltSmudge();
  applyVerticalSliceDrift();
  if (showDebugPanes) {
    drawDebugInfo();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  rebuildLayers();
}

function rebuildLayers() {
  baseLayer = createGraphics(width, height);
  spiralLayer = createGraphics(width, height);
  spiralTempLayer = createGraphics(width, height);
  smudgeLayer = createGraphics(ceil(width * SMUDGE_SCALE), ceil(height * SMUDGE_SCALE));
}

function markKeyboardActivity() {
  hasUserInteracted = true;
  lastControlActivityMs = millis();
}

function updateFps() {
  const now = millis();
  if (fpsWindowStartMs === 0) {
    fpsWindowStartMs = now;
    return;
  }

  fpsFrameCount++;
  const elapsed = now - fpsWindowStartMs;
  if (elapsed < FPS_SAMPLE_MS) return;

  fpsDisplay = (fpsFrameCount * 1000) / elapsed;
  fpsFrameCount = 0;
  fpsWindowStartMs = now;
}

function isAutoModeActive() {
  return millis() - lastControlActivityMs >= KEYBOARD_INACTIVITY_MS;
}

function isKeyboardControlActive() {
  return hasUserInteracted && !isAutoModeActive();
}

function updateSensorState() {
  if (isAutoModeActive()) {
    autoDriftPhase += IDLE_WAVE_SPEED;
    const wave = sin(autoDriftPhase);
    const ripple = sin(autoDriftPhase * 0.62 + 1.1);

    mockTargets.moveY = lerp(mockTargets.moveY, 0, 0.02);
    mockTargets.rotation = lerp(mockTargets.rotation, 0, 0.02);
    mockTargets.tilt = lerp(mockTargets.tilt, 0, 0.02);

    const idleMoveY = wave * IDLE_WAVE_MOVE_AMP + ripple * 0.06;
    const idleRot = sin(autoDriftPhase * 0.38) * IDLE_WAVE_ROT_AMP;

    sensor.moveY = lerp(sensor.moveY, idleMoveY, 0.14);
    sensor.rotation = lerp(sensor.rotation, idleRot, 0.1);
    sensor.tilt = lerp(sensor.tilt, 0, 0.1);
    return;
  }

  if (isKeyboardControlActive()) {
    sensor.moveY = lerp(sensor.moveY, mockTargets.moveY, 0.1);
    sensor.rotation = lerp(sensor.rotation, mockTargets.rotation, 0.1);
    sensor.tilt = lerp(sensor.tilt, mockTargets.tilt, 0.1);
    return;
  }

  autoDriftPhase += IDLE_WAVE_SPEED * 0.7;
  const wave = sin(autoDriftPhase);
  const restMoveY = wave * REST_WAVE_MOVE_AMP;
  const restRot = sin(autoDriftPhase * 0.38) * REST_WAVE_ROT_AMP;

  sensor.moveY = lerp(sensor.moveY, restMoveY, 0.08);
  sensor.rotation = lerp(sensor.rotation, restRot, 0.08);
  sensor.tilt = lerp(sensor.tilt, 0, 0.08);
}

function renderBasePainting() {
  baseLayer.clear();
  baseLayer.push();

  const sourceRatio = sourcePainting.width / sourcePainting.height;
  const targetRatio = width / height;
  let drawW = width;
  let drawH = height;
  let drawX = 0;
  let drawY = 0;

  if (sourceRatio > targetRatio) {
    drawW = height * sourceRatio;
    drawX = (width - drawW) * 0.5;
  } else {
    drawH = width / sourceRatio;
    drawY = (height - drawH) * 0.5;
  }

  drawW *= BASE_OVERSCAN;
  drawH *= BASE_OVERSCAN;
  drawX = (width - drawW) * 0.5;
  drawY = (height - drawH) * 0.5;

  baseLayer.image(sourcePainting, drawX, drawY, drawW, drawH);
  baseLayer.pop();
}

function applySpiralWarp() {
  const strength = sensor.rotation;
  const rowStep = 3;
  const colStep = 3;
  const cx = width * 0.5;
  const cy = height * 0.5;

  spiralLayer.clear();
  spiralLayer.image(baseLayer, 0, 0);

  for (let y = 0; y < height; y += rowStep) {
    const normY = (y - cy) / height;
    const shiftX = normY * strength * 180;
    spiralLayer.copy(baseLayer, 0, y, width, rowStep, shiftX, y, width, rowStep);
  }

  spiralTempLayer.clear();
  spiralTempLayer.image(spiralLayer, 0, 0);
  spiralLayer.clear();
  spiralLayer.image(spiralTempLayer, 0, 0);

  for (let x = 0; x < width; x += colStep) {
    const normX = (x - cx) / width;
    const shiftY = -normX * strength * 180;
    spiralLayer.copy(spiralTempLayer, x, 0, colStep, height, x, shiftY, colStep, height);
  }

  spiralLayer.push();
  spiralLayer.translate(cx, cy);
  spiralLayer.rotate(strength * 0.25);
  spiralLayer.imageMode(CENTER);
  spiralLayer.tint(255, 42);
  spiralLayer.image(spiralTempLayer, 0, 0);
  spiralLayer.noTint();
  spiralLayer.pop();
}

function applyTiltSmudge() {
  const tiltStrength = sensor.tilt;
  smudgeLayer.clear();

  if (abs(tiltStrength) < SMUDGE_TILT_THRESHOLD) {
    smudgeLayer.image(spiralLayer, 0, 0, smudgeLayer.width, smudgeLayer.height);
    return;
  }

  const direction = Math.sign(tiltStrength) || 1;
  const steps = max(1, floor(abs(tiltStrength) * MAX_SMUDGE_STEPS));
  const maxOffset = abs(tiltStrength) * 50 * SMUDGE_SCALE;

  smudgeLayer.image(spiralLayer, 0, 0, smudgeLayer.width, smudgeLayer.height);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const offset = direction * t * maxOffset;
    const alpha = map(i, 1, steps, 40, 4);
    smudgeLayer.tint(255, alpha);
    smudgeLayer.image(spiralLayer, offset, 0, smudgeLayer.width, smudgeLayer.height);
  }
  smudgeLayer.noTint();
}

function applyVerticalSliceDrift() {
  const slices = 42;
  const sliceWidth = width / slices;
  const driftAmp = sensor.moveY * 52;
  const srcSliceWidth = (sliceWidth + 1) * SMUDGE_SCALE;

  imageMode(CORNER);

  for (let i = 0; i < slices; i++) {
    const sx = i * sliceWidth;
    const srcX = sx * SMUDGE_SCALE;
    const wobble = sin(frameCount * 0.07 + i * 0.72) * driftAmp;
    image(smudgeLayer, sx, wobble - height, sliceWidth + 1, height, srcX, 0, srcSliceWidth, smudgeLayer.height);
    image(smudgeLayer, sx, wobble, sliceWidth + 1, height, srcX, 0, srcSliceWidth, smudgeLayer.height);
    image(smudgeLayer, sx, wobble + height, sliceWidth + 1, height, srcX, 0, srcSliceWidth, smudgeLayer.height);
  }
}

function keyPressed() {
  if (key === "w" || key === "W") {
    markKeyboardActivity();
    mockTargets.moveY = constrain(mockTargets.moveY - 0.18, -1, 1);
  }
  if (key === "s" || key === "S") {
    markKeyboardActivity();
    mockTargets.moveY = constrain(mockTargets.moveY + 0.18, -1, 1);
  }
  if (key === "q" || key === "Q") {
    markKeyboardActivity();
    mockTargets.rotation = constrain(mockTargets.rotation - 0.18, -1, 1);
  }
  if (key === "e" || key === "E") {
    markKeyboardActivity();
    mockTargets.rotation = constrain(mockTargets.rotation + 0.18, -1, 1);
  }
  if (key === "a" || key === "A") {
    markKeyboardActivity();
    mockTargets.tilt = constrain(mockTargets.tilt - 0.18, -1, 1);
  }
  if (key === "d" || key === "D") {
    markKeyboardActivity();
    mockTargets.tilt = constrain(mockTargets.tilt + 0.18, -1, 1);
  }
  if (key === "r" || key === "R") {
    markKeyboardActivity();
    mockTargets.moveY = 0;
    mockTargets.rotation = 0;
    mockTargets.tilt = 0;
  }
  if (key === "b" || key === "B") {
    showDebugPanes = !showDebugPanes;
  }
}

function drawDebugInfo() {
  const mode = isAutoModeActive() ? "auto" : isKeyboardControlActive() ? "keyboard" : "at rest";
  const panelTop = height - 88;
  const fpsLabel = fpsDisplay > 0 ? nf(fpsDisplay, 1, 1) : "--";
  push();
  fill(0, 180);
  noStroke();
  rect(12, panelTop, 520, 76, 8);
  fill(255);
  textSize(14);
  text(`Mode: ${mode}`, 24, panelTop + 26);
  text(`FPS: ${fpsLabel}`, 320, panelTop + 26);
  text(`moveY: ${nf(sensor.moveY, 1, 2)}`, 24, panelTop + 44);
  text(`rotation: ${nf(sensor.rotation, 1, 2)}`, 24, panelTop + 62);
  text(`tilt: ${nf(sensor.tilt, 1, 2)}`, 176, panelTop + 62);
  pop();
}
