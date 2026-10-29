# AgriResQ IoT Device API (ESP32-CAM ⇄ Django ⇄ Web / Mobile)

*Revision 2 – open-set detection ("no vegetable"), capture schedule, scan feedback.*

Smart-home style setup: the stall operator adds the ESP32-CAM from the app, with no code edits and no
USB cable. Django (`agriresq_core`) is the IoT hub. It stores devices, scans and sensor readings, and
runs the freshness CNN (`ML/deploy`). When `SUPABASE_SERVICE_ROLE_KEY` is set, it also syncs results
to Supabase (product freshness, `sensor_logs`, `spoilage_predictions`, `notifications`).

```
 Phone/Web app ──(Bearer Supabase JWT)──► Django /api/devices/...  ◄──(X-Device-Token)── ESP32-CAM
       │                                         │                                       ▲
       └──── during setup only: http://192.168.4.1 (device's own "AgriResQ-XXXX" Wi-Fi) ─┘
```

`BACKEND` = `import.meta.env.VITE_BACKEND_URL` (e.g. `http://192.168.1.4:8000`, the laptop's LAN IP, so
phones can reach it too).

## 1. Operator endpoints (app → Django)

Every request sends `Authorization: Bearer <supabase session.access_token>`.
Only `STALL_OPERATOR` accounts may use them. Other accounts get 403.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/devices/pairing/` | `{name?, stall_location?, crop_type?}` | `Pairing` (201) |
| `GET /api/devices/pairing/<code>/` | – | `{status: "WAITING"\|"CLAIMED"\|"EXPIRED", device: Device\|null, device_progress: string}` |
| `GET /api/devices/` | – | `Device[]` (the operator's devices) |
| `GET /api/devices/<id>/` | – | `Device` |
| `PATCH /api/devices/<id>/` | any of `name, stall_location, crop_type, product_id, auto_scan, scan_mode, capture_times, scan_interval_s, dht_pin, flash_on_scan` | `Device` |
| `DELETE /api/devices/<id>/` | – | 204. The device is told to unpair and goes back to setup mode |
| `POST /api/devices/<id>/command/` | `{command: "scan_now"\|"reboot"\|"forget_wifi"}` | `{queued: true}`. Delivered within ~5 s |
| `POST /api/devices/<id>/scan-now/` | – | `Scan` (200). Django pulls a frame from the camera and analyses it. Returns 202 `{queued:true}` if the camera can't be reached directly |
| `GET /api/devices/<id>/scans/?limit=20&detected=1` | – | `Scan[]` newest first. `detected=1` hides "no vegetable" scans |
| `POST /api/devices/<id>/scans/<scan_id>/feedback/` | `{label}` where label is `correct`, `none`, or `<crop>_<state>` (e.g. `eggplant_at-risk`) | `Scan`. Stores the operator's correction for retraining |
| `GET /api/devices/<id>/readings/?limit=60` | – | `Reading[]` newest first |
| `GET /api/devices/<id>/live/` | – | `{stream_url, snapshot_url, expires_at}`: signed URLs (10 min) usable directly in `<img src>` |

Live view: refresh `snapshot_url` (append `&t=Date.now()`) every 1–2 s. Each request asks the camera
to temporarily send frames to Django. This push relay works when the backend is hosted in the cloud:
Render does not need to open a connection to a camera behind a stall router. The ESP32 uploads frames
only while an app is viewing it; frames expire from the backend cache after 10 seconds.

### Objects
```ts
Pairing = { code: "7K3P9Q", expires_at: ISO, setup_ap_prefix: "AgriResQ-", setup_ap_password: "agriresq",
            setup_url: "http://192.168.4.1", server_url: "http://192.168.1.4:8000" }

Device = { id, name, stall_location, crop_type: "ALL"|"EGGPLANT"|"CUCUMBER"|"CARROT", product_id: number|null,
           mac, ip, fw_version, wifi_ssid, rssi, online: boolean, last_seen: ISO|null,
           auto_scan: boolean,                       // monitoring on/off (all automatic scans)
           scan_mode: "schedule"|"interval",         // schedule = capture windows below (default)
           capture_times: ["07:00","12:00","16:00"], // local time, used when scan_mode = "schedule"
           scan_interval_s: number,                  // used when scan_mode = "interval"
           dht_pin: number /* -1 = no DHT22 */, flash_on_scan: boolean, created_at: ISO,
           latest_scan: Scan|null, latest_reading: Reading|null }

Scan = { id, device_id: number|null, created_at: ISO, source: "AUTO"|"MANUAL"|"UPLOAD",
         detected: boolean,            // false = none of eggplant / cucumber / carrot is in view
         state: "fresh"|"at-risk"|"rotten"|"none",
         freshness_status: "GREEN"|"AMBER"|"RED"|"UNKNOWN",   // UNKNOWN when detected = false
         crop_type,                    // detected crop when detected, else the device's registered crop
         detected_crop: "EGGPLANT"|"CUCUMBER"|"CARROT"|null,  // what the model actually sees
         crop_mismatch: boolean,       // sees a different target crop than the one registered; always false in ALL mode
         message: string,              // plain-language result to show the operator
         freshness_percent: 0-100|null, days_to_spoil: number|null, ml_confidence: 0..1,
         probs: {fresh, "at-risk", rotten}|null, none_prob: 0..1, low_confidence: boolean,
         image_url: string|"" /* annotated JPEG; "" for automatic "nothing in view" scans (privacy) */,
         product_id: number|null, feedback_label: string|null }

Reading = { id, created_at: ISO, temperature_c, humidity_rh, vpd_kpa }
```

`crop_type: "ALL"` is camera-only and scans all supported vegetables (eggplant, cucumber, and carrot).
A camera still links to at most one harvest batch; in ALL mode, scans update that batch only when its
crop matches the detected vegetable.

`POST /api/analyze-freshness/` (no auth, multipart `image` + `crop_type`) still exists for photo
uploads. It returns the `Scan` fields (minus ids) plus `processed_image_base64` and `analysis_method`.

**Showing a result:** `detected = false` → show `message` ("No eggplant, cucumber or carrot in view"), never a
freshness badge. `crop_mismatch = true` → show a warning with `message`, and do not link the result to the batch.
`low_confidence = true` → ask for a re-scan (better light, one vegetable, centred).

## 2. Device setup mode (app → ESP32 at http://192.168.4.1)

When the camera has no Wi-Fi saved, it opens the hotspot **`AgriResQ-XXXX`** (password `agriresq`).
All endpoints send `Access-Control-Allow-Origin: *`.

| Method & path | Body | Response |
|---|---|---|
| `GET /info` | – | `{device:"AgriResQ-CAM", mac, fw, mode:"setup"\|"normal"}` |
| `GET /networks` | – | `[{ssid, rssi, secure}]`. Nearby 2.4 GHz Wi-Fi |
| `POST /provision` | JSON `{ssid, password, server, code}` | `{ok:true}`. The device then joins the Wi-Fi and claims itself |
| `GET /status` | – | `{state:"idle"\|"connecting"\|"wifi_failed"\|"claiming"\|"claim_failed"\|"done", message}` |

`GET /` serves a small setup page, so a plain browser can also do the setup.

### App wizard flow
1. **Online:** `POST /api/devices/pairing/` returns the code and `server_url`.
   The `server_url` is the Django backend address. Do not enter `http://192.168.4.1` as the server; that address belongs to the camera's setup page.
   For the Render deployment, configure `DEVICE_SERVER_URL=https://agriresq.onrender.com`; do not append port `8000` to a public Render URL.
2. Tell the operator: power the camera, open phone Wi-Fi settings, join **AgriResQ-XXXX** (password
   `agriresq`), then come back.
3. **On the device hotspot:** `GET 192.168.4.1/networks`, the operator picks the stall Wi-Fi and enters the
   password, then `POST 192.168.4.1/provision {ssid, password, server: server_url, code}`. Poll
   `/status` until `done`, `wifi_failed` or `claim_failed` (the phone may drop the hotspot once the
   device leaves setup mode; that's expected).
4. Tell the operator to reconnect the phone to the normal Wi-Fi.
5. **Online:** poll `GET /api/devices/pairing/<code>/` every 2 s until `CLAIMED`. Show "Device connected", then
   open the device page.

Recovery: power-cycle the camera 3 times within 10 s (or use *Forget Wi-Fi* in the app) to return
to setup mode. If the saved Wi-Fi can't be reached for 60 s, the camera also opens the setup hotspot.

## 3. Device endpoints (ESP32 → Django; firmware only)

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/devices/claim/` | pairing code | `{code, mac, fw, ip, wifi_ssid}` | `{device_id, device_token, config}` |
| `POST /api/devices/heartbeat/` | `X-Device-Token` | `{ip, rssi, fw, uptime_s, wifi_ssid}` | `{config, command, live_view}` |
| `POST /api/devices/live-frame/` | `X-Device-Token` | raw JPEG (max 256 KB, `Content-Type: image/jpeg`) | 204 |
| `POST /api/devices/upload-scan/` | `X-Device-Token` | raw JPEG (`Content-Type: image/jpeg`), `X-Scan-Source: AUTO\|MANUAL` | `Scan` |
| `POST /api/devices/reading/` | `X-Device-Token` | `{temperature_c, humidity_rh}` | `Reading` |

`live_view` is true while an authenticated app is requesting frames. When true, a camera sends a JPEG to
`/api/devices/live-frame/` every 2 seconds; it stops after the viewing lease expires. Sensor-only nodes
ignore this flag. `config = {crop_type, auto_scan, scan_interval_s, dht_pin, flash_on_scan, heartbeat_s}`. In `schedule` mode the
server itself sends `scan_now` at each capture time (and an emergency snapshot after >35 °C for 2 h), so the
camera's own interval timer is only used in `interval` mode (`auto_scan` in the config is false otherwise).
`command` = `null` or one of `scan_now | reboot | forget_wifi | unpair`.
A 401 on any device call means the device was removed: the firmware clears its token and returns to
setup mode.

## Sensor node (plain ESP32 DevKit + DHT22)

`iot/sensor_node/` is a PlatformIO project for an ESP32 DevKit with a DHT22 on GPIO 4 (no camera). It pairs
with the same flow as the camera: the operator creates a code in the app (Devices > Add camera), the node sends
`POST /api/devices/claim/` with `"kind": "SENSOR"` and `"dht_pin": 4`, then every 15 s a heartbeat and every
30 s `POST /api/devices/reading/`. A `SENSOR` device has `kind: "SENSOR"` in `GET /api/devices/`, never uploads
pictures, and is not scheduled for scans. Setup: copy `include/secrets.h.example` to `include/secrets.h`
(Wi-Fi + hub address), `pio run -t upload`, open the serial monitor and type `pair CODE`.

## Shared access, gallery and batch photos

| Endpoint | Who | What |
|---|---|---|
| `GET /api/devices/` | owner, monitor, admin | cameras the user owns or monitors (admin: all); `my_access`, `monitor_count`, `monitors_needed` |
| `GET/POST /api/devices/<id>/monitors/` | read: owner, monitor, admin; add: owner | a second stall operator who can use the camera (found by email); a camera works with just its owner; the owner may share it with one other stall operator (two people at most), and the administrator can always access it |
| `DELETE /api/devices/<id>/monitors/<user_id>/` | owner | remove a monitor |
| `GET /api/scans/?device=&detected=&state=&since=&until=&before=&limit=` | owner, monitor, admin | recent analysed pictures (annotated + raw), newest first, paged by `next_before` |
| `GET /api/batches/<product_id>/photos/` | owner, monitor, admin | pictures taken of one batch, with timestamps |

Administrators and monitors are read-only on cameras. Old analysed pictures are deleted daily unless they are
among a camera's newest `SCAN_KEEP_PER_DEVICE` (500) or newer than `SCAN_KEEP_DAYS` (30); frames the operator
corrected are kept as retraining data.

**Who can do what to a camera.** The owner, anyone the owner shared it with, and the administrator can all use
it: watch live, scan now, correct results, restart, change settings (`can_operate`). Only the owner can remove it,
forget its Wi-Fi, or choose who shares it (`can_manage`). A shared person can remove their own access.
