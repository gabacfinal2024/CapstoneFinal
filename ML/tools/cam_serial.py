"""Talk to the AgriResQ ESP32-CAM over USB (firmware >= 1.1.0): grab frames, tune the sensor.

  python tools/cam_serial.py snap OUT.jpg [--port COM5] [--set wb_mode=1 --set saturation=-1]
  python tools/cam_serial.py cmd "status"
  python tools/cam_serial.py collect OUT_DIR N [--delay 1.5]     # N frames for the dataset

Opening the port never resets the board (DTR/RTS stay low).
"""
import argparse, base64, io, re, sys, time

import serial
from PIL import Image


def open_port(port, baud=115200):
    s = serial.Serial()
    s.port, s.baudrate, s.timeout = port, baud, 0.5
    s.dtr = s.rts = False
    s.open()
    return s


def command(s, line, wait=2.0, until=None):
    s.reset_input_buffer()
    s.write((line + "\n").encode())
    buf, t0 = b"", time.time()
    while time.time() - t0 < wait:
        buf += s.read(4096)
        if until and until in buf:
            break
    return buf.decode("utf8", "replace")


def snap(s, timeout=25):
    s.reset_input_buffer()
    s.write(b"snap\n")
    buf, t0 = b"", time.time()
    while time.time() - t0 < timeout:
        buf += s.read(8192)
        if b"<<END>>" in buf:
            break
    m = re.search(rb"<<SNAP (\d+)>>\r?\n(.*?)\r?\n<<END>>", buf, re.S)
    if not m:
        raise RuntimeError("no frame received: " + buf[-200:].decode("utf8", "replace"))
    jpg = base64.b64decode(m.group(2))
    if len(jpg) != int(m.group(1)):
        raise RuntimeError(f"corrupt frame ({len(jpg)} of {m.group(1)} bytes)")
    return jpg


def channel_means(jpg):
    im = Image.open(io.BytesIO(jpg)).convert("RGB").resize((64, 48))
    px = list(im.getdata())
    n = len(px)
    return tuple(sum(p[i] for p in px) / n for i in range(3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["snap", "cmd", "collect"])
    ap.add_argument("arg", nargs="*")
    ap.add_argument("--port", default="COM5")
    ap.add_argument("--set", action="append", default=[], help="name=value applied before the snap")
    ap.add_argument("--delay", type=float, default=1.5)
    a = ap.parse_args()
    s = open_port(a.port)
    for kv in a.set:
        k, v = kv.split("=")
        print(command(s, f"set {k} {v}", 1.0).strip())
        time.sleep(0.3)
    if a.action == "cmd":
        print(command(s, " ".join(a.arg), 3.0))
    elif a.action == "snap":
        time.sleep(1.2 if a.set else 0)  # let auto-exposure/AWB settle
        jpg = snap(s)
        open(a.arg[0], "wb").write(jpg)
        r, g, b = channel_means(jpg)
        print(f"saved {a.arg[0]} ({len(jpg)} bytes)  mean RGB = {r:.0f} {g:.0f} {b:.0f}   R/G={r/g:.2f} B/G={b/g:.2f}")
    else:
        import os
        os.makedirs(a.arg[0], exist_ok=True)
        for i in range(int(a.arg[1])):
            jpg = snap(s)
            path = os.path.join(a.arg[0], f"esp32_{int(time.time())}_{i:03d}.jpg")
            open(path, "wb").write(jpg)
            print(path, len(jpg))
            time.sleep(a.delay)


if __name__ == "__main__":
    main()
