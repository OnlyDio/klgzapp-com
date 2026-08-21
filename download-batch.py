#!/usr/bin/env python3
"""klgzapp batch downloader.

Usage:
  python3 download-batch.py urls.txt [outdir]
  python3 download-batch.py --stdin [outdir]

URL 列表每行一条。粘连地址（https://ahttps://b）会取最后一段。
已存在的非空文件会跳过。
"""

from __future__ import annotations

import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

UA = "klgzapp-batch-dl/1.0"
WORKERS = 8
TIMEOUT = 180
RETRIES = 3


def normalize_url(raw: str) -> str:
    text = raw.strip()
    if not text or text.startswith("#"):
        return ""
    idx = text.rfind("https://")
    if idx > 0:
        text = text[idx:]
    if text.startswith("/") and not text.startswith("//"):
        text = "https://cdn.novagirl.app" + text
    return text


def load_urls(source: str) -> list[str]:
    if source == "--stdin":
        lines = sys.stdin.read().splitlines()
    else:
        lines = Path(source).read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    urls: list[str] = []
    for line in lines:
        url = normalize_url(line)
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def dest_for(out: Path, url: str) -> Path:
    name = Path(url.split("?", 1)[0]).name or "file.bin"
    return out / name


def download_one(url: str, dest: Path) -> tuple[str, str]:
    if dest.exists() and dest.stat().st_size > 0:
        return ("exists", dest.name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err = ""
    for attempt in range(1, RETRIES + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp, open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
            if tmp.stat().st_size <= 0:
                raise OSError("empty file")
            tmp.replace(dest)
            return ("ok", dest.name)
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            if attempt < RETRIES:
                time.sleep(attempt)
    return ("err", f"{dest.name} <- {url} :: {last_err}")


def main() -> None:
    if len(sys.argv) < 2:
        print("用法: python3 download-batch.py urls.txt [outdir]", file=sys.stderr)
        sys.exit(2)
    source = sys.argv[1]
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("downloads")
    urls = load_urls(source)
    if not urls:
        raise SystemExit("没有有效 URL")
    out.mkdir(parents=True, exist_ok=True)
    jobs = [(url, dest_for(out, url)) for url in urls]
    print(f"queued: {len(jobs)} -> {out.resolve()}", flush=True)
    stats = {"ok": 0, "exists": 0, "err": 0}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(download_one, url, dest) for url, dest in jobs]
        for i, fut in enumerate(as_completed(futs), 1):
            status, detail = fut.result()
            stats[status] = stats.get(status, 0) + 1
            if status == "err":
                print(f"ERR {detail}", flush=True)
            if i % 20 == 0 or i == len(futs):
                print(f"progress {i}/{len(futs)} {stats}", flush=True)
    print("DONE", stats, flush=True)
    if stats["err"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
