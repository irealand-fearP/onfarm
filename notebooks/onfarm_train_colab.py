"""
ON-FARM 품목·등급 모델 학습 (Colab)
===================================

이 파일은 Colab 노트북 셀로 나눠 붙여넣도록 `# %%` 로 구분돼 있다.
(VS Code / Jupytext 에서는 그대로 노트북처럼 실행된다)

설계 원칙 — 라벨 실측 분석(docs/aihub-dataset.md)에서 나온 결론을 코드로 강제한다.
  1. 공식 Train/Validation 을 그대로 쓴다. 자체 재분할 금지.
     (개체당 40장 근접중복이라 직접 나누면 정확도가 부풀려진다)
  2. 정확도는 이미지 단위가 아니라 **개체(group_no) 단위**로도 보고한다.
     독립 표본은 1,098개체뿐이므로 이미지 단위 숫자는 과장이다.
  3. 등급 모델은 **중량 단독 기준선**(양파 89.2% ~ 배 60.8%)과 반드시 비교한다.
     사진 모델이 이를 못 넘으면 "사진으로 등급을 본다"고 말하지 않는다.
  4. 디스크: zip 1개씩 받아 224px 로 줄이고 원본을 즉시 삭제한다(119GB → 약 2GB).
"""

# %% [markdown]
# # ON-FARM 학습 — AI 허브 농산물 품질(QC) 이미지
#
# **런타임 → 런타임 유형 변경 → GPU** 를 먼저 설정하세요.

# %%
# --- 0. 환경 확인 -----------------------------------------------------------
import shutil, subprocess, sys

print(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"],
                     capture_output=True, text=True).stdout or "GPU 없음 — 런타임 유형을 GPU 로 바꾸세요")
total, used, free = shutil.disk_usage("/content")
print(f"디스크 여유 {free/2**30:.0f} GB")
import torch
print("torch", torch.__version__, "| cuda", torch.cuda.is_available())

# %%
# --- 1. API 키와 aihubshell -------------------------------------------------
# 키는 노트북에 저장하지 않는다(공유 시 유출 방지). 셀 실행 후 입력창에 붙여넣기.
import getpass, os, pathlib

AIHUB_KEY = getpass.getpass("AI허브 API Key: ").strip()
WORK = pathlib.Path("/content/aihub"); WORK.mkdir(exist_ok=True)
os.chdir(WORK)

!curl -s -o aihubshell https://api.aihub.or.kr/api/aihubshell.do && chmod +x aihubshell
!./aihubshell -mode l 149 | head -20

# %%
# --- 2. 받을 대상 -----------------------------------------------------------
# ON-FARM 카탈로그와 겹치는 5품목. 각 값은 Train/Valid 를 모두 포함한다.
FILEKEYS = {
    "apple": {  # 사과 (부사, 양광) 27.6GB
        "label": "396903,396904,396905,396906,396907,396908,397011,397012,397013,397014,397015,397016",
        "src":   "396957,396958,396959,396960,396961,396962,397065,397066,397067,397068,397069,397070"},
    "pear": {  # 배 (신고, 추황) 20.9GB
        "label": "396933,396934,396935,396936,396937,396938,397041,397042,397043,397044,397045,397046",
        "src":   "396987,396988,396989,396990,396991,396992,397095,397096,397097,397098,397099,397100"},
    "mandarine": {  # 감귤 (한라봉, 온주밀감) 20.6GB
        "label": "396921,396922,396923,396924,396925,396926,397023,397024,397025,397032,397033,397034",
        "src":   "396969,396970,396971,396978,396979,396980,397077,397078,397079,397086,397087,397088"},
    "onion": {  # 양파 (일반, 적색) 25.1GB
        "label": "396927,396928,396929,396930,396931,396932,397035,397036,397037,397038,397039,397040",
        "src":   "396981,396982,396983,396984,396985,396986,397089,397090,397091,397092,397093,397094"},
    "potato": {  # 감자 (설봉, 수미) 25.1GB
        "label": "396948,396949,396950,396951,396952,396953,397056,397057,397058,397059,397060,397061",
        "src":   "397002,397003,397004,397005,397006,397007,397110,397111,397112,397113,397114,397115"},
}

# 처음에는 pear 하나로 파이프라인을 검증하고, 되면 전체로 넓히세요.
TARGETS = ["pear"]          # 검증용
# TARGETS = list(FILEKEYS)  # 본 학습

IMG_SIZE = 224              # 저장 해상도(원본 1000×1000 → 학습용 축소)

# %%
# --- 3. 라벨 먼저 받기 (가볍다) ---------------------------------------------
import subprocess

def aihub_download(filekeys: str) -> None:
    cmd = ["./aihubshell", "-mode", "d", "-datasetkey", "149",
           "-filekey", filekeys, "-aihubapikey", AIHUB_KEY]
    p = subprocess.run(cmd, capture_output=True, text=True)
    tail = (p.stdout or "")[-400:]
    if "승인" in tail or "failed" in tail.lower():
        raise RuntimeError(f"다운로드 실패:\n{tail}")
    print(tail[-200:])

for name in TARGETS:
    print(f"[라벨] {name}")
    aihub_download(FILEKEYS[name]["label"])

DATA_ROOT = next(WORK.rglob("01.데이터"))
print("데이터 루트:", DATA_ROOT)

# %%
# --- 4. 원천 zip 하나를 받아 내부 구조를 눈으로 확인 -------------------------
# 이미지 zip 의 내부 경로 규칙을 추측하지 않고 실제로 본다.
probe = FILEKEYS[TARGETS[0]]["src"].split(",")[0]
aihub_download(probe)

import zipfile
src_zips = sorted((DATA_ROOT / "1.Training").rglob("*.zip")) + \
           sorted((DATA_ROOT / "2.Validation").rglob("*.zip"))
src_zips = [z for z in src_zips if "원천" in str(z)]
print("원천 zip:", [z.name for z in src_zips][:3])
with zipfile.ZipFile(src_zips[0]) as zf:
    names = zf.namelist()
print(f"내부 항목 {len(names):,}개. 샘플:")
for n in names[:8]:
    print("   ", n)

# %%
# --- 5. 라벨 파싱 + 무결성 검증 ---------------------------------------------
import json, collections

def read_labels(root: pathlib.Path) -> list[dict]:
    out = []
    for split_dir, split in ((root / "1.Training", "train"), (root / "2.Validation", "valid")):
        for zp in sorted(split_dir.rglob("*.zip")):
            if "라벨" not in str(zp):
                continue
            with zipfile.ZipFile(zp) as zf:
                for n in zf.namelist():
                    if not n.lower().endswith(".json"):
                        continue
                    o = json.loads(zf.read(n).decode("utf-8-sig"))
                    out.append({
                        "split": split, "json": pathlib.PurePath(n).stem,
                        "group_no": o["group_no"], "item": o["cate1"], "variety": o["cate2"],
                        "grade": o["cate3"], "weight": float(o.get("weight") or 0),
                        "repo": o.get("repo", ""), "identifier": o.get("identifier", ""),
                        "angle_direction": o.get("angle_direction"),
                    })
    return out

# 다운로드가 중간에 잘리는 일이 실제로 있었다(Validation 54개 중 21개만 받아진 적 있음).
# 불완전한 라벨로 통계를 내면 결론이 통째로 틀리므로 먼저 확인한다.
for split_dir, expect in ((DATA_ROOT / "1.Training", 54), (DATA_ROOT / "2.Validation", 54)):
    got = [z for z in split_dir.rglob("*.zip") if "라벨" in str(z)]
    bad = []
    for z in got:
        try:
            zipfile.ZipFile(z).namelist()
        except zipfile.BadZipFile:
            bad.append(z.name)
    print(f"{split_dir.name}: 라벨 zip {len(got)}개" + (f" | 손상 {bad}" if bad else ""))
    assert not bad, f"손상된 zip 을 다시 받으세요: {bad}"

labels = read_labels(DATA_ROOT)
print(f"라벨 {len(labels):,}건")

g = collections.defaultdict(set)
for r in labels:
    g[r["split"]].add(r["group_no"])
overlap = g["train"] & g["valid"]
if overlap:
    # 전량 분석 결과 실제로 1개(배/추황/상)가 양쪽에 걸쳐 있다.
    # 죽이지 말고 검증쪽에서 빼서 검증 수치를 정직하게 만든다.
    before = len(labels)
    labels = [r for r in labels if not (r["split"] == "valid" and r["group_no"] in overlap)]
    print(f"⚠️ 개체 누출 {len(overlap)}개 발견 → valid 에서 제외 ({before - len(labels)}장 제거)")
else:
    print("✅ 개체 누출 없음")
print(f"train 개체 {len(g['train'])}, valid 개체 {len(g['valid']) - len(overlap)}")
print("등급 분포:", collections.Counter(r["grade"] for r in labels))

# %%
# --- 6. 원천 수집: 받기 → 축소 → 원본 삭제 (디스크 절약) --------------------
from PIL import Image
import io, gc

OUT = pathlib.Path("/content/dataset"); OUT.mkdir(exist_ok=True)

def ingest_source(filekey: str) -> int:
    """원천 zip 1개를 받아 224px JPEG 로 변환하고 원본을 지운다."""
    aihub_download(filekey)
    saved = 0
    for zp in list(DATA_ROOT.rglob("*.zip")):
        if "원천" not in str(zp):
            continue
        split = "train" if "1.Training" in str(zp) else "valid"
        with zipfile.ZipFile(zp) as zf:
            for n in zf.namelist():
                if not n.lower().endswith((".png", ".jpg", ".jpeg")):
                    continue
                try:
                    im = Image.open(io.BytesIO(zf.read(n))).convert("RGB")
                except Exception:
                    continue
                im = im.resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)
                # 라벨과 잇기 위해 원래 경로를 파일명에 보존한다
                flat = pathlib.PurePath(n).as_posix().replace("/", "__")
                dst = OUT / split / (pathlib.PurePath(flat).stem + ".jpg")
                dst.parent.mkdir(parents=True, exist_ok=True)
                im.save(dst, "JPEG", quality=88)
                saved += 1
        zp.unlink()          # 원본 zip 즉시 삭제
    gc.collect()
    return saved

total_saved = 0
for name in TARGETS:
    for fk in FILEKEYS[name]["src"].split(","):
        n = ingest_source(fk)
        total_saved += n
        free = shutil.disk_usage("/content")[2] / 2**30
        print(f"  {name} {fk}: {n:,}장 (누적 {total_saved:,}) | 디스크 여유 {free:.0f}GB")

# %%
# --- 7. 이미지 ↔ 라벨 연결 ---------------------------------------------------
# 라벨 JSON 이름(pear_singo_L_1-1)과 이미지 파일명을 stem 으로 맞춘다.
# 매칭률이 낮으면 규칙이 다른 것이므로 여기서 멈추고 위 4번 셀의 실제 경로를 확인할 것.
img_index = {}
for split in ("train", "valid"):
    for p in (OUT / split).glob("*.jpg"):
        img_index[p.stem] = p
        img_index[p.stem.split("__")[-1]] = p

rows, missed = [], 0
for r in labels:
    p = img_index.get(r["json"]) or img_index.get(r["json"].split("__")[-1])
    if p is None:
        missed += 1
        continue
    rows.append({**r, "path": str(p)})

rate = len(rows) / max(len(labels), 1)
print(f"매칭 {len(rows):,}/{len(labels):,} ({rate:.1%}), 누락 {missed:,}")
assert rate > 0.95, "매칭률이 낮다 — 이미지 zip 내부 경로 규칙을 4번 셀에서 다시 확인하라"

# %%
# --- 8. 데이터셋 -------------------------------------------------------------
import numpy as np, torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms

ITEMS = sorted({r["item"] for r in rows})
GRADES = ["보통", "상", "특"]
print("품목:", ITEMS, "| 등급:", GRADES)

train_tf = transforms.Compose([
    transforms.RandomResizedCrop(IMG_SIZE, scale=(0.7, 1.0)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(0.25, 0.25, 0.2, 0.03),   # 폰 카메라 화이트밸런스 차이를 흉내
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
        img = self.tf(Image.open(r["path"]).convert("RGB"))
        return img, ITEMS.index(r["item"]), GRADES.index(r["grade"]), r["group_no"]

tr = [r for r in rows if r["split"] == "train"]
va = [r for r in rows if r["split"] == "valid"]
print(f"train {len(tr):,} / valid {len(va):,}")

dl_tr = DataLoader(QCDataset(tr, train_tf), batch_size=64, shuffle=True, num_workers=2, pin_memory=True)
dl_va = DataLoader(QCDataset(va, eval_tf), batch_size=128, shuffle=False, num_workers=2)

# %%
# --- 9. 모델: 품목 + 등급 멀티태스크 ----------------------------------------
import torch.nn as nn
from torchvision import models

dev = "cuda" if torch.cuda.is_available() else "cpu"
net = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
feat = net.classifier[1].in_features
net.classifier = nn.Identity()

class TwoHead(nn.Module):
    def __init__(self, backbone, feat):
        super().__init__()
        self.backbone = backbone
        self.item = nn.Linear(feat, len(ITEMS))
        self.grade = nn.Linear(feat, len(GRADES))
    def forward(self, x):
        f = self.backbone(x)
        return self.item(f), self.grade(f)

model = TwoHead(net, feat).to(dev)
opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
EPOCHS = 6
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-4, total_steps=EPOCHS * len(dl_tr))
scaler = torch.amp.GradScaler("cuda", enabled=(dev == "cuda"))

for ep in range(EPOCHS):
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

# %%
# --- 10. 평가: 이미지 단위 + 개체 단위 + 중량 기준선 비교 -------------------
model.eval()
P_item, P_grade, Y_item, Y_grade, G, C_item = [], [], [], [], [], []
with torch.no_grad():
    for x, yi, yg, gno in dl_va:
        with torch.amp.autocast("cuda", enabled=(dev == "cuda")):
            pi, pg = model(x.to(dev))
        prob = torch.softmax(pi.float(), 1)
        P_item += prob.argmax(1).cpu().tolist(); C_item += prob.max(1).values.cpu().tolist()
        P_grade += pg.float().argmax(1).cpu().tolist()
        Y_item += yi.tolist(); Y_grade += yg.tolist(); G += list(gno)

P_item, Y_item = np.array(P_item), np.array(Y_item)
P_grade, Y_grade = np.array(P_grade), np.array(Y_grade)
G = np.array([int(x) for x in G])

print("=" * 56)
print(f"이미지 단위  품목 {(P_item==Y_item).mean():.3f} | 등급 {(P_grade==Y_grade).mean():.3f}")

# 개체 단위(같은 실물의 여러 장을 다수결) — 이쪽이 정직한 숫자다
def by_object(pred, true):
    ok = 0; groups = np.unique(G)
    for gid in groups:
        m = G == gid
        ok += int(np.bincount(pred[m]).argmax() == np.bincount(true[m]).argmax())
    return ok / len(groups), len(groups)

acc_i, n_obj = by_object(P_item, Y_item)
acc_g, _ = by_object(P_grade, Y_grade)
print(f"개체 단위    품목 {acc_i:.3f} | 등급 {acc_g:.3f}   (개체 {n_obj}개)")

# 중량만 보는 기준선 — 사진 모델이 이걸 못 넘으면 '사진으로 등급을 본다'고 말하면 안 된다
w_by_obj, g_by_obj = {}, {}
for r in va:
    w_by_obj[r["group_no"]] = r["weight"]; g_by_obj[r["group_no"]] = GRADES.index(r["grade"])
ws = np.array([w_by_obj[k] for k in sorted(w_by_obj)])
gs = np.array([g_by_obj[k] for k in sorted(g_by_obj)])
best = 0.0
for t1 in np.unique(ws):
    for t2 in np.unique(ws[ws >= t1]):
        pred = np.where(ws <= t1, 0, np.where(ws <= t2, 1, 2))
        best = max(best, (pred == gs).mean())
print(f"[기준선] 중량만으로 등급  {best:.3f}")
print("→ 사진 등급 모델이 이 기준선을 못 넘으면 등급 주장은 하지 않는다")
print("=" * 56)

for i, name in enumerate(ITEMS):
    m = Y_item == i
    if m.any():
        print(f"  {name}: 품목 {(P_item[m]==i).mean():.3f} | 등급 {(P_grade[m]==Y_grade[m]).mean():.3f} (n={m.sum()})")
print(f"\n평균 확신도 {np.mean(C_item):.3f} / 오답일 때 {np.mean(np.array(C_item)[P_item!=Y_item] or [0]):.3f}")

# %%
# --- 11. 내보내기 — ON-FARM provider 가 쓸 형태 -----------------------------
import json, datetime

EXPORT = pathlib.Path("/content/onfarm_model"); EXPORT.mkdir(exist_ok=True)
model_cpu = model.to("cpu").eval()
torch.onnx.export(model_cpu, torch.randn(1, 3, IMG_SIZE, IMG_SIZE), EXPORT / "onfarm_qc.onnx",
                  input_names=["image"], output_names=["item_logits", "grade_logits"],
                  dynamic_axes={"image": {0: "n"}}, opset_version=17)

meta = {
    "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
    "dataset": "AI-Hub 149 농산물 품질(QC) 이미지",
    "items": ITEMS, "grades": GRADES, "img_size": IMG_SIZE,
    "normalize": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
    "val_image_level": {"item": float((P_item == Y_item).mean()), "grade": float((P_grade == Y_grade).mean())},
    "val_object_level": {"item": float(acc_i), "grade": float(acc_g), "n_objects": int(n_obj)},
    "weight_only_grade_baseline": float(best),
    "caveats": [
        "스튜디오 촬영(흰 배경·1000×1000) 데이터로 학습했다. 실제 폰 사진 성능은 별도 측정 필요.",
        "독립 표본은 개체 수이며 이미지 수가 아니다. 개체 단위 수치를 대외에 쓴다.",
        "등급은 크기·중량 의존도가 높아 사진만으로는 상한이 있다. 확정 등급은 거점 실물 검수가 정한다.",
    ],
}
(EXPORT / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(meta, ensure_ascii=False, indent=2))

!cd /content && zip -qr onfarm_model.zip onfarm_model && ls -lh onfarm_model.zip
from google.colab import files
files.download("/content/onfarm_model.zip")

# %% [markdown]
# ## ON-FARM 에 붙이기
#
# 내려받은 `onfarm_qc.onnx` + `metadata.json` 으로 `src/ai/providers/cnn.ts` 를 만든다.
# `VisionProvider` 인터페이스만 지키면 되고, 다음 두 가지를 반드시 지킬 것:
#
# 1. `validateRecognition()` 스키마 검증을 그대로 통과시킨다 (카탈로그 밖 품목·임의 가격 차단).
# 2. 모델이 낸 confidence 를 그대로 쓰지 말고 `metadata.json` 의 개체 단위 수치로 상한을 잡는다.
#    한바구니에서 provider confidence 를 재검증 없이 신뢰했다가 게이트가 통째로 우회된 전례가 있다.
