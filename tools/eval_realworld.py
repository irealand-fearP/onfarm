"""
"사과를 찍으면 사과라고 하는가" 를 실제로 잰다. 다중 배율 판정(TTA) 전후를 비교한다.

    python3 tools/eval_realworld.py                      # TTA 끄고/켜고 전체 조건
    python3 tools/eval_realworld.py --n 12 --conditions studio,far
    python3 tools/eval_realworld.py --self-test

★ 표본에 대한 정직한 고지 ★
팀원 저장소의 원본 도구는 학습 검증 분할(data/onfarm_cv/valid, 품목당 수백 장)을 썼다.
우리 저장소에는 그 데이터가 없다. 그래서 화면에 쓰는 상품 사진 web/img/products/*.webp
(품목당 딱 1장)에서 촬영 변형(회전·밝기·좌우반전·확대 흔들기)을 합성해 표본을 만든다.
따라서 여기 나오는 수치는 **독립 표본이 아니다**. 한 장에서 나온 변형들이라
"이 조건에서 무너지는가 / 고쳐지는가" 를 보는 용도이지, 절대 정확도로 대외에 쓸 값이 아니다.

브라우저가 하는 전처리를 그대로 흉내 낸다(web/js/features.js extractModelPixels):
    canvas 224x224 에 drawImage(source, 0, 0, 224, 224)  ← 비율 무시하고 늘림
그다음 서버(src/ai/providers/cnn.ts)가 하는 일을 그대로 흉내 낸다:
    224 버퍼에서 중앙을 배율별로 잘라 224 로 확대 → 배치 추론 → 최댓값 합치기 → 합 1 정규화
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageEnhance

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "onfarm_qc.onnx"
META = json.loads((ROOT / "models" / "metadata.json").read_text(encoding="utf-8"))
PRODUCT_IMG = ROOT / "web" / "img" / "products"
SIZE = 224
ITEMS: list[str] = META["items"]
MEAN = np.array(META["normalize"]["mean"], dtype=np.float32)
STD = np.array(META["normalize"]["std"], dtype=np.float32)

# cnn.ts 의 TTA_SCALES 와 같아야 한다. 어긋나면 여기 수치가 서버와 다른 것을 재게 된다.
TTA_SCALES = [1.0, 0.7, 0.5, 0.35, 0.25]

# 모델이 아는 5품목 ↔ 우리 상품 사진 파일. 나머지 11종은 모델 라벨에 없어 평가 대상이 아니다.
SOURCES = {
    "감귤": "mandarin.webp",
    "감자": "potato.webp",
    "배": "pear.webp",
    "사과": "apple.webp",
    "양파": "onion.webp",
}


# ── 표본 만들기 ────────────────────────────────────────────────────────
def make_variants(img: Image.Image, n: int, seed: int = 7) -> list[Image.Image]:
    """상품 사진 한 장에서 '다른 날 다른 손으로 찍은 것 같은' 변형 n 장을 만든다."""
    rng = np.random.default_rng(seed)
    out: list[Image.Image] = []
    for i in range(n):
        v = img.convert("RGB")
        if i % 2 == 1:
            v = v.transpose(Image.FLIP_LEFT_RIGHT)
        angle = float(rng.uniform(-10, 10))
        v = v.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=(245, 245, 245))
        zoom = float(rng.uniform(0.88, 1.0))
        w, h = v.size
        cw, ch = int(w * zoom), int(h * zoom)
        ox = int(rng.integers(0, max(1, w - cw + 1)))
        oy = int(rng.integers(0, max(1, h - ch + 1)))
        v = v.crop((ox, oy, ox + cw, oy + ch))
        v = ImageEnhance.Brightness(v).enhance(float(rng.uniform(0.85, 1.15)))
        out.append(v)
    return out


# ── 브라우저 전처리 재현 ───────────────────────────────────────────────
def to_pixels(img: Image.Image) -> np.ndarray:
    """features.js 의 extractModelPixels — 비율을 지키지 않고 224x224 로 늘린 RGB(uint8)."""
    return np.asarray(img.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR), dtype=np.uint8)


def normalize(rgb_u8: np.ndarray) -> np.ndarray:
    """uint8 HWC → 정규화된 CHW float32. cnn.ts toTensor 와 같은 계산."""
    rgb = rgb_u8.astype(np.float32) / 255.0
    return ((rgb - MEAN) / STD).transpose(2, 0, 1)


def crop_center(rgb_u8: np.ndarray, scale: float) -> np.ndarray:
    """cnn.ts cropCenter 재현 — 중앙 정사각(비율 scale)을 잘라 224 로 이중선형 확대."""
    if scale >= 1:
        return rgb_u8
    crop = max(8, round(SIZE * scale))
    off = (SIZE - crop) // 2
    patch = Image.fromarray(rgb_u8[off:off + crop, off:off + crop])
    return np.asarray(patch.resize((SIZE, SIZE), Image.BILINEAR), dtype=np.uint8)


# ── 시연 조건 흉내 ─────────────────────────────────────────────────────
def cond_studio(img: Image.Image) -> Image.Image:
    """학습과 같은 조건 — 이 값이 상한이다."""
    return img


def cond_stretch43(img: Image.Image) -> Image.Image:
    """폰 가로 사진(4:3). 정사각 피사체가 가로로 늘어난 채 들어온다."""
    w, h = img.size
    canvas = Image.new("RGB", (int(h * 4 / 3), h), (245, 245, 245))
    canvas.paste(img, ((canvas.width - w) // 2, 0))
    return canvas


def cond_portrait34(img: Image.Image) -> Image.Image:
    """폰 세로 사진(3:4). 실제 농가가 가장 많이 찍는 모양."""
    w, h = img.size
    canvas = Image.new("RGB", (w, int(w * 4 / 3)), (245, 245, 245))
    canvas.paste(img, (0, (canvas.height - h) // 2))
    return canvas


def cond_background(img: Image.Image) -> Image.Image:
    """흰 배경이 아닌 곳(마당·상자·흙) 위에 놓고 찍은 상황."""
    w, h = img.size
    bg = Image.new("RGB", (int(w * 1.35), int(h * 1.35)), (122, 104, 78))
    noise = np.random.default_rng(0).integers(-18, 18, (bg.height, bg.width, 3), dtype=np.int16)
    bg = Image.fromarray(np.clip(np.asarray(bg, np.int16) + noise, 0, 255).astype(np.uint8))
    bg.paste(img, ((bg.width - w) // 2, (bg.height - h) // 2))
    return bg


def cond_far(img: Image.Image) -> Image.Image:
    """멀리서 찍어 피사체가 화면 가로의 25% 만 차지하는 경우 — 문제의 조건."""
    w, h = img.size
    bg = Image.new("RGB", (w * 4, h * 4), (150, 148, 143))
    small = img.resize((w, h), Image.LANCZOS)
    bg.paste(small, ((bg.width - w) // 2, (bg.height - h) // 2))
    return bg


def cond_mid(img: Image.Image) -> Image.Image:
    """조금 떨어져서(화면 가로의 50%) — 무너지기 시작하는 지점을 본다."""
    w, h = img.size
    bg = Image.new("RGB", (w * 2, h * 2), (150, 148, 143))
    bg.paste(img, ((bg.width - w) // 2, (bg.height - h) // 2))
    return bg


def cond_dim(img: Image.Image) -> Image.Image:
    """실내·그늘. 밝기가 떨어진다."""
    return ImageEnhance.Brightness(img).enhance(0.55)


def cond_tilt(img: Image.Image) -> Image.Image:
    """손으로 들고 찍어 기울어진 경우."""
    return img.rotate(12, resample=Image.BILINEAR, expand=True, fillcolor=(245, 245, 245))


CONDITIONS = {
    "studio": ("학습과 같은 조건", cond_studio),
    "stretch43": ("폰 가로 4:3", cond_stretch43),
    "portrait34": ("폰 세로 3:4", cond_portrait34),
    "background": ("흙·상자 배경", cond_background),
    "mid": ("조금 떨어져서(50%)", cond_mid),
    "far": ("멀리서 촬영(25%)", cond_far),
    "dim": ("어두운 곳", cond_dim),
    "tilt": ("기울어짐", cond_tilt),
}


# ── 추론 ───────────────────────────────────────────────────────────────
def softmax(logits: np.ndarray) -> np.ndarray:
    e = np.exp(logits - logits.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def predict(session: ort.InferenceSession, pixels: list[np.ndarray], tta: bool) -> np.ndarray:
    """사진마다 품목 확률 한 줄을 돌려준다. tta=True 면 cnn.ts 와 같은 방식으로 합친다."""
    scales = TTA_SCALES if tta else [1.0]
    rows = []
    for rgb in pixels:
        batch = np.stack([normalize(crop_center(rgb, s)) for s in scales]).astype(np.float32)
        outputs = session.run(None, {session.get_inputs()[0].name: batch})
        names = [o.name for o in session.get_outputs()]
        logits = outputs[names.index("item_logits")] if "item_logits" in names else outputs[0]
        probs = softmax(np.asarray(logits, dtype=np.float64))
        if tta:
            fused = probs.max(axis=0)
            fused = fused / (fused.sum() or 1)  # 합 1로 되돌린다 — 신뢰도가 부풀지 않게
        else:
            fused = probs[0]
        rows.append(fused)
    return np.stack(rows)


def _self_test() -> None:
    """조건 함수와 크롭이 실제로 그림을 바꾸는지 — 아무것도 안 하면 측정이 헛돈다."""
    img = Image.new("RGB", (200, 200), (200, 100, 50))
    for key, (label, fn) in CONDITIONS.items():
        got = fn(img)
        if key == "studio":
            assert got.size == img.size, "studio 는 원본 그대로여야 한다"
            continue
        changed = got.size != img.size or np.asarray(got.resize((32, 32))).astype(int).sum() != \
            np.asarray(img.resize((32, 32))).astype(int).sum()
        assert changed, f"'{label}' 조건이 이미지를 전혀 바꾸지 않는다"

    px = to_pixels(img)
    assert px.shape == (SIZE, SIZE, 3), px.shape
    assert normalize(px).shape == (3, SIZE, SIZE)

    # 크롭이 실제로 확대하는가: 가운데 표식이 커져야 한다.
    mark = np.full((SIZE, SIZE, 3), 200, dtype=np.uint8)
    mark[SIZE // 2 - 8:SIZE // 2 + 8, SIZE // 2 - 8:SIZE // 2 + 8] = 10
    base = int((mark[:, :, 0] < 100).sum())
    half = int((crop_center(mark, 0.5)[:, :, 0] < 100).sum())
    assert half > base * 3, f"0.5 크롭이 확대하지 않는다 ({base}→{half})"

    variants = make_variants(img, 4)
    assert len(variants) == 4
    print(f"✅ 조건 {len(CONDITIONS)}종·크롭 확대({base}→{half})·변형 생성 모두 정상")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12, help="품목당 합성 표본 수")
    ap.add_argument("--conditions", default="", help="쉼표로 구분(기본: 전체)")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--json", type=Path, help="결과를 JSON 으로 저장")
    args = ap.parse_args()

    if args.self_test:
        _self_test()
        return 0

    if not MODEL.exists():
        raise SystemExit(f"모델이 없습니다: {MODEL}")
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])

    sources: dict[str, Image.Image] = {}
    for item, fname in SOURCES.items():
        path = PRODUCT_IMG / fname
        if path.exists():
            sources[item] = Image.open(path).convert("RGB")
    if not sources:
        raise SystemExit(f"상품 사진이 없습니다: {PRODUCT_IMG}")

    keys = [k.strip() for k in args.conditions.split(",") if k.strip()] or list(CONDITIONS)
    results: dict[str, dict] = {}

    for key in keys:
        label, fn = CONDITIONS[key]
        for tta in (False, True):
            per_item: dict[str, dict[str, float]] = {}
            for item, img in sources.items():
                pixels = [to_pixels(fn(v)) for v in make_variants(img, args.n)]
                probs = predict(session, pixels, tta)
                order = np.argsort(-probs, axis=1)
                idx = ITEMS.index(item)
                per_item[item] = {
                    "top1": float((order[:, 0] == idx).mean()),
                    "top3": float((order[:, :3] == idx).any(axis=1).mean()),
                }
            results[f"{key}|{'tta' if tta else 'off'}"] = {
                "label": label,
                "tta": tta,
                "top1": float(np.mean([v["top1"] for v in per_item.values()])),
                "top3": float(np.mean([v["top3"] for v in per_item.values()])),
                "per_item": per_item,
            }

    width = max(len(v["label"]) for v in results.values()) + 2
    print(f"\n상품 사진 {len(sources)}종 × 합성 변형 {args.n}장 · 브라우저 전처리(224 늘리기) 재현")
    print("※ 품목당 원본 사진은 1장이다. 변형은 독립 표본이 아니다.\n")
    header = f"{'조건':<{width}}{'top-1 끄고':>11}{'켜고':>8}   {'top-3 끄고':>11}{'켜고':>8}"
    print(header)
    print("-" * len(header))
    for key in keys:
        off = results[f"{key}|off"]
        on = results[f"{key}|tta"]
        print(
            f"{off['label']:<{width}}{off['top1']:>11.0%}{on['top1']:>8.0%}   "
            f"{off['top3']:>11.0%}{on['top3']:>8.0%}"
        )

    if "far" in keys:
        print("\n멀리서 촬영 — 품목별 top-1 (끄고 → 켜고)")
        off = results["far|off"]["per_item"]
        on = results["far|tta"]["per_item"]
        for item in off:
            print(f"  {item:<4} {off[item]['top1']:>5.0%} → {on[item]['top1']:>5.0%}")

    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n저장: {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
