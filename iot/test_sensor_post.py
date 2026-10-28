#!/usr/bin/env python3
"""Simulate ESP32 sensor POST for local testing."""
import json
import sys
import urllib.request

API_URL = "http://127.0.0.1:8000/api/sensor-data/"
DEVICE_TOKEN = sys.argv[1] if len(sys.argv) > 1 else "REPLACE_WITH_DEVICE_TOKEN"
BATCH_ID = int(sys.argv[2]) if len(sys.argv) > 2 else 1

payload = {
    "batch_id": BATCH_ID,
    "temperature_c": 33.2,
    "humidity_rh": 62.0,
    "ethylene_ppm": 1.42,
}

req = urllib.request.Request(
    API_URL,
    data=json.dumps(payload).encode(),
    headers={
        "Content-Type": "application/json",
        "X-Device-Token": DEVICE_TOKEN,
    },
    method="POST",
)

with urllib.request.urlopen(req) as resp:
    print(resp.status, resp.read().decode())
