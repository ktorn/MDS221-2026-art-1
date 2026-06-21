#pragma once

// BNO055 gyro + accelerometer normalized to [-1, 1] for moveY, rotation, tilt.
// Requires Adafruit_BNO055 + Adafruit Unified Sensor (Arduino Library Manager).

struct SensorFrame {
  float moveY;
  float rotation;
  float tilt;
};

bool sensorCodeBegin();
void sensorCodeUpdate();
SensorFrame sensorCodeGetFrame();
