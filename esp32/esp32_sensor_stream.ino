#include <WiFi.h>
#include <Wire.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Replace with your network credentials.
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

WebServer server(80);
Adafruit_MPU6050 mpu;
bool imuReady = false;

struct SensorFrame {
  float moveY;
  float rotation;
  float tilt;
};

SensorFrame latestFrame = {0.0f, 0.0f, 0.0f};

static float clampf(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

void updateFrameFromIMU() {
  if (!imuReady) {
    const float t = millis() * 0.001f;
    latestFrame.moveY = sinf(t * 0.9f) * 0.6f;
    latestFrame.rotation = cosf(t * 0.55f) * 0.6f;
    latestFrame.tilt = sinf(t * 0.75f + 1.2f) * 0.6f;
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  mpu.getEvent(&accel, &gyro, &temp);

  // Normalized values in [-1, 1] used by the p5.js artwork.
  const float upDown = clampf(accel.acceleration.y / 9.81f, -1.0f, 1.0f);
  const float rotateZ = clampf(gyro.gyro.z / 2.4f, -1.0f, 1.0f);
  const float tiltX = clampf(accel.acceleration.x / 9.81f, -1.0f, 1.0f);

  // Low-pass smoothing to reduce jitter.
  latestFrame.moveY = latestFrame.moveY * 0.88f + upDown * 0.12f;
  latestFrame.rotation = latestFrame.rotation * 0.88f + rotateZ * 0.12f;
  latestFrame.tilt = latestFrame.tilt * 0.88f + tiltX * 0.12f;
}

void handleRoot() {
  server.send(200, "text/plain", "ESP32 IMU stream online. Use /imu for JSON.");
}

void handleImuJson() {
  StaticJsonDocument<256> doc;
  doc["moveY"] = latestFrame.moveY;
  doc["rotation"] = latestFrame.rotation;
  doc["tilt"] = latestFrame.tilt;
  doc["millis"] = millis();

  String payload;
  serializeJson(doc, payload);
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", payload);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin();
  imuReady = mpu.begin();
  if (imuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("MPU6050 initialized.");
  } else {
    Serial.println("MPU6050 not found. Falling back to mock waveform output.");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(450);
  }
  Serial.println();
  Serial.print("Connected. IP: ");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/imu", HTTP_GET, handleImuJson);
  server.begin();
}

void loop() {
  updateFrameFromIMU();
  server.handleClient();
  delay(16);
}
