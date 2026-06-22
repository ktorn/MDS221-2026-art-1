let sourcePainting;
let baseLayer;
let spiralLayer;
let spiralTempLayer;
let smudgeLayer;

const sensor = {
  moveY: 0, // up/down motion
  rotation: 0, // z rotation
  tilt: 0 // side tilt
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
const IMU_STALE_MS = 2000;
const IMU_DISCONNECT_MS = 8000;
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

const APP_SECRETS = window.APP_SECRETS || {};
const REGISTRY_BASE_URL =
  APP_SECRETS.registryBaseUrl || "https://esp-device-registry.xxx.workers.dev";
const DEFAULT_DEVICE_ID = APP_SECRETS.deviceId || "MDS221-2026-1";

function readUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    deviceId: params.get("deviceId") || DEFAULT_DEVICE_ID,
    token: params.get("token") || APP_SECRETS.registryToken || null,
    registry: params.get("registry") || REGISTRY_BASE_URL,
    ws: params.get("ws"),
    wsHost: params.get("wsHost"),
    wsPort: params.get("wsPort") || "81"
  };
}

function hasDirectWs(config) {
  return !!(config.ws || config.wsHost);
}

function needsRegistryLookup(config) {
  return !hasDirectWs(config) && !!(config.deviceId && config.token);
}

async function lookupDeviceEndpoint(config) {
  const base = config.registry.replace(/\/$/, "");
  const url = new URL(`${base}/lookup`);
  url.searchParams.set("device_id", config.deviceId);
  url.searchParams.set("token", config.token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`lookup ${res.status}`);
  }
  const data = await res.json();
  if (!data.lan_ip) throw new Error("no lan_ip");
  const port = data.ws_port || 81;
  return `ws://${data.lan_ip}:${port}`;
}

class ImuWebSocket {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.latest = null;
    this.lastReceivedMs = 0;
    this.errorState = null;
    this.wantConnection = false;
    this.reconnectTimer = null;
  }

  setUrl(url) {
    const wasConnected = this.wantConnection;
    this.disconnect();
    this.url = url;
    if (wasConnected) this.connect();
  }

  connect() {
    this.wantConnection = true;
    this.openSocket();
  }

  openSocket() {
    if (this.socket && this.socket.readyState <= 1) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket = new WebSocket(this.url);
    this.errorState = null;
    this.lastReceivedMs = 0;
    this.latest = null;

    this.socket.onclose = () => {
      this.socket = null;
      if (this.wantConnection) {
        this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
      }
    };
    this.socket.onerror = () => {
      this.errorState = "error";
    };
    this.socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (
          typeof payload.moveY !== "number" ||
          typeof payload.rotation !== "number" ||
          typeof payload.tilt !== "number"
        ) {
          return;
        }
        this.errorState = null;
        this.lastReceivedMs = Date.now();
        this.latest = {
          moveY: constrain(payload.moveY, -1, 1),
          rotation: constrain(payload.rotation, -1, 1),
          tilt: constrain(payload.tilt, -1, 1)
        };
      } catch (err) {
        this.errorState = "bad_data";
      }
    };
  }

  disconnect() {
    this.wantConnection = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.latest = null;
    this.lastReceivedMs = 0;
    this.errorState = null;
  }

  isStale() {
    if (this.lastReceivedMs === 0) return true;
    return Date.now() - this.lastReceivedMs > IMU_STALE_MS;
  }

  getState() {
    if (!this.wantConnection) return "disconnected";
    if (this.errorState) return this.errorState;
    if (!this.socket) {
      return this.reconnectTimer ? "reconnecting" : "disconnected";
    }
    const readyState = this.socket.readyState;
    if (readyState === WebSocket.CONNECTING) return "connecting";
    if (readyState === WebSocket.CLOSING) return "closing";
    if (readyState === WebSocket.CLOSED) return "disconnected";
    if (this.lastReceivedMs === 0) return "waiting";
    if (this.isStale()) return "stale";
    return "connected";
  }

  tick() {
    if (!this.wantConnection) return;
    const ageMs = this.lastReceivedMs === 0 ? null : Date.now() - this.lastReceivedMs;
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      ageMs !== null &&
      ageMs > IMU_DISCONNECT_MS
    ) {
      this.socket.close();
    }
  }
}

const URL_CONFIG = readUrlConfig();
let wsUrl = hasDirectWs(URL_CONFIG)
  ? URL_CONFIG.ws || `ws://${URL_CONFIG.wsHost}:${URL_CONFIG.wsPort}`
  : needsRegistryLookup(URL_CONFIG)
    ? "resolving…"
    : "ws://localhost:8080";
let registryState = needsRegistryLookup(URL_CONFIG)
  ? "resolving"
  : hasDirectWs(URL_CONFIG)
    ? "bypassed"
    : "no token";
let imuInput;

function preload() {
  sourcePainting = loadImage("./assets/source-painting.png");
}

function setup() {
  lastControlActivityMs = millis();
  imuInput = new ImuWebSocket(wsUrl);
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-container");
  pixelDensity(1);
  rebuildLayers();

  if (needsRegistryLookup(URL_CONFIG)) {
    lookupDeviceEndpoint(URL_CONFIG)
      .then((url) => {
        wsUrl = url;
        imuInput.setUrl(url);
        registryState = "ok";
        imuInput.connect();
      })
      .catch((err) => {
        registryState = err.message || "failed";
      });
  } else if (hasDirectWs(URL_CONFIG)) {
    registryState = "bypassed";
    imuInput.connect();
  }
}

function draw() {
  updateFps();
  background(12);
  if (isKeyboardControlActive() && imuInput) {
    imuInput.tick();
  }
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

function isAtRest() {
  return !hasUserInteracted && !isAutoModeActive();
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
    if (imuInput) {
      const frame = imuInput.latest;
      if (frame && !imuInput.isStale()) {
        sensor.moveY = lerp(sensor.moveY, frame.moveY, 0.2);
        sensor.rotation = lerp(sensor.rotation, frame.rotation, 0.2);
        sensor.tilt = lerp(sensor.tilt, frame.tilt, 0.2);
        return;
      }
    }

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

  // Overscan keeps extra pixels outside the viewport so strong warps
  // still reveal image content instead of black/transparent edges.
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

  // Enhance the twist feeling with a subtle center rotation.
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
    // Tile each slice vertically to avoid exposing black gaps when offsetting.
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
  const panelHeight = isKeyboardControlActive() ? 112 : 76;
  const panelTop = height - (panelHeight + 12);
  const fpsLabel = fpsDisplay > 0 ? nf(fpsDisplay, 1, 1) : "--";
  push();
  fill(0, 180);
  noStroke();
  rect(12, panelTop, 520, panelHeight, 8);
  fill(255);
  textSize(14);
  text(`Mode: ${mode}`, 24, panelTop + 26);
  text(`FPS: ${fpsLabel}`, 320, panelTop + 26);
  text(`moveY: ${nf(sensor.moveY, 1, 2)}`, 24, panelTop + 44);
  text(`rotation: ${nf(sensor.rotation, 1, 2)}`, 24, panelTop + 62);
  text(`tilt: ${nf(sensor.tilt, 1, 2)}`, 176, panelTop + 62);
  if (isKeyboardControlActive() && imuInput) {
    text(`WS: ${imuInput.getState()}`, 24, panelTop + 82);
    text(`Endpoint: ${wsUrl}`, 24, panelTop + 100);
    text(`Registry: ${registryState}`, 320, panelTop + 82);
  }
  pop();
}
