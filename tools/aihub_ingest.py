"""
AI 허브 149 원천 이미지를 받아 학습용 소형 데이터셋으로 만든다.

**이 스크립트는 반드시 국내(한국) 네트워크에서 실행해야 한다.**
AI 허브는 해외 IP 다운로드를 차단한다 — Colab 에서 돌리면
"AI 허브는 해외에서의 데이터 다운로드를 제한하고 있습니다" 로 실패한다.
그래서 수집은 국내 PC 에서 하고, 결과물(약 1GB)만 Colab 으로 올려 학습한다.

왜 aihubshell 을 쓰지 않는가:
    aihubshell 의 내부 curl 에는 재시도가 없어 전송이 끊기면 **조용히 잘린 파일**을 남긴다.
    실제로 444MB 파일이 13.5MB 로, 라벨 54개가 21개로 잘린 채 "병합 완료"로 끝났다.
    여기서는 --retry 로 받고 tar 크기와 zip 무결성을 직접 검증한다.

디스크: zip 1개씩 처리하고 즉시 지운다. 최고 사용량은 원본 zip 1개 크기(약 4GB)뿐이다.
원본 1000x1000 PNG(832KB) → 224px JPEG(7KB)로 약 0.9% 까지 줄어든다.

사용:
    python tools/aihub_ingest.py --items pear apple --key <APIKEY> --out data/onfarm_cv
    python tools/aihub_ingest.py --items all --key <APIKEY> --out data/onfarm_cv
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

DOWNLOAD_URL = "https://api.aihub.or.kr/down/0.6/149.do"

# docs/aihub149_filetree.txt 에서 뽑은 실제 파일키 (원천 = 이미지, 라벨 = JSON)
FILEKEYS: dict[str, dict[str, list[int]]] = {
    "apple": {
        "label": [396903, 396904, 396905, 396906, 396907, 396908, 397011, 397012, 397013, 397014, 397015, 397016],
        "src": [396957, 396958, 396959, 396960, 396961, 396962, 397065, 397066, 397067, 397068, 397069, 397070]},
    "pear": {
        "label": [396933, 396934, 396935, 396936, 396937, 396938, 397041, 397042, 397043, 397044, 397045, 397046],
        "src": [396987, 396988, 396989, 396990, 396991, 396992, 397095, 397096, 397097, 397098, 397099, 397100]},
    "mandarine": {
        "label": [396921, 396922, 396923, 396924, 396925, 396926, 397023, 397024, 397025, 397032, 397033, 397034],
        "src": [396969, 396970, 396971, 396978, 396979, 396980, 397077, 397078, 397079, 397086, 397087, 397088]},
    "onion": {
        "label": [396927, 396928, 396929, 396930, 396931, 396932, 397035, 397036, 397037, 397038, 397039, 397040],
        "src": [396981, 396982, 396983, 396984, 396985, 396986, 397089, 397090, 397091, 397092, 397093, 397094]},
    "potato": {
        "label": [396948, 396949, 396950, 396951, 396952, 396953, 397056, 397057, 397058, 397059, 397060, 397061],
        "src": [397002, 397003, 397004, 397005, 397006, 397007, 397110, 397111, 397112, 397113, 397114, 397115]},
}

MANIFEST_FIELDS = [
    "split", "path", "group_no", "item", "variety", "grade", "size_class",
    "weight_g", "width_cm", "height_cm", "angle_direction",
    "verticality_angle", "horizontality_angle",
]


def fetch(filekey: int, api_key: str, dest: Path) -> Path:
    """한 파일키를 받아 tar 를 푼 뒤 .part 를 병합해 zip 경로들을 돌려준다."""
    tar_path = dest / f"{filekey}.tar"
    cmd = [
        "curl", "-L", "--retry", "8", "--retry-delay", "3", "--retry-all-errors",
        "--connect-timeout", "30", "-f", "-s", "-S",
        "-o", str(tar_path), "-H", f"apikey:{api_key}",
        f"{DOWNLOAD_URL}?fileSn={filekey}",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"filekey {filekey} 내려받기 실패: {r.stderr.strip()[:300]}")

    head = tar_path.open("rb").read(300)
    if b"\xea\xb0\x80" in head or b"aihub" in head.lower() or tar_path.stat().st_size < 4096:
        raise RuntimeError(
            f"filekey {filekey}: 데이터가 아니라 안내문이 왔다 — "
            f"승인 여부와 **국내 네트워크인지** 확인하라.\n{head[:200]!r}")

    extract_dir = dest / f"x{filekey}"
    extract_dir.mkdir(exist_ok=True)
    with tarfile.open(tar_path) as tf:
        tf.extractall(extract_dir)
    tar_path.unlink()

    # aihubshell 과 동일하게 .partN 을 순서대로 이어 붙인다
    zips: list[Path] = []
    parts: dict[Path, list[Path]] = {}
    for p in extract_dir.rglob("*.part*"):
        base = p.with_suffix("")  # foo.zip.part0 -> foo.zip
        parts.setdefault(base, []).append(p)
    for base, chunk in parts.items():
        chunk.sort(key=lambda x: int(x.suffix.replace(".part", "") or 0))
        with base.open("wb") as out:
            for c in chunk:
                out.write(c.read_bytes())
                c.unlink()
        zips.append(base)
    zips += [p for p in extract_dir.rglob("*.zip") if p not in zips]

    for z in zips:
        try:
            zipfile.ZipFile(z).namelist()
        except zipfile.BadZipFile as e:
            raise RuntimeError(f"{z.name}: zip 이 깨졌다({z.stat().st_size:,}B) — 다시 받아야 한다") from e
    return zips


def load_labels(zips: list[Path]) -> dict[str, dict]:
    """라벨 zip 들에서 {json stem: 라벨} 사전을 만든다."""
    out: dict[str, dict] = {}
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if not n.lower().endswith(".json"):
                    continue
                o = json.loads(zf.read(n).decode("utf-8-sig"))
                out[Path(n).stem] = o
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", nargs="+", default=["pear"],
                    help="pear apple mandarine onion potato | all")
    ap.add_argument("--key", required=True, help="AI 허브 API Key")
    ap.add_argument("--out", type=Path, default=Path("data/onfarm_cv"))
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()

    items = list(FILEKEYS) if "all" in args.items else args.items
    unknown = [i for i in items if i not in FILEKEYS]
    if unknown:
        print(f"모르는 품목: {unknown}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    work = Path(tempfile.mkdtemp(prefix="aihub_"))
    print(f"작업 폴더 {work}\n대상 {items}\n")

    try:
        for item in items:
            print(f"── {item} ──")
            label_map: dict[str, dict] = {}
            for fk in FILEKEYS[item]["label"]:
                label_map |= load_labels(fetch(fk, args.key, work))
                shutil.rmtree(work / f"x{fk}", ignore_errors=True)
            print(f"  라벨 {len(label_map):,}건")

            saved = matched = 0
            for fk in FILEKEYS[item]["src"]:
                zips = fetch(fk, args.key, work)
                for z in zips:
                    split = "train" if "1.Training" in str(z) else "valid"
                    size_class = z.stem.rsplit("_", 1)[-1].upper()
                    with zipfile.ZipFile(z) as zf:
                        for n in zf.namelist():
                            if not n.lower().endswith((".png", ".jpg", ".jpeg")):
                                continue
                            stem = Path(n).stem
                            lab = label_map.get(stem)
                            if lab is None:
                                continue
                            matched += 1
                            dst = args.out / split / lab["cate1"] / lab["cate3"] / f"{stem}.jpg"
                            dst.parent.mkdir(parents=True, exist_ok=True)
                            if not dst.exists():
                                im = Image.open(io.BytesIO(zf.read(n))).convert("RGB")
                                im.resize((args.size, args.size), Image.BILINEAR).save(
                                    dst, "JPEG", quality=args.quality)
                                saved += 1
                            rows.append({
                                "split": split, "path": str(dst.relative_to(args.out)).replace("\\", "/"),
                                "group_no": lab["group_no"], "item": lab["cate1"],
                                "variety": lab["cate2"], "grade": lab["cate3"],
                                "size_class": size_class, "weight_g": lab.get("weight"),
                                "width_cm": lab.get("width"), "height_cm": lab.get("height"),
                                "angle_direction": lab.get("angle_direction"),
                                "verticality_angle": lab.get("verticality_angle"),
                                "horizontality_angle": lab.get("horizontality_angle"),
                            })
                shutil.rmtree(work / f"x{fk}", ignore_errors=True)
                free = shutil.disk_usage(args.out.anchor or "/")[2] / 2**30
                print(f"  {fk}: 누적 {saved:,}장 | 디스크 여유 {free:.0f}GB")
            print(f"  → {item} 완료: 라벨매칭 {matched:,} / 저장 {saved:,}\n")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    manifest = args.out / "manifest.csv"
    with manifest.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=MANIFEST_FIELDS)
        w.writeheader()
        w.writerows(rows)

    # 개체 누출 확인 — 학습 전에 여기서 걸러야 한다
    groups = {"train": set(), "valid": set()}
    for r in rows:
        groups[r["split"]].add(r["group_no"])
    overlap = groups["train"] & groups["valid"]
    total_mb = sum(f.stat().st_size for f in args.out.rglob("*.jpg")) / 2**20

    print(f"매니페스트 {manifest}  ({len(rows):,}행)")
    print(f"이미지 {len(list(args.out.rglob('*.jpg'))):,}장, {total_mb:,.0f} MB")
    print(f"train 개체 {len(groups['train']):,} / valid 개체 {len(groups['valid']):,}")
    if overlap:
        print(f"⚠️ 양쪽에 걸친 개체 {len(overlap)}개 — 학습 시 valid 에서 제외할 것: {sorted(overlap)[:5]}")
    else:
        print("✅ 개체 누출 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
