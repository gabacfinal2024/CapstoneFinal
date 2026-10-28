"""AgriResQ freshness inference (ESP32-CAM snapshots) with open-set rejection.

Dependencies: onnxruntime, numpy, pillow  (no PyTorch needed)

    from predict import FreshnessModel
    model = FreshnessModel()                        # load once at startup
    r = model.predict(jpeg_bytes, crop="eggplant")  # crop = what the stall registered (optional)

The network has 10 outputs: {cucumber, carrot, eggplant} x {fresh, at-risk, rotten} + `none`
(anything else: empty scene, hand, other vegetables or fruit, background ...).  A frame counts
as a detection only when

    P(none) < none_prob   and   P(best crop) >= crop_prob        (thresholds: model_config.json,
                                                                  calibrated on validation data)

Result keys:
  detected        False -> nothing to report; show `message`, no freshness verdict
  crop            crop the state refers to (detected crop; the registered crop if not detected)
  detected_crop   crop the network actually sees (None when not detected)
  crop_mismatch   a different target crop than the registered one is clearly visible
  state           "fresh" | "at-risk" | "rotten" | "none"
  confidence      confidence of `state` (for "none": confidence that nothing relevant is there)
  freshness_pct   100*P(fresh) + 50*P(at-risk) within the crop, None when not detected
  probs           {fresh, at-risk, rotten} within the crop, None when not detected
  none_prob / crop_probs / message

CLI:  python predict.py image.jpg [--crop cucumber]
"""
import io, json, os

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
CROPS = ("cucumber", "carrot", "eggplant")
STATES = ("fresh", "at-risk", "rotten")
DEFAULTS = {"none_prob": 0.5, "crop_prob": 0.5, "crop_ambiguity": 0.5}


class FreshnessModel:
    def __init__(self, model_dir=HERE):
        self.cfg = json.load(open(os.path.join(model_dir, "model_config.json")))
        self.thr = {**DEFAULTS, **self.cfg.get("thresholds", {})}
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
        # same as the training evaluation transform: resize short side, centre crop
        s, c = self.cfg["resize_short"], self.cfg["input_size"]
        w, h = im.size
        k = s / min(w, h)
        im = im.resize((round(w * k), round(h * k)), Image.BILINEAR)
        w, h = im.size
        l, t = (w - c) // 2, (h - c) // 2
        im = im.crop((l, t, l + c, t + c))
        x = np.asarray(im, np.float32).transpose(2, 0, 1) / 255.0
        return ((x - self.mean) / self.std)[None]

    def probabilities(self, image):
        """Softmax over the 10 outputs (9 crop-states + none)."""
        logits = self.sess.run(None, {"input": self._prep(image)})[0][0]
        e = np.exp(logits - logits.max())
        return e / e.sum()

    def decide(self, p, crop=None):
        pv = p[:9].reshape(3, 3)             # rows = crops, cols = states
        mass = pv.sum(1)                     # P(crop) for each crop
        p_none = float(p[9])
        ci = int(mass.argmax())
        detected = p_none < self.thr["none_prob"] and mass[ci] >= self.thr["crop_prob"]
        hint = CROPS.index(crop) if crop in CROPS else None
        out = {"none_prob": round(p_none, 4),
               "crop_probs": {c: round(float(m), 4) for c, m in zip(CROPS, mass)},
               "detected": bool(detected), "crop_mismatch": False, "detected_crop": None}
        if not detected:
            out.update(crop=crop, state="none", confidence=round(max(p_none, 1.0 - float(mass[ci])), 4),
                       freshness_pct=None, probs=None,
                       message="No eggplant, cucumber or carrot in view. Place one vegetable in front of the camera.")
            return out
        use = ci
        if hint is not None and hint != ci:
            # a clearly different target crop is visible (not just an ambiguous frame)
            if mass[hint] < self.thr["crop_ambiguity"] * mass[ci]:
                out["crop_mismatch"] = True
            else:
                use = hint
        sp = pv[use] / pv[use].sum()
        si = int(sp.argmax())
        out.update(crop=CROPS[use], detected_crop=CROPS[ci], state=STATES[si], confidence=round(float(sp[si]), 4),
                   freshness_pct=round(float(100 * sp[0] + 50 * sp[1]), 1),
                   probs={s: round(float(v), 4) for s, v in zip(STATES, sp)})
        if out["crop_mismatch"]:
            out["message"] = f"This looks like {CROPS[ci]}, but this camera is set to {crop}."
        else:
            out["message"] = f"{CROPS[use].title()} looks {STATES[si]}."
        return out

    def predict(self, image, crop=None):
        return self.decide(self.probabilities(image), crop)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--crop", choices=CROPS)
    a = ap.parse_args()
    m = FreshnessModel()
    for f in a.images:
        print(f, json.dumps(m.predict(f, a.crop)))
