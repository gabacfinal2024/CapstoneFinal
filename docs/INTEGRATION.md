# AgriResQ: running the integrated system

```
ESP32-CAM ──Wi-Fi──► Django backend (laptop :8000) ──► Supabase (accounts, batches, marketplace, chat)
  camera + DHT22        freshness CNN (ML/deploy)            ▲
                        devices, scans, readings              │
Web app (:5173) ─────────────┴───────────────────────────────┤
Mobile app (:5174 / APK) ────────────────────────────────────┘
```

| Part | Folder | What it does |
|---|---|---|
| ML | `ML/` | EfficientNet-B0 freshness CNN (10 outputs: cucumber/carrot/eggplant × fresh/at-risk/rotten + "none" so other objects are rejected). Results in `ML/results`, details in `ML/README.md` |
| Backend | `agriresq_core/` | Django: device pairing, live-view proxy, CNN scans, readings, Supabase sync |
| Firmware | `src/main.cpp`, `platformio.ini` | ESP32-CAM: setup hotspot, heartbeat/commands, scans, live stream, DHT22 |
| Web | `agriresq_web/` | Operator dashboard: Devices, Live Camera, Sensors, batches, marketplace |
| Mobile | `agriresq_mobile/` | Operator/buyer app: Devices tab with the *Add device* wizard |
| API contract | `docs/IOT_DEVICE_API.md` | All device endpoints |

## 1. Start everything
Double-click **`start_agriresq.bat`**. It opens three windows: backend on :8000, web on :5173, and
mobile on :5174. The laptop, the phone and the camera must share the same Wi-Fi.

Optional, but needed for camera results to change batch freshness, prices, listings and notifications:
copy `.env.example` to `.env` and paste the Supabase **service_role** key.

## 2. Add the camera (stall operator, no code edits)
1. Power the ESP32-CAM. A slow-blinking red LED means it is ready to set up.
2. On the phone, open `http://<laptop-IP>:5174` (or the APK) and log in as a stall operator.
   Go to **Devices → Add device**.
3. Enter the name, stall and crop. The app shows a pairing code.
4. In the phone's Wi-Fi settings, join **AgriResQ-XXXX** (password `agriresq`). If Android says
   "no internet", choose *stay connected*, and turn mobile data off during setup.
5. Back in the app, pick the stall Wi-Fi (**2.4 GHz only**) and type its password.
6. When asked, reconnect the phone to the normal Wi-Fi. The device then shows as **Online**.

On the device page: live view, **Scan now**, crop, **linked batch**, auto-scan interval, DHT22 pin,
flash, restart, forget Wi-Fi, and remove.

**Reset the camera:** power-cycle it 3 times within 10 s, or use *Forget Wi-Fi* in the app.
If the saved Wi-Fi disappears for 60 s, the hotspot comes back by itself.

**The laptop's address changed?** (new router, different Wi-Fi, DHCP) – nothing to do. After 3 failed heartbeats the
camera broadcasts "where is the server?" on the network; the backend (UDP 41234) answers with its current address, signed
with the camera's own token, and the camera saves it. Keep the backend running (`runserver 0.0.0.0:8000`).

## 2a. Add the DHT22 sensor node

1. In the hosted AgriResQ app, open **Devices → Add device**, choose **ESP32 sensor node (DHT22)**, and create a pairing code.
2. Join the sensor's `AgriResQ-SENSOR-XXXX` Wi-Fi from the phone (password `agriresq`) and stay connected if warned about no internet.
3. Open the setup address shown in the app. Enter the stall's 2.4 GHz Wi-Fi credentials and submit; the HTTPS server URL and pairing code are prefilled.
4. Reconnect the phone to internet Wi-Fi and return to AgriResQ. The sensor joins Wi-Fi and securely registers to the same hosted backend as the camera. Readings are uploaded every 30 seconds and refreshed in the app every five seconds.

The sensor, camera and dashboard must use the **same backend**. Production builds default to the hosted API; local development keeps using the laptop backend. A laptop is needed only to flash or update the sensor firmware; pairing and Wi-Fi setup are done from the phone.

## 2b. Chat notifications and listing photo checks

Each chat message creates a `NEW_MESSAGE` notification for the other participant. When the sender changes,
the recipient changes too, so both rescue buyers and stall operators receive in-app alerts. Apply the
latest `supabase/005_notification_triggers.sql` in the Supabase SQL editor to add the chat link and enable
database notifications and Realtime delivery. The app shows an unread badge and a toast that opens the
correct conversation; browser alerts can be enabled from the Notifications page when supported. Each chat
also shows the listing photo, crop, quantity, listed price, and pickup location, with a link to the listing.

Product photos are analyzed before a product is saved. Photos with no recognized supported vegetable,
a crop mismatch, or low-confidence freshness analysis are rejected; retake the photo or correct the crop
before saving the product to listings.

## 3. What happens on each scan
Camera JPEG → Django runs the CNN → one of four outcomes:

| Outcome | Meaning | What the apps show |
|---|---|---|
| **Nothing detected** | none of eggplant / cucumber / carrot is in view (empty scene, hand, tomato, wall ...) | grey "No eggplant, cucumber or carrot in view"; nothing is written to the batch |
| **Wrong crop** | a different target crop than the camera is registered for | amber warning; nothing is written to the batch |
| **Low confidence** | crop found, verdict unsure | "Re-scan" hint; nothing is written to the batch |
| **Detected** | crop + Fresh / At-Risk / Rotten with probabilities | normal result card |

Privacy: automatic captures that show nothing relevant are **not stored** (a market camera can see people).

If the device is linked to a batch and the Supabase key is set, a *detected* scan feeds the hybrid engine (paper 3.10):
- **ML override:** At-Risk → ETA drops to the critical 1–2 day window (1 day when confidence ≥ 85 %) and the status
  becomes Amber; Rotten → Red. A Fresh verdict never extends the countdown.
- **Rule engine:** every DHT22 reading (moving average of the last 5) ages the batch with the VPD/CHU stress
  multiplier, so the Days-to-Spoil keeps counting down between photos.
- On a status change: operator notification, price re-computed, At-Risk batches auto-listed at 30 % off,
  Rotten ones unlisted.

**Capture schedule (paper Table 9):** by default each camera is told to scan at **07:00, 12:00 and 16:00** (editable
in the app: *Capture windows* or *Every N minutes*). If a stall stays above 35 °C for 2 hours, an extra emergency
snapshot is taken (at most once every 6 h). DHT22 readings go to `sensor_logs`; high-temperature alert at most hourly.

**How days-to-spoil is estimated.** Each crop has a baseline shelf life at 25 °C (eggplant 5, cucumber 4, carrot 7 days). Heat ages it by
a Q10 law (about 2.5× per +10 °C; 2.2× for carrot), cool storage slows it down to at most half speed (no benefit below 10 °C for
eggplant and cucumber, which are chilling-sensitive), and dry air adds water-loss stress. Time alone ages every listed batch even without
a camera or sensor, using the DHT22 average if it reported in the last 3 hours, otherwise the assumed stall conditions
(`ASSUMED_STALL_TEMP_C=29`, `ASSUMED_STALL_RH=80` in `.env`). It is an estimate: the apps show it to the nearest half day.

**Teach it from the stall:** under every scan the operator can tap ✔ Correct or ✖ Wrong and pick the right label.
`python agriresq_core\manage.py export_feedback` copies those frames (untouched, not annotated) to
`ML/feedback_export/<label>/`; copy them into `dataset/extra/<label>/` and retrain (`ML/README.md`).

## 4. Firmware
`pio run -t upload` (USB, ESP32-CAM-MB on COM5) and `pio device monitor` for the log.

USB console (115200 baud, type `help`): `status`, `snap` (dump a JPEG frame), `set wb_mode 1` (tune the camera live),
`wifi ssid|password|server|code` (set up without a phone), `reset`. `ML/tools/cam_serial.py` wraps these for scripts.
Camera colour: firmware 1.1+ turns on auto white balance and lens correction. Without them the OV5640 image has a strong
magenta/green cast (measured R/G 0.65 → 0.97 on a neutral scene).
A backup of the previous "Cucumber Freshness" firmware: `Dominic's_Files/esp32_backup/` (restore with
`esptool.py --port COM5 write_flash 0 cucumber_cam_full_flash_4MB.bin`).

DHT22 wiring (optional): DATA → GPIO 13 (or 14/15), VCC → 3.3 V, GND → GND, then choose the pin in the app.
Avoid GPIO 4 (the flash LED) and GPIO 12 (it can stop the board from booting).

## 5. Tests
`.venv\Scripts\python agriresq_core\manage.py test api` runs the full device flow with the real CNN.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Camera can't join Wi-Fi | It must be 2.4 GHz. `ALHN-C3CC 5Ghz` won't work; use the router's 2.4 GHz SSID |
| Camera says "no vegetable" for a real one | Centre ONE vegetable, fill about half the frame, good light, plain background. Tap ✖ Wrong → pick the label to help retraining |
| "cannot reach the AgriResQ server" during setup | Start the backend with `0.0.0.0:8000` and allow Python through Windows Firewall |
| Phone app can't reach the backend | Use `http://<laptop-IP>:5174` on the phone, not localhost. The APK reads `VITE_BACKEND_URL` from `agriresq_mobile/.env` at build time |
| Laptop IP changed | Cameras find the new address themselves (see above). Phones: use the new `http://<laptop-IP>:5174`; the APK reads `VITE_BACKEND_URL` from `agriresq_mobile/.env` at build time, so rebuild it or give the laptop a DHCP reservation |
| Live view black | The camera must be online, and the stream goes through the backend. Check `pio device monitor` |
