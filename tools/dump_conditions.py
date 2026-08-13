"""
상품 사진 16종에 촬영 조건을 합성해, 브라우저가 서버로 보내는 것과 같은 두 가지를 파일로 뽑는다.

    python3 tools/dump_conditions.py --n 8 --out /tmp/onfarm-eval

왜 파이썬이 필요한가: 우리 상품 사진은 .webp 인데 node 에는 webp 디코더가 없다(의존성 0 원칙).
그래서 디코딩·조건 합성만 파이썬이 하고, **판정은 실제 서버 코드(node)** 가 한다.
판정을 파이썬으로 흉내 내면 "우리 서버가 실제로 어떻게 답하는가" 를 재지 못한다.

뽑는 것 두 가지 (web/js/features.js prepareImage 이 만드는 것과 같다):
  feat_*.bin : 긴 변 256 으로 줄인 RGBA  → extractFeatures 입력 (heuristic 이 쓴다)
  px_*.bin   : 224x224 RGB (비율 무시하고 늘림) → CNN 입력
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
PRODUCT_IMG = ROOT / "web" / "img" / "products"
ANALYZE_MAX_SIDE = 256  # features.js 와 같아야 한다
MODEL_SIZE = 224

# 파일명 ↔ 우리 카탈로그 품목 코드·한글명 (seed.ts 와 같다)
PRODUCTS = {
    "pear": "배",
    "apple": "사과",
    "sweet_potato": "고구마",
    "potato": "감자",
    "onion": "양파",
    "mandarin": "감귤",
    "red_pepper": "건고추",
    "peach": "복숭아",
    "rice": "쌀",
    "garlic": "마늘",
    "grape": "포도",
    "persimmon": "감",
    "mackerel": "고등어",
    "shrimp": "새우",
    "squid": "오징어",
    "abalone": "전복",
}

# 모델(metadata.json items)이 아는 5품목. 나머지는 CNN 이 원리적으로 맞힐 수 없다.
MODEL_ITEMS = {"감귤", "감자", "배", "사과", "양파"}


def make_variants(img: Image.Image, n: int, seed: int = 7) -> list[Image.Image]:
    """상품 사진 한 장에서 '다른 날 다른 손으로 찍은 것 같은' 변형 n 장을 만든다."""
    rng = np.random.default_rng(seed)
    out: list[Image.Image] = []
    for i in range(n):
        v = img.convert("RGB")
        if i % 2 == 1:
            v = v.transpose(Image.FLIP_LEFT_RIGHT)
        v = v.rotate(float(rng.uniform(-10, 10)), resample=Image.BILINEAR,
                     expand=False, fillcolor=(245, 245, 245))
        zoom = float(rng.uniform(0.88, 1.0))
        w, h = v.size
        cw, ch = int(w * zoom), int(h * zoom)
        ox = int(rng.integers(0, max(1, w - cw + 1)))
        oy = int(rng.integers(0, max(1, h - ch + 1)))
        v = v.crop((ox, oy, ox + cw, oy + ch))
        out.append(ImageEnhance.Brightness(v).enhance(float(rng.uniform(0.85, 1.15))))
    return out


def cond_studio(img: Image.Image) -> Image.Image:
    return img


def cond_stretch43(img: Image.Image) -> Image.Image:
    w, h = img.size
    canvas = Image.new("RGB", (int(h * 4 / 3), h), (245, 245, 245))
    canvas.paste(img, ((canvas.width - w) // 2, 0))
    return canvas


def cond_portrait34(img: Image.Image) -> Image.Image:
    w, h = img.size
    canvas = Image.new("RGB", (w, int(w * 4 / 3)), (245, 245, 245))
    canvas.paste(img, (0, (canvas.height - h) // 2))
    return canvas


def cond_background(img: Image.Image) -> Image.Image:
    w, h = img.size
    bg = Image.new("RGB", (int(w * 1.35), int(h * 1.35)), (122, 104, 78))
    noise = np.random.default_rng(0).integers(-18, 18, (bg.height, bg.width, 3), dtype=np.int16)
    bg = Image.fromarray(np.clip(np.asarray(bg, np.int16) + noise, 0, 255).astype(np.uint8))
    bg.paste(img, ((bg.width - w) // 2, (bg.height - h) // 2))
    return bg


def _pull_back(img: Image.Image, fill: float) -> Image.Image:
    """피사체가 화면 가로의 fill 만 차지하도록 회색 배경 가운데 놓는다."""
    w, h = img.size
    side = int(max(w, h) / fill)
    bg = Image.new("RGB", (side, side), (150, 148, 143))
    bg.paste(img, ((side - w) // 2, (side - h) // 2))
    return bg


def cond_mid(img: Image.Image) -> Image.Image:
    return _pull_back(img, 0.5)


def cond_far(img: Image.Image) -> Image.Image:
    return _pull_back(img, 0.25)


def cond_dim(img: Image.Image) -> Image.Image:
    return ImageEnhance.Brightness(img).enhance(0.55)


def cond_tilt(img: Image.Image) -> Image.Image:
    return img.rotate(12, resample=Image.BILINEAR, expand=True, fillcolor=(245, 245, 245))


CONDITIONS = {
    "studio": ("학습과 같은 조건", cond_studio),
    "stretch43": ("폰 가로 4:3", cond_stretch43),
    "portrait34": ("폰 세로 3:4", cond_portrait34),
    "background": ("흙·상자 배경", cond_background),
    "mid": ("조금 떨어져서 50%", cond_mid),
    "far": ("멀리서 촬영 25%", cond_far),
    "dim": ("어두운 곳", cond_dim),
    "tilt": ("기울어짐", cond_tilt),
}


def draw_scaled(img: Image.Image, max_side: int) -> Image.Image:
    """features.js drawScaled — 비율을 지키며 긴 변을 max_side 로 줄인다(확대는 안 한다)."""
    w, h = img.size
    scale = min(1.0, max_side / max(w, h))
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8, help="상품당 합성 표본 수")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--conditions", default="")
    # 브라우저 canvas drawImage 는 큰 축소(1000→224)에서 계단이 지는 것으로 알려져 있다.
    # Pillow BILINEAR 은 축소 배율에 맞춰 필터를 넓혀 매끈하게 줄인다 — 즉 서로 다른 그림이 된다.
    # 실측: 계단진 배 사진에서 CNN 은 '감귤 0.46' 이라고 답했다(대표가 배포본에서 본 증상과 같다).
    ap.add_argument("--downscale", choices=["bilinear", "nearest"], default="bilinear",
                    help="nearest = 브라우저 캔버스의 계단 현상을 흉내 낸다")
    args = ap.parse_args()

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    keys = [k.strip() for k in args.conditions.split(",") if k.strip()] or list(CONDITIONS)

    samples = []
    for code, name_ko in PRODUCTS.items():
        path = PRODUCT_IMG / f"{code}.webp"
        if not path.exists():
            print(f"건너뜀(사진 없음): {code}")
            continue
        src = Image.open(path).convert("RGB")
        for key in keys:
            label, fn = CONDITIONS[key]
            for i, variant in enumerate(make_variants(src, args.n)):
                shot = fn(variant)

                small = draw_scaled(shot, ANALYZE_MAX_SIDE)
                rgba = np.dstack([
                    np.asarray(small, dtype=np.uint8),
                    np.full((small.height, small.width, 1), 255, dtype=np.uint8),
                ])
                feat_name = f"feat_{code}_{key}_{i}.bin"
                (out / feat_name).write_bytes(rgba.tobytes())

                filt = Image.NEAREST if args.downscale == "nearest" else Image.BILINEAR
                px = np.asarray(shot.resize((MODEL_SIZE, MODEL_SIZE), filt), dtype=np.uint8)
                px_name = f"px_{code}_{key}_{i}.bin"
                (out / px_name).write_bytes(px.tobytes())

                samples.append({
                    "code": code,
                    "name_ko": name_ko,
                    "in_model": name_ko in MODEL_ITEMS,
                    "condition": key,
                    "label": label,
                    "feat": feat_name,
                    "width": small.width,
                    "height": small.height,
                    "px": px_name,
                })

    manifest = {
        "n_per_product": args.n,
        "downscale": args.downscale,
        "conditions": {k: CONDITIONS[k][0] for k in keys},
        "model_items": sorted(MODEL_ITEMS),
        "samples": samples,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print(f"표본 {len(samples)}장 생성 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
