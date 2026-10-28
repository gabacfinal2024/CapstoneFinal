"""Export a trained run to ONNX for the Django backend and check it matches PyTorch.

usage: .venv/Scripts/python tools/export_onnx.py runs/<run_dir> [--out deploy]
"""
import argparse, json, os, shutil

import numpy as np
import onnxruntime as ort
import timm
import torch

from train import LABELS, MEAN, STD

ap = argparse.ArgumentParser()
ap.add_argument("run")
ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy"))
a = ap.parse_args()

m = json.load(open(os.path.join(a.run, "metrics.json")))
model = timm.create_model(m["model"], pretrained=False, num_classes=len(LABELS))
model.load_state_dict(torch.load(os.path.join(a.run, "best.pt"), map_location="cpu"))
model.eval()

os.makedirs(a.out, exist_ok=True)
onnx_path = os.path.join(a.out, "agriresq_freshness.onnx")
x = torch.randn(2, 3, m["size"], m["size"])
torch.onnx.export(model, x, onnx_path, input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)

sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
diff = np.abs(sess.run(None, {"input": x.numpy()})[0] - model(x).detach().numpy()).max()
print("max |onnx - torch| =", diff)
assert diff < 1e-3

thr_path = os.path.join(a.run, "thresholds.json")  # written by tools/calibrate_openset.py
thresholds = json.load(open(thr_path)) if os.path.exists(thr_path) else {}
print("open-set thresholds:", thresholds or "defaults (run tools/calibrate_openset.py first!)")
json.dump({"labels": LABELS, "input_size": m["size"], "resize_short": int(m["size"] * 1.07),
           "mean": MEAN, "std": STD, "model": m["model"], "thresholds": thresholds,
           "test_acc": m["test_acc"], "test_macro_f1": m["test_macro_f1"]},
          open(os.path.join(a.out, "model_config.json"), "w"), indent=2)
shutil.copy(os.path.join(a.run, "metrics.json"), os.path.join(a.out, "metrics.json"))
print("wrote", a.out, f"({os.path.getsize(onnx_path) / 1e6:.1f} MB)")
