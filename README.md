# MDS221-2026-art-1

Interactive artwork prototype with:

- `p5js` visual system
- `ESP32-S3` WiFi sensor sender (gyro + accelerometer)

## Structure

- `p5js/index.html` - artwork entry page
- `p5js/sketch.js` - visual effects + mock sensor + ESP32 polling
- `p5js/assets/source-painting.png` - source painting image
- `esp32/esp32_sensor_stream.ino` - ESP32 firmware sketch

## Run the artwork (mock mode)

1. Open a local static server in `p5js`.
   - If Python is available: `python -m http.server 8080`
   - If Python is NOT available (Windows PowerShell): `powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080`
2. Open `http://localhost:8080`.
3. The sketch starts in mock mode by default.

Keyboard controls:

- `W/S`: simulate up/down movement -> vertical slicing drift
- `Q/E`: simulate rotation -> spiral warp
- `A/D`: simulate sideways tilt -> directional smudge
- `M`: toggle mock mode on/off
- `R`: reset mock values

## Connect to ESP32

1. Upload `esp32/esp32_sensor_stream.ino` to the board.
2. Edit WiFi credentials in the sketch.
3. Install required Arduino libraries:
   - `ArduinoJson`
   - `Adafruit MPU6050`
   - `Adafruit Unified Sensor`
4. Read serial output for ESP32 IP.
5. Update `esp32Endpoint` in `p5js/sketch.js` to `http://<ESP32_IP>/imu`.
6. Press `M` to disable mock mode.

The ESP32 endpoint response format:

```json
{
  "moveY": 0.12,
  "rotation": -0.31,
  "tilt": 0.44,
  "millis": 123456
}
```
