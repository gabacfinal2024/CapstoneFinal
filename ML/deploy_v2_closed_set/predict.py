"""AgriResQ freshness inference for the Django backend (ESP32-CAM snapshots).

Dependencies: onnxruntime, numpy, pillow  (no PyTorch needed)

    from predict import FreshnessModel
    model = FreshnessModel()                        # load once at startup
    result = model.predict(request.FILES["image"].read(), crop="eggplant")

`crop` is optional. The batch registration already knows the crop, so passing it
restricts the decision to that crop's three states, which is more reliable.

Result example:
    {"crop": "eggplant", "state": "at-risk", "confidence": 0.91,
     "freshness_pct": 47.3, "probs": {"fresh": 0.05, "at-risk": 0.91, "rotten": 0.04}}

freshness_pct = 100*P(fresh) + 50*P(at-risk): one 0-100 number for the dashboard
(the "ML Freshness %" field). The Hybrid Engine's ML override (Section 3.10.1) can
trigger on state in {"at-risk", "rotten"} with confidence >= a calibrated threshold.

CLI:  python predict.py image.jpg [--crop cucumber]
"""
import io, json, os

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
CROPS = ("cucumber", "carrot", "eggplant")
STATES = ("fresh", "at-risk", "rotten")


class FreshnessModel:
    def __init__(self, model_dir=HERE):
        self.cfg = json.load(open(os.path.join(model_dir, "model_config.json")))
        self.sess = ort.InferenceSession(os.path.join(model_dir, "agriresq_freshness.onnx"),
                                         providers=["CPUExecutionProvider"])
        self.mean = np.array(self.cfg["mean"], np.float32).reshape(3, 1, 1)
        self.std = np.array(self.cfg["std"], np.float32).reshape(3, 1, 1)

    def _prep(self, image):
        if isinstance(image, (bytes, bytearray)):
            image = Image.open(io.BytesIO(image))
        elif isinstance(image, str):
            image = Image.open(image)
        im = ImageOps.exif_transpose(image).convert("RGB")
        # same as training eval transform: resize short side, centre crop
        s, c = self.cfg["resize_short"], self.cfg["input_size"]
        w, h = im.size
        k = s / min(w, h)
        im = im.resize((round(w * k), round(h * k)), Image.BILINEAR)
        w, h = im.size
        l, t = (w - c) // 2, (h - c) // 2
        im = im.crop((l, t, l + c, t + c))
        x = np.asarray(im, np.float32).transpose(2, 0, 1) / 255.0
        return ((x - self.mean) / self.std)[None]

    def predict(self, image, crop=None):
        logits = self.sess.run(None, {"input": self._prep(image)})[0][0]
        p = np.exp(logits - logits.max())
        p = (p / p.sum()).reshape(3, 3)  # rows = crops, cols = states
        if crop is None:
            ci = int(p.sum(1).argmax())
            crop_conf = float(p.sum(1)[ci])
        else:
            ci = CROPS.index(crop)
            crop_conf = None
        sp = p[ci] / p[ci].sum()
        si = int(sp.argmax())
        out = {"crop": CROPS[ci], "state": STATES[si], "confidence": round(float(sp[si]), 4),
               "freshness_pct": round(float(100 * sp[0] + 50 * sp[1]), 1),
               "probs": {s: round(float(v), 4) for s, v in zip(STATES, sp)}}
        if crop_conf is not None:
            out["crop_confidence"] = round(crop_conf, 4)
        return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--crop", choices=CROPS)
    a = ap.parse_args()
    m = FreshnessModel()
    for f in a.images:
        print(f, json.dumps(m.predict(f, a.crop)))
