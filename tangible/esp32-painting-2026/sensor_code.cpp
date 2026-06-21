#include "sensor_code.h"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BNO055.h>

#ifndef BNO_SDA_PIN
#define BNO_SDA_PIN 8
#endif

#ifndef BNO_SCL_PIN
#define BNO_SCL_PIN 9
#endif

static Adafruit_BNO055 bno(55, 0x28, &Wire);
static bool gSensorReady = false;
static SensorFrame gFrame = {0.0f, 0.0f, 0.0f};

static float clampf(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

static float lerpFrame(float current, float target, float t) {
  return current + (target - current) * t;
}

bool sensorCodeBegin() {
  Wire.begin(BNO_SDA_PIN, BNO_SCL_PIN);
  Wire.setClock(100000);

  Serial.println("[Sensor] starting BNO055...");

  if (!bno.begin(OPERATION_MODE_IMUPLUS)) {
    Serial.println("[Sensor] BNO055 not detected. Check wiring.");
    return false;
  }

  delay(1000);
  bno.setExtCrystalUse(true);

  gSensorReady = true;
  gFrame = {0.0f, 0.0f, 0.0f};

  Serial.println("[Sensor] BNO055 ready (IMU mode: accel + gyro).");
  return true;
}

void sensorCodeUpdate() {
  if (!gSensorReady) return;

  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);

  // Normalized values in [-1, 1] used by the p5.js artwork.
  const float upDown = clampf(accel.y() / 9.81f, -1.0f, 1.0f);
  const float rotateZ = clampf(gyro.z() / 2.4f, -1.0f, 1.0f);
  const float tiltX = clampf(accel.x() / 9.81f, -1.0f, 1.0f);

  gFrame.moveY = lerpFrame(gFrame.moveY, upDown, 0.12f);
  gFrame.rotation = lerpFrame(gFrame.rotation, rotateZ, 0.12f);
  gFrame.tilt = lerpFrame(gFrame.tilt, tiltX, 0.12f);
}

SensorFrame sensorCodeGetFrame() {
  return gFrame;
}
