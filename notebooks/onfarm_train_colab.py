"""
ON-FARM 품목·등급 모델 학습 (Colab)
===================================

**전제: 데이터 수집은 이 노트북에서 하지 않는다.**
AI 허브는 해외 IP 다운로드를 막는다("AI 허브는 해외에서의 데이터 다운로드를 제한하고 있습니다").
Colab 은 해외 서버라 반드시 실패한다. 그래서 순서가 이렇다.

    [국내 PC]  python tools/aihub_ingest.py --items all --key <APIKEY> --out data/onfarm_cv
               → 119GB 원본이 224px JPEG 약 900MB 로 줄어든다
    [업로드]   data/onfarm_cv 를 zip 으로 묶어 Google Drive 에 올린다
    [Colab]    이 노트북에서 학습만 한다

설계 원칙 — 라벨 실측 분석(docs/aihub-dataset.md)에서 나온 결론을 코드로 강제한다.
  1. 공식 Train/Validation 을 그대로 쓴다. 자체 재분할 금지.
     (개체당 40장 근접중복이라 직접 나누면 정확도가 부풀려진다)
  2. 겹치는 개체 1건(배/추황/상)은 valid 에서 제외한다.
  3. 정확도는 이미지 단위가 아니라 **개체(group_no) 단위**로도 보고한다.
     독립 표본은 1,258개체뿐이므로 이미지 단위 숫자는 과장이다.
  4. 등급 모델은 **중량 단독 기준선**(양파 89.2% ~ 배 60.8%)과 반드시 비교한다.
     사진 모델이 이를 못 넘으면 "사진으로 등급을 본다"고 말하지 않는다.
"""

# %% [markdown]
# # ON-FARM 학습 — AI 허브 농산물 품질(QC) 이미지
#
# **런타임 → 런타임 유형 변경 → GPU** 를 먼저 설정하세요.
#
# 데이터는 국내 PC 에서 `tools/aihub_ingest.py` 로 만든 뒤 Drive 에 올린 것을 씁니다.

# %%
# --- 0. 환경 확인 + 필요한 패키지 ------------------------------------------
# ★ 설치는 반드시 학습 '전에' 한다.
#   onnx 계열을 학습 뒤에 설치하면 Colab 이 런타임을 재시작해 학습 결과가 통째로 사라진다
#   (실제로 겪은 사고 — 6에폭을 다시 돌려야 했다).
!pip install -q onnxscript onnx

import shutil, subprocess

print(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"],
                     capture_output=True, text=True).stdout or "GPU 없음 — 런타임 유형을 GPU 로 바꾸세요")
print(f"디스크 여유 {shutil.disk_usage('/content')[2]/2**30:.0f} GB")
import torch
print("torch", torch.__version__, "| cuda", torch.cuda.is_available())

# %%
# --- 1. 데이터 가져오기 (Drive 에 올려둔 zip) -------------------------------
import pathlib, zipfile

from google.colab import drive
drive.mount("/content/drive")

# 국내 PC 에서 만든 data/onfarm_cv 를 zip 으로 묶어 올린 경로
ZIP_PATH = "/content/drive/MyDrive/onfarm_cv.zip"
DATA = pathlib.Path("/content/onfarm_cv")

if not DATA.exists():
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extractall("/content")
# manifest.csv 가 한 단계 안쪽에 있을 수도 있다
if not (DATA / "manifest.csv").exists():
    DATA = next(p.parent for p in pathlib.Path("/content").rglob("manifest.csv"))
print("데이터 루트:", DATA)
print(f"이미지 {len(list(DATA.rglob('*.jpg'))):,}장")

# %%
# --- 2. 매니페스트 + 무결성/누출 처리 ---------------------------------------
import csv, collections

rows = list(csv.DictReader((DATA / "manifest.csv").open(encoding="utf-8")))
for r in rows:
    r["path"] = str(DATA / r["path"])
    r["weight_g"] = float(r["weight_g"] or 0)
print(f"매니페스트 {len(rows):,}행")

missing = [r for r in rows if not pathlib.Path(r["path"]).exists()]
assert not missing, f"이미지 {len(missing)}장이 없다 — 업로드가 잘렸는지 확인하라 (예: {missing[0]['path']})"

g = collections.defaultdict(set)
for r in rows:
    g[r["split"]].add(r["group_no"])
overlap = g["train"] & g["valid"]
if overlap:
    before = len(rows)
    rows = [r for r in rows if not (r["split"] == "valid" and r["group_no"] in overlap)]
    print(f"⚠️ 개체 누출 {len(overlap)}개 → valid 에서 제외 ({before-len(rows)}장 제거)")
else:
    print("✅ 개체 누출 없음")

print(f"train 개체 {len(g['train']):,} / valid 개체 {len(g['valid'])-len(overlap):,}")
print("품목:", collections.Counter(r["item"] for r in rows))
print("등급:", collections.Counter(r["grade"] for r in rows))

# %%
# --- 3. 데이터셋 -------------------------------------------------------------
import numpy as np, torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms

ITEMS = sorted({r["item"] for r in rows})
GRADES = ["보통", "상", "특"]
IMG_SIZE = 224
print("품목:", ITEMS, "| 등급:", GRADES)

train_tf = transforms.Compose([
    transforms.RandomResizedCrop(IMG_SIZE, scale=(0.7, 1.0)),
    transforms.RandomHorizontalFlip(),
    # 스튜디오 촬영 데이터라 폰 사진과 색·밝기가 다르다. 그 간극을 조금이라도 메운다.
    transforms.ColorJitter(0.3, 0.3, 0.25, 0.04),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
eval_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

class QCDataset(Dataset):
    def __init__(self, recs, tf):
        self.recs, self.tf = recs, tf
    def __len__(self):
        return len(self.recs)
    def __getitem__(self, i):
        r = self.recs[i]
        return (self.tf(Image.open(r["path"]).convert("RGB")),
                ITEMS.index(r["item"]), GRADES.index(r["grade"]), int(r["group_no"]))

tr = [r for r in rows if r["split"] == "train"]
va = [r for r in rows if r["split"] == "valid"]
print(f"train {len(tr):,} / valid {len(va):,}")

dl_tr = DataLoader(QCDataset(tr, train_tf), batch_size=96, shuffle=True, num_workers=2, pin_memory=True, drop_last=True)
dl_va = DataLoader(QCDataset(va, eval_tf), batch_size=192, shuffle=False, num_workers=2)

# %%
# --- 4. 모델: 품목 + 등급 멀티태스크 ----------------------------------------
import torch.nn as nn
from torchvision import models

dev = "cuda" if torch.cuda.is_available() else "cpu"
backbone = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
feat = backbone.classifier[1].in_features
backbone.classifier = nn.Identity()

class TwoHead(nn.Module):
    def __init__(self, bb, feat):
        super().__init__()
        self.backbone, self.item, self.grade = bb, nn.Linear(feat, len(ITEMS)), nn.Linear(feat, len(GRADES))
    def forward(self, x):
        f = self.backbone(x)
        return self.item(f), self.grade(f)

model = TwoHead(backbone, feat).to(dev)

# 체크포인트는 Drive 에 둔다(런타임이 죽어도 남는다).
CKPT_PATH = pathlib.Path("/content/drive/MyDrive/onfarm_ckpt.pt")
start_epoch = 0
if CKPT_PATH.exists():
    ck = torch.load(CKPT_PATH, map_location=dev)
    model.load_state_dict(ck["state_dict"])
    start_epoch = ck.get("epoch", 0)
    print(f"이어서 학습: {start_epoch} 에폭까지 완료된 체크포인트를 불러왔다")

opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
EPOCHS = 6
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-4,
                                            total_steps=max(1, (EPOCHS - start_epoch)) * len(dl_tr))
scaler = torch.amp.GradScaler("cuda", enabled=(dev == "cuda"))

for ep in range(start_epoch, EPOCHS):
    model.train(); run = 0.0
    for x, yi, yg, _ in dl_tr:
        x, yi, yg = x.to(dev, non_blocking=True), yi.to(dev), yg.to(dev)
        opt.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda", enabled=(dev == "cuda")):
            pi, pg = model(x)
            loss = lossf(pi, yi) + lossf(pg, yg)
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
        run += loss.item() * x.size(0)
    print(f"epoch {ep+1}/{EPOCHS}  loss {run/len(dl_tr.dataset):.4f}")
    # 에폭마다 Drive 에 저장한다. /content 는 런타임이 죽으면 사라지고,
    # 세션이 끊기는 일은 실제로 일어난다 — 몇 시간을 다시 태우지 않기 위한 보험.
    torch.save({"epoch": ep + 1, "state_dict": model.state_dict(),
                "items": ITEMS, "grades": GRADES, "img_size": IMG_SIZE},
               CKPT_PATH)

# %%
# --- 5. 평가: 이미지 단위 + 개체 단위 + 중량 기준선 -------------------------
model.eval()
Pi, Pg, Yi, Yg, G, Conf = [], [], [], [], [], []
with torch.no_grad():
    for x, yi, yg, gno in dl_va:
        with torch.amp.autocast("cuda", enabled=(dev == "cuda")):
            pi, pg = model(x.to(dev))
        prob = torch.softmax(pi.float(), 1)
        Pi += prob.argmax(1).cpu().tolist(); Conf += prob.max(1).values.cpu().tolist()
        Pg += pg.float().argmax(1).cpu().tolist()
        Yi += yi.tolist(); Yg += yg.tolist(); G += gno.tolist()

Pi, Yi, Pg, Yg, G, Conf = map(np.array, (Pi, Yi, Pg, Yg, G, Conf))

def by_object(pred, true):
    ok = 0; ids = np.unique(G)
    for gid in ids:
        m = G == gid
        ok += int(np.bincount(pred[m]).argmax() == np.bincount(true[m]).argmax())
    return ok / len(ids), len(ids)

acc_item_obj, n_obj = by_object(Pi, Yi)
acc_grade_obj, _ = by_object(Pg, Yg)

# 중량만 보는 기준선(개체 단위) — 사진 모델이 못 넘으면 등급 주장은 하지 않는다
w = {r["group_no"]: r["weight_g"] for r in va}
gr = {r["group_no"]: GRADES.index(r["grade"]) for r in va}
keys = sorted(w)
ws = np.array([w[k] for k in keys]); gs = np.array([gr[k] for k in keys])
base = 0.0
for t1 in np.unique(ws):
    for t2 in np.unique(ws[ws >= t1]):
        base = max(base, (np.where(ws <= t1, 0, np.where(ws <= t2, 1, 2)) == gs).mean())

print("=" * 60)
print(f"이미지 단위   품목 {(Pi==Yi).mean():.3f} | 등급 {(Pg==Yg).mean():.3f}   (n={len(Yi):,})")
print(f"개체 단위★    품목 {acc_item_obj:.3f} | 등급 {acc_grade_obj:.3f}   (개체 {n_obj})")
print(f"[기준선] 중량만으로 등급 {base:.3f}")
print("  → 등급 모델이 이 기준선을 못 넘으면 '사진으로 등급을 본다'고 말하지 않는다")
print("=" * 60)
for i, name in enumerate(ITEMS):
    m = Yi == i
    if m.any():
        print(f"  {name}: 품목 {(Pi[m]==i).mean():.3f} | 등급 {(Pg[m]==Yg[m]).mean():.3f} (n={m.sum():,})")
wrong = Conf[Pi != Yi]
print(f"\n평균 확신도 {Conf.mean():.3f} | 틀렸을 때 {wrong.mean() if len(wrong) else 0:.3f}")
print("→ 틀렸을 때도 확신도가 높으면 ON-FARM 신뢰도 임계값을 그만큼 보수적으로 잡아야 한다")

# %%
# --- 6. 내보내기 — ON-FARM provider 가 쓸 형태 ------------------------------
import json, datetime

EXPORT = pathlib.Path("/content/onfarm_model"); EXPORT.mkdir(exist_ok=True)
m_cpu = model.to("cpu").eval()

# ① 가중치부터 저장한다.
#    내보내기가 실패해도 학습 결과는 남아야 한다 — 런타임이 끊기면 몇 시간이 통째로 사라진다.
torch.save({"state_dict": m_cpu.state_dict(), "items": ITEMS,
            "grades": GRADES, "img_size": IMG_SIZE}, EXPORT / "onfarm_qc.pt")
print(f"가중치 저장 {(EXPORT / 'onfarm_qc.pt').stat().st_size / 2**20:.0f} MB")

# ② ONNX 내보내기.
#    torch 2.6+ 의 기본 경로(dynamo)는 onnxscript 를 요구하는데 Colab 에 없을 수 있다.
#    실패하면 legacy exporter 로 내려간다.
dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
onnx_args = dict(input_names=["image"], output_names=["item_logits", "grade_logits"],
                 dynamic_axes={"image": {0: "n"}}, opset_version=17)
try:
    torch.onnx.export(m_cpu, dummy, EXPORT / "onfarm_qc.onnx", **onnx_args)
    print("ONNX 성공(기본 exporter)")
except Exception as e:
    print("기본 exporter 실패 →", str(e)[:120])
    torch.onnx.export(m_cpu, dummy, EXPORT / "onfarm_qc.onnx", dynamo=False, **onnx_args)
    print("ONNX 성공(legacy exporter)")

meta = {
    "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
    "dataset": "AI-Hub 149 농산물 품질(QC) 이미지",
    "items": ITEMS, "grades": GRADES, "img_size": IMG_SIZE,
    "normalize": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
    "val_image_level": {"item": float((Pi == Yi).mean()), "grade": float((Pg == Yg).mean())},
    "val_object_level": {"item": float(acc_item_obj), "grade": float(acc_grade_obj), "n_objects": int(n_obj)},
    "weight_only_grade_baseline": float(base),
    "mean_confidence": float(Conf.mean()),
    "mean_confidence_when_wrong": float(wrong.mean()) if len(wrong) else None,
    "caveats": [
        "스튜디오 촬영(흰 배경·1000×1000)으로 학습했다. 실제 폰 사진 성능은 별도 측정이 필요하다.",
        "독립 표본은 개체 수이며 이미지 수가 아니다. 대외 수치는 개체 단위를 쓴다.",
        "등급은 크기·중량 의존도가 높아 사진만으로는 상한이 있다. 확정 등급은 거점 실물 검수가 정한다.",
    ],
}
(EXPORT / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(meta, ensure_ascii=False, indent=2))

shutil.make_archive("/content/onfarm_model", "zip", EXPORT)
from google.colab import files
files.download("/content/onfarm_model.zip")

# %% [markdown]
# ## ON-FARM 에 붙이기
#
# `onfarm_qc.onnx` + `metadata.json` 으로 `src/ai/providers/cnn.ts` 를 만든다.
# `VisionProvider` 인터페이스만 지키면 되고, 두 가지를 반드시 지킬 것:
#
# 1. `validateRecognition()` 스키마 검증을 그대로 통과시킨다(카탈로그 밖 품목·임의 가격 차단).
# 2. 모델 confidence 를 그대로 쓰지 말고 `metadata.json` 의 **개체 단위** 수치로 상한을 잡는다.
#    한바구니에서 provider confidence 를 재검증 없이 믿었다가 안전장치가 통째로 우회된 전례가 있다.
#
# 그리고 등급 출력은 `val_object_level.grade` 가 `weight_only_grade_baseline` 을 넘지 못하면
# 화면에 쓰지 않는다. 품목 인식만 쓰고 등급은 거점 검수에 맡긴다.
