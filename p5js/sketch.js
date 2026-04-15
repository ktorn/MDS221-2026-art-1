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
let autoDriftPhase = 0;
let esp32Endpoint = "http://192.168.1.200/imu";
let lastSensorPoll = 0;
const SENSOR_POLL_MS = 50;

function preload() {
  sourcePainting = loadImage("./assets/source-painting.png");
}

function setup() {
  const canvas = createCanvas(900, 900);
  canvas.parent("canvas-container");

  baseLayer = createGraphics(width, height);
  spiralLayer = createGraphics(width, height);
  spiralTempLayer = createGraphics(width, height);
  smudgeLayer = createGraphics(width, height);
}

function draw() {
  background(12);
  updateSensorState();
  renderBasePainting();
  applySpiralWarp();
  applyTiltSmudge();
  applyVerticalSliceDrift();
  drawDebugInfo();
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
  } else {
    pollEsp32Sensor();
  }
}

function pollEsp32Sensor() {
  const now = millis();
  if (now - lastSensorPoll < SENSOR_POLL_MS) {
    return;
  }
  lastSensorPoll = now;

  fetch(esp32Endpoint)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const nextMove = constrain(Number(data.moveY) || 0, -1, 1);
      const nextRot = constrain(Number(data.rotation) || 0, -1, 1);
      const nextTilt = constrain(Number(data.tilt) || 0, -1, 1);
      sensor.moveY = lerp(sensor.moveY, nextMove, 0.2);
      sensor.rotation = lerp(sensor.rotation, nextRot, 0.2);
      sensor.tilt = lerp(sensor.tilt, nextTilt, 0.2);
    })
    .catch(() => {
      // Keep previous values on network dropouts.
    });
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

  for (let y = 0; y < height; y += rowStep) {
    const normY = (y - cy) / height;
    const shiftX = normY * strength * 180;
    spiralLayer.copy(baseLayer, 0, y, width, rowStep, shiftX, y, width, rowStep);
  }

  spiralTempLayer.clear();
  spiralTempLayer.image(spiralLayer, 0, 0);
  spiralLayer.clear();

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
    image(smudgeLayer, sx, wobble, sliceWidth + 1, height, sx, 0, sliceWidth + 1, height);
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
  }
}

function drawDebugInfo() {
  const panelHeight = useMockSensor ? 76 : 96;
  const panelTop = height - (panelHeight + 12);
  push();
  fill(0, 180);
  noStroke();
  rect(12, panelTop, 480, panelHeight, 8);
  fill(255);
  textSize(14);
  text(`Mock sensor: ${useMockSensor ? "ON" : "OFF"}`, 24, panelTop + 26);
  text(`moveY: ${nf(sensor.moveY, 1, 2)}`, 24, panelTop + 44);
  text(`rotation: ${nf(sensor.rotation, 1, 2)}`, 24, panelTop + 62);
  text(`tilt: ${nf(sensor.tilt, 1, 2)}`, 176, panelTop + 62);
  if (!useMockSensor) {
    text(`ESP32: ${esp32Endpoint}`, 24, panelTop + 82);
  }
  pop();
}
