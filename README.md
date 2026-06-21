# MDS221-2026-art-1

Interactive artwork prototype with:

- `p5js` visual system
- `ESP32-S3` + BNO055 gyro/accelerometer over WebSocket

## Structure

- `p5js/index.html` - artwork entry page
- `p5js/sketch.js` - visual effects + mock sensor + ESP32 WebSocket
- `p5js/assets/source-painting.png` - source painting image
- `tangible/esp32-painting-2026/` - ESP32 firmware (BNO055, WiFi, WebSocket)

## Run the artwork (mock mode)

1. Copy `p5js/secrets.example.js` to `p5js/secrets.js` (needed for registry lookup when using ESP32).
2. Open a local static server in `p5js`.
   - If Python is available: `python -m http.server 8080`
   - If Python is NOT available (Windows PowerShell): `powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080`
3. Open `http://localhost:8080`.
4. The sketch starts in mock mode by default.

Keyboard controls:

- `W/S`: simulate up/down movement → vertical slicing drift
- `Q/E`: simulate rotation → spiral warp
- `A/D`: simulate sideways tilt → directional smudge
- `M`: toggle mock mode on/off (WebSocket when off)
- `R`: reset mock values
- `B`: toggle debug panes

## Connect to ESP32

1. Copy `tangible/esp32-painting-2026/secrets.example.h` to `secrets.h` and fill in WiFi + registry values.
2. Flash `tangible/esp32-painting-2026/esp32-painting-2026.ino` (Arduino IDE, ESP32-S3, USB CDC On Boot enabled).
3. Install Arduino libraries: **Adafruit BNO055**, **Adafruit Unified Sensor**, **WebSockets** (links2003).
4. ESP32 serves WebSocket on port `81` at `ws://<device-ip>:81/`.

### ESP32 LAN IP lookup (registry)

1. Copy `p5js/secrets.example.js` to `p5js/secrets.js` (same `registryToken` and `deviceId` as `secrets.h`).
2. On startup the page calls the cloud registry `/lookup` endpoint and resolves `ws://<lan_ip>:81`.
3. Press `M` to switch off mock mode once registry shows `ok`.

Overrides:

- URL params: `?deviceId=MDS221-2026-1&token=...`
- Direct LAN IP: `?wsHost=192.168.1.50` or `?ws=ws://192.168.1.50:81`

Expected WebSocket message format:

```json
{
  "moveY": 0.12,
  "rotation": -0.31,
  "tilt": 0.44,
  "source": "esp32",
  "ts": 123456
}
```

## Tangible / ESP32

Firmware lives in `tangible/esp32-painting-2026/`, following the same layout as MDS221-2026-art-4.

| File | Purpose |
|------|---------|
| `esp32-painting-2026.ino` | WiFi + WebSocket broadcaster |
| `sensor_code.h` / `sensor_code.cpp` | BNO055 accel + gyro → moveY, rotation, tilt |
| `secrets.example.h` | WiFi and cloud registry config template |

### BNO055 wiring & libraries

- I2C: SDA `GPIO8`, SCL `GPIO9` (100 kHz)
- Arduino libraries: **Adafruit BNO055**, **Adafruit Unified Sensor**
- Streams normalized motion values over WebSocket for the painting warp effects
