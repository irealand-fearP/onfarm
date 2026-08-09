"""
AI 허브 「농산물 품질(QC) 이미지」(datasetkey 149) 라벨을 읽어 매니페스트와 무결성 리포트를 만든다.

왜 필요한가: 이 데이터는 제품 1개를 여러 각도로 여러 장 찍는다. 이미지 단위로 학습/검증을
나누면 같은 실물이 양쪽에 들어가 정확도가 부풀려진다(한바구니에서 98.22% -> 실측 61.4%).
그래서 이 스크립트는 개체 식별자(group_no) 기준으로 통계를 내고, 공식 Train/Validation 분할이
실제로 개체를 분리했는지 먼저 검증한다.

사용법:
    python tools/aihub_manifest.py <라벨 루트> [-o out_dir]

라벨 루트는 '1.Training' / '2.Validation' 을 포함하는 폴더(zip 을 풀지 않아도 된다).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

# ON-FARM 카탈로그와 겹치는 품목만 학습 대상으로 삼는다(카탈로그에 없는 라벨은 죽은 라벨이 된다).
ONFARM_ITEMS = {"사과", "배", "감귤", "양파", "감자"}

FIELDS = [
    "split", "zip_name", "json_name", "group_no", "no", "img_no",
    "item", "variety", "grade", "size_class",
    "width_cm", "height_cm", "weight_g",
    "identifier", "img_width", "img_height",
    "angle_direction", "verticality_angle", "horizontality_angle", "date",
]


def iter_labels(root: Path):
    """라벨 zip 안의 JSON 을 풀지 않고 순회한다."""
    for split_dir, split in ((root / "1.Training", "train"), (root / "2.Validation", "valid")):
        if not split_dir.exists():
            continue
        for zip_path in sorted(split_dir.rglob("*.zip")):
            size_class = zip_path.stem.rsplit("_", 1)[-1].upper()
            try:
                zf = zipfile.ZipFile(zip_path)
            except zipfile.BadZipFile:
                print(f"  ! 열 수 없는 zip: {zip_path.name}", file=sys.stderr)
                continue
            with zf:
                for name in zf.namelist():
                    if not name.lower().endswith(".json"):
                        continue
                    try:
                        obj = json.loads(zf.read(name).decode("utf-8-sig"))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        print(f"  ! 깨진 JSON: {zip_path.name}/{name}", file=sys.stderr)
                        continue
                    yield split, zip_path.name, name, size_class, obj


def to_row(split, zip_name, json_name, size_class, obj) -> dict:
    return {
        "split": split,
        "zip_name": zip_name,
        "json_name": json_name,
        "group_no": obj.get("group_no"),
        "no": obj.get("no"),
        "img_no": obj.get("img_no"),
        "item": obj.get("cate1"),
        "variety": obj.get("cate2"),
        "grade": obj.get("cate3"),
        "size_class": size_class,
        "width_cm": obj.get("width"),
        "height_cm": obj.get("height"),
        "weight_g": obj.get("weight"),
        "identifier": obj.get("identifier"),
        "img_width": obj.get("img_width"),
        "img_height": obj.get("img_height"),
        "angle_direction": obj.get("angle_direction"),
        "verticality_angle": obj.get("verticality_angle"),
        "horizontality_angle": obj.get("horizontality_angle"),
        "date": obj.get("date"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("data/aihub149_report"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for split, zip_name, json_name, size_class, obj in iter_labels(args.root):
        rows.append(to_row(split, zip_name, json_name, size_class, obj))
        if len(rows) % 50000 == 0:
            print(f"  ...{len(rows):,}건 읽음", flush=True)

    if not rows:
        print("라벨을 찾지 못했습니다. 경로를 확인하세요.", file=sys.stderr)
        return 1

    manifest = args.out / "manifest.csv"
    with manifest.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    report: list[str] = []
    def say(line: str = "") -> None:
        report.append(line)
        print(line)

    say(f"# AI허브 149 라벨 매니페스트")
    say()
    say(f"총 라벨 {len(rows):,}건  (train {sum(r['split']=='train' for r in rows):,} / "
        f"valid {sum(r['split']=='valid' for r in rows):,})")
    say(f"매니페스트: {manifest}")
    say()

    # ── 1. 누출 검증: 공식 분할이 개체를 나눴는가 ─────────────────────
    groups = {"train": set(), "valid": set()}
    for r in rows:
        groups[r["split"]].add(r["group_no"])
    overlap = groups["train"] & groups["valid"]
    say("## 1. 개체(group_no) 누출 검증")
    say(f"train 개체 {len(groups['train']):,} / valid 개체 {len(groups['valid']):,}")
    say(f"**양쪽에 모두 나타나는 개체: {len(overlap):,}개**")
    if overlap:
        say("→ 공식 분할이 같은 실물을 양쪽에 넣었다. 그대로 쓰면 정확도가 부풀려진다.")
        say(f"   예시 group_no: {sorted(overlap)[:5]}")
    else:
        say("→ 공식 분할은 개체를 분리했다. 재분할 없이 그대로 써도 된다.")
    say()

    # ── 2. 개체당 이미지 수 ────────────────────────────────────────
    per_group = Counter(r["group_no"] for r in rows)
    dist = Counter(per_group.values())
    say("## 2. 개체당 이미지 수 (근접중복 규모)")
    for n, c in sorted(dist.items()):
        say(f"  {n:3}장짜리 개체 {c:,}개")
    say()

    # ── 3. 품목 x 등급 분포 ────────────────────────────────────────
    say("## 3. 품목 x 등급 (이미지 수 / 개체 수)")
    table = defaultdict(lambda: defaultdict(set))
    counts = defaultdict(Counter)
    for r in rows:
        table[r["item"]][r["grade"]].add(r["group_no"])
        counts[r["item"]][r["grade"]] += 1
    grades = sorted({r["grade"] for r in rows})
    say(f"  {'품목':<8}" + "".join(f"{g:>18}" for g in grades) + f"{'ON-FARM':>10}")
    for item in sorted(table):
        line = f"  {item:<8}"
        for g in grades:
            line += f"{counts[item][g]:>10,}/{len(table[item][g]):<7,}"
        line += f"{'O' if item in ONFARM_ITEMS else '-':>10}"
        say(line)
    say()

    # ── 4. 촬영 각도 ──────────────────────────────────────────────
    say("## 4. 촬영 구성")
    say(f"  방향: {dict(Counter(r['angle_direction'] for r in rows))}")
    say(f"  수직각: {dict(Counter(r['verticality_angle'] for r in rows))}")
    say(f"  수평각: {dict(Counter(r['horizontality_angle'] for r in rows))}")
    say(f"  해상도: {dict(Counter((r['img_width'], r['img_height']) for r in rows))}")
    say()

    # ── 5. ON-FARM 학습 대상 요약 ──────────────────────────────────
    say("## 5. ON-FARM 학습 대상 (겹치는 5품목)")
    sel = [r for r in rows if r["item"] in ONFARM_ITEMS]
    sel_groups = {r["group_no"] for r in sel}
    say(f"  이미지 {len(sel):,}건 / 개체 {len(sel_groups):,}개")
    say(f"  품종: {sorted({(r['item'], r['variety']) for r in sel})}")

    (args.out / "report.md").write_text("\n".join(report), encoding="utf-8")
    print(f"\n리포트: {args.out / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
