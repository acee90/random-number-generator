"""Build the browser's spatial index from the Ministry of the Interior and Safety CSV.

Install pyproj (python3 -m pip install pyproj), then run this script to refresh
public/nearby-restaurants. Pass --csv PATH to use a previously downloaded file.
"""

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import unicodedata
from collections import defaultdict
from contextlib import ExitStack
from io import TextIOWrapper
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen

from pyproj import Transformer


CATALOG = "https://file.localdata.go.kr/file/general_restaurants/info"
DOWNLOAD = "https://file.localdata.go.kr/file/download/general_restaurants/info"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public" / "nearby-restaurants"
CELLS_PER_DEGREE = 20
ALIASES = {"경양식": "양식", "중국식": "중식", "까페": "카페", "외국음식전문점(인도,태국등)": "세계음식"}


def clean(value):
    return " ".join(unicodedata.normalize("NFC", value).split()).strip()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def publish(path, contents):
    with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(contents)
    pending = Path(temporary.name)
    pending.chmod(0o644)
    pending.replace(path)


def prepare(source, destination):
    reader = csv.DictReader(source)
    required = {"사업장명", "업태구분명", "영업상태명", "관리번호", "개방자치단체코드", "폐업일자",
                "좌표정보(X)", "좌표정보(Y)", "데이터갱신시점", "도로명주소", "지번주소"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("일반음식점 CSV 열을 확인해 주세요.")
    project = Transformer.from_crs(5174, 4326, always_xy=True)
    packs = defaultdict(lambda: defaultdict(list))
    seen = set()
    latest = ""
    missing = 0
    for row in reader:
        latest = max(latest, row["데이터갱신시점"][:10])
        if row["영업상태명"] != "영업/정상" or row["폐업일자"].strip():
            continue
        try:
            lng, lat = project.transform(float(row["좌표정보(X)"]), float(row["좌표정보(Y)"]))
        except (ValueError, TypeError):
            missing += 1
            continue
        if not (32 < lat < 40 and 124 < lng < 133):
            missing += 1
            continue
        name, org, identifier = (clean(row[field]) for field in ("사업장명", "개방자치단체코드", "관리번호"))
        if not (name and org and identifier):
            continue
        if not identifier.startswith(org + "-"):
            identifier = org + "-" + identifier
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,72}", identifier):
            identifier = hashlib.sha256(identifier.encode()).hexdigest()[:32]
        if identifier in seen:
            continue
        seen.add(identifier)
        category = clean(row["업태구분명"]) or "미분류"
        address = clean(row["도로명주소"]) or clean(row["지번주소"])
        # Use the same rounded coordinate to assign and later query the cell.
        lat, lng = round(lat, 6), round(lng, 6)
        pack = f"{math.floor(lat)}-{math.floor(lng)}"
        cell = f"{math.floor(lat * CELLS_PER_DEGREE)}-{math.floor(lng * CELLS_PER_DEGREE)}"
        packs[pack][cell].append([identifier, name, ALIASES.get(category, category), lat, lng, address])

    if not seen or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", latest):
        raise ValueError("영업 중인 음식점과 자료 갱신일이 필요합니다.")
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {"asOf": latest, "cellsPerDegree": CELLS_PER_DEGREE, "packs": {}}
    for pack, cells in sorted(packs.items()):
        contents = bytearray()
        offsets = {}
        for cell, rows in sorted(cells.items()):
            compressed = gzip.compress(json_bytes(sorted(rows)), compresslevel=6, mtime=0)
            offsets[cell] = [len(contents), len(compressed)]
            contents.extend(compressed)
        digest = hashlib.sha256(contents).hexdigest()[:16]
        filename = f"{pack}-{digest}.bin"
        if not (destination / filename).exists():
            publish(destination / filename, contents)
        manifest["packs"][pack] = {"file": filename, "cells": offsets}
    # Publish the index last so readers never address partially written files.
    publish(destination / "index.json", json_bytes(manifest))
    print(f"{latest} 기준 {len(seen):,}곳, 좌표 누락·오류 {missing:,}건 제외, {len(packs)}개 지역 파일")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    with ExitStack() as stack:
        if args.csv:
            raw = stack.enter_context(args.csv.open("rb"))
        else:
            raw = stack.enter_context(urlopen(Request(DOWNLOAD, headers={"Referer": CATALOG}), timeout=180))
        source = stack.enter_context(TextIOWrapper(raw, encoding="cp949", errors="replace", newline=""))
        prepare(source, args.output)
