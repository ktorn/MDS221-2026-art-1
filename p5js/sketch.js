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

let useMockSensor = true;
let showDebugPanes = false;
let autoDriftPhase = 0;
const IMU_STALE_MS = 500;

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
      ageMs > IMU_STALE_MS * 2
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
const BASE_OVERSCAN = 1.35;

function preload() {
  sourcePainting = loadImage("./assets/source-painting.png");
}

function setup() {
  imuInput = new ImuWebSocket(wsUrl);
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-container");
  rebuildLayers();
  updateDebugPanesVisibility();

  if (needsRegistryLookup(URL_CONFIG)) {
    lookupDeviceEndpoint(URL_CONFIG)
      .then((url) => {
        wsUrl = url;
        imuInput.setUrl(url);
        registryState = "ok";
        if (!useMockSensor) {
          imuInput.connect();
        }
      })
      .catch((err) => {
        registryState = err.message || "failed";
      });
  } else if (hasDirectWs(URL_CONFIG) && !useMockSensor) {
    registryState = "bypassed";
    imuInput.connect();
  }
}

function draw() {
  background(12);
  if (!useMockSensor && imuInput) {
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
  rebuildLayers();
}

function rebuildLayers() {
  baseLayer = createGraphics(width, height);
  spiralLayer = createGraphics(width, height);
  spiralTempLayer = createGraphics(width, height);
  smudgeLayer = createGraphics(width, height);
}

function updateSensorState() {
  if (useMockSensor) {
    autoDriftPhase += 0.012;
    // Small idle movement keeps the artwork alive even without key input.
    const idleMove = sin(autoDriftPhase) * 0.12;
    const idleRot = cos(autoDriftPhase * 0.7) * 0.15;
    const idleTilt = sin(autoDriftPhase * 0.5 + 1.8) * 0.1;

    sensor.moveY = lerp(sensor.moveY, constrain(mockTargets.moveY + idleMove, -1, 1), 0.1);
    sensor.rotation = lerp(sensor.rotation, constrain(mockTargets.rotation + idleRot, -1, 1), 0.1);
    sensor.tilt = lerp(sensor.tilt, constrain(mockTargets.tilt + idleTilt, -1, 1), 0.1);
  } else if (imuInput) {
    const frame = imuInput.latest;
    if (frame && !imuInput.isStale()) {
      sensor.moveY = lerp(sensor.moveY, frame.moveY, 0.2);
      sensor.rotation = lerp(sensor.rotation, frame.rotation, 0.2);
      sensor.tilt = lerp(sensor.tilt, frame.tilt, 0.2);
    }
  }
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
  const direction = Math.sign(tiltStrength) || 1;
  const steps = floor(abs(tiltStrength) * 24);
  const maxOffset = abs(tiltStrength) * 50;

  smudgeLayer.clear();
  smudgeLayer.image(spiralLayer, 0, 0);

  for (let i = 1; i <= steps; i++) {
    const t = i / max(steps, 1);
    const offset = direction * t * maxOffset;
    const alpha = map(i, 1, max(steps, 1), 40, 4);
    smudgeLayer.tint(255, alpha);
    smudgeLayer.image(spiralLayer, offset, 0);
  }
  smudgeLayer.noTint();
}

function applyVerticalSliceDrift() {
  const slices = 42;
  const sliceWidth = width / slices;
  const driftAmp = sensor.moveY * 52;

  imageMode(CORNER);

  for (let i = 0; i < slices; i++) {
    const sx = i * sliceWidth;
    const wobble = sin(frameCount * 0.07 + i * 0.72) * driftAmp;
    // Tile each slice vertically to avoid exposing black gaps when offsetting.
    image(smudgeLayer, sx, wobble - height, sliceWidth + 1, height, sx, 0, sliceWidth + 1, height);
    image(smudgeLayer, sx, wobble, sliceWidth + 1, height, sx, 0, sliceWidth + 1, height);
    image(smudgeLayer, sx, wobble + height, sliceWidth + 1, height, sx, 0, sliceWidth + 1, height);
  }
}

function keyPressed() {
  if (key === "w" || key === "W") {
    mockTargets.moveY = constrain(mockTargets.moveY - 0.18, -1, 1);
  }
  if (key === "s" || key === "S") {
    mockTargets.moveY = constrain(mockTargets.moveY + 0.18, -1, 1);
  }
  if (key === "q" || key === "Q") {
    mockTargets.rotation = constrain(mockTargets.rotation - 0.18, -1, 1);
  }
  if (key === "e" || key === "E") {
    mockTargets.rotation = constrain(mockTargets.rotation + 0.18, -1, 1);
  }
  if (key === "a" || key === "A") {
    mockTargets.tilt = constrain(mockTargets.tilt - 0.18, -1, 1);
  }
  if (key === "d" || key === "D") {
    mockTargets.tilt = constrain(mockTargets.tilt + 0.18, -1, 1);
  }
  if (key === "r" || key === "R") {
    mockTargets.moveY = 0;
    mockTargets.rotation = 0;
    mockTargets.tilt = 0;
  }
  if (key === "m" || key === "M") {
    useMockSensor = !useMockSensor;
    if (imuInput) {
      if (useMockSensor) {
        imuInput.disconnect();
      } else {
        imuInput.connect();
      }
    }
  }
  if (key === "b" || key === "B") {
    showDebugPanes = !showDebugPanes;
    updateDebugPanesVisibility();
  }
}

function updateDebugPanesVisibility() {
  const hud = document.querySelector(".hud");
  if (hud) {
    hud.style.display = showDebugPanes ? "" : "none";
  }
}

function drawDebugInfo() {
  const panelHeight = useMockSensor ? 76 : 112;
  const panelTop = height - (panelHeight + 12);
  push();
  fill(0, 180);
  noStroke();
  rect(12, panelTop, 520, panelHeight, 8);
  fill(255);
  textSize(14);
  text(`Mock sensor: ${useMockSensor ? "ON" : "OFF"}`, 24, panelTop + 26);
  text(`moveY: ${nf(sensor.moveY, 1, 2)}`, 24, panelTop + 44);
  text(`rotation: ${nf(sensor.rotation, 1, 2)}`, 24, panelTop + 62);
  text(`tilt: ${nf(sensor.tilt, 1, 2)}`, 176, panelTop + 62);
  if (!useMockSensor && imuInput) {
    text(`WS: ${imuInput.getState()}`, 24, panelTop + 82);
    text(`Endpoint: ${wsUrl}`, 24, panelTop + 100);
    text(`Registry: ${registryState}`, 320, panelTop + 82);
  }
  pop();
}
