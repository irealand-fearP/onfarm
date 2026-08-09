"""
수집 결과를 Colab 업로드용 zip 으로 묶는다.

묶기 전에 학습에 치명적인 것들을 먼저 확인한다. 업로드하고 Colab 에서 돌린 뒤에
문제를 발견하면 왕복 비용이 크기 때문이다.

  1. 매니페스트에 적힌 이미지가 실제로 있는가 (수집이 중간에 죽었을 수 있다)
  2. 개체(group_no) 가 train/valid 양쪽에 걸쳐 있지 않은가
  3. 품목이 2종 이상인가 (1종이면 품목 분류가 성립하지 않는다)
  4. 등급이 3종 다 있는가

사용:
    python tools/pack_for_colab.py --data data/onfarm_cv --out data/onfarm_cv.zip
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import sys
import zipfile
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("data/onfarm_cv"))
    ap.add_argument("--out", type=Path, default=Path("data/onfarm_cv.zip"))
    ap.add_argument("--force", action="store_true", help="경고가 있어도 묶는다")
    args = ap.parse_args()

    manifest = args.data / "manifest.csv"
    if not manifest.exists():
        print(f"매니페스트가 없다: {manifest}", file=sys.stderr)
        return 1

    rows = list(csv.DictReader(manifest.open(encoding="utf-8")))
    print(f"매니페스트 {len(rows):,}행")

    problems: list[str] = []

    # 1. 실제 파일 존재
    missing = [r for r in rows if not (args.data / r["path"]).exists()]
    if missing:
        problems.append(f"매니페스트에 있는데 파일이 없는 이미지 {len(missing):,}장 (예: {missing[0]['path']})")

    # 2. 개체 누출
    groups: dict[str, set[str]] = collections.defaultdict(set)
    for r in rows:
        groups[r["split"]].add(r["group_no"])
    overlap = groups.get("train", set()) & groups.get("valid", set())
    if overlap:
        # 치명적이지 않다. 학습 노트북이 valid 에서 제외한다.
        print(f"ℹ️ train/valid 에 걸친 개체 {len(overlap)}개 — 노트북이 valid 에서 제외한다")

    # 3~4. 클래스 구성
    items = collections.Counter(r["item"] for r in rows)
    grades = collections.Counter(r["grade"] for r in rows)
    splits = collections.Counter(r["split"] for r in rows)
    print(f"split {dict(splits)}")
    print(f"품목 {dict(items)}")
    print(f"등급 {dict(grades)}")
    if len(items) < 2:
        problems.append(f"품목이 {len(items)}종뿐 — 품목 분류가 성립하지 않는다(등급만 학습 가능)")
    if len(grades) < 3:
        problems.append(f"등급이 {sorted(grades)}뿐 — 3종이 다 있어야 한다")
    if splits.get("valid", 0) == 0:
        problems.append("검증셋이 없다 — Validation 원천을 아직 안 받았다")

    print(f"train 개체 {len(groups.get('train', set())):,} / valid 개체 {len(groups.get('valid', set())):,}")

    if problems:
        print("\n## 문제")
        for p in problems:
            print(f"  ! {p}")
        if not args.force:
            print("\n수집을 마저 끝낸 뒤 다시 실행하세요 (--force 로 무시 가능)")
            return 2

    jpgs = sorted(args.data.rglob("*.jpg"))
    total_mb = sum(p.stat().st_size for p in jpgs) / 2**20
    print(f"\n이미지 {len(jpgs):,}장, {total_mb:,.0f} MB → 묶는 중…")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # JPEG 는 이미 압축돼 있어 다시 압축해도 이득이 없다. 저장 모드가 훨씬 빠르다.
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_STORED) as zf:
        zf.write(manifest, "onfarm_cv/manifest.csv")
        for i, p in enumerate(jpgs, 1):
            zf.write(p, f"onfarm_cv/{p.relative_to(args.data).as_posix()}")
            if i % 20000 == 0:
                print(f"  {i:,}/{len(jpgs):,}")

    size_mb = args.out.stat().st_size / 2**20
    print(f"\n완료: {args.out}  ({size_mb:,.0f} MB)")
    print("→ Google Drive 의 MyDrive 최상위에 'onfarm_cv.zip' 이름으로 올린 뒤")
    print("  notebooks/onfarm_train_colab.ipynb 를 처음부터 실행하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
