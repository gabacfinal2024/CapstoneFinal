"""Figures/tables for the paper (Section 3.17.2): confusion matrices + per-class P/R/F1.

usage: .venv/Scripts/python tools/plot_results.py runs/<run_dir>
"""
import csv, json, os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

run = sys.argv[1]
m = json.load(open(os.path.join(run, "metrics.json")))
labels = m["labels"]
cm = np.array(m["confusion"])


def draw(cm, names, title, path):
    fig, ax = plt.subplots(figsize=(1.0 * len(names) + 2, 0.9 * len(names) + 1.5))
    norm = cm / cm.sum(1, keepdims=True).clip(min=1)
    ax.imshow(norm, cmap="Greens", vmin=0, vmax=1)
    for i in range(len(names)):
        for j in range(len(names)):
            ax.text(j, i, f"{cm[i, j]}\n{norm[i, j]:.0%}", ha="center", va="center", fontsize=8,
                    color="white" if norm[i, j] > 0.6 else "black")
    ax.set_xticks(range(len(names)), names, rotation=45, ha="right")
    ax.set_yticks(range(len(names)), names)
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual (ground truth)"); ax.set_title(title)
    fig.tight_layout(); fig.savefig(path, dpi=200); plt.close(fig)


draw(cm, labels, f"Test set confusion matrix (n={cm.sum()}, acc={m['test_acc']:.1%})", os.path.join(run, "confusion_9class.png"))
k = len(labels)
st = np.zeros((4, 4), int)  # fresh / at-risk / rotten / none, all crops pooled
for i in range(k):
    for j in range(k):
        st[i % 3 if labels[i] != "none" else 3, j % 3 if labels[j] != "none" else 3] += cm[i, j]
draw(st, ["Fresh", "At-Risk", "Rotten", "No vegetable"], f"Freshness state, all crops (acc={m['test_state_acc']:.1%})", os.path.join(run, "confusion_state.png"))

with open(os.path.join(run, "per_class_f1.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["class", "precision", "recall", "f1", "support"])
    for l in labels + ["macro avg", "weighted avg"]:
        r = m["report"][l]
        w.writerow([l, f"{r['precision']:.3f}", f"{r['recall']:.3f}", f"{r['f1-score']:.3f}", int(r["support"])])

h = m["history"]
fig, ax = plt.subplots(figsize=(6, 3.5))
ax.plot([e["epoch"] for e in h], [e["val_macro_f1"] for e in h], label="val macro-F1")
ax.plot([e["epoch"] for e in h], [e["val_acc"] for e in h], label="val accuracy")
ax.set_xlabel("epoch"); ax.set_ylim(0, 1); ax.grid(alpha=0.3); ax.legend()
fig.tight_layout(); fig.savefig(os.path.join(run, "training_curve.png"), dpi=200)
print("wrote figures to", run)
