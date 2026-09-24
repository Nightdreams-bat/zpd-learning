#!/usr/bin/env python3
"""Ingest a source (YouTube video / PDF / local text) into a clean markdown file
the `teach` skill can read.

Usage:
    python ingest.py <source> <output.md>

<source> may be:
    - a YouTube URL          -> transcript with [mm:ss] markers
    - a path to a .pdf       -> text with [p.N] page markers
    - a path to a text file  -> copied through

Stdlib only. Requires yt-dlp on PATH (or at the default Windows location) for
YouTube, and pdftotext for PDFs.
"""

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

YT_DLP_CANDIDATES = [
    "yt-dlp",
    str(Path.home() / "AppData/Local/Programs/Python/Python312/Scripts/yt-dlp.exe"),
]
PDFTOTEXT_CANDIDATES = [
    "pdftotext",
    r"C:\Program Files\Git\mingw64\bin\pdftotext.exe",
]


def which(candidates):
    from shutil import which as _which

    for c in candidates:
        if os.path.sep in c or (len(c) > 1 and c[1] == ":"):
            if Path(c).exists():
                return c
        elif _which(c):
            return c
    return None


# ---------------------------------------------------------------- YouTube


def parse_vtt(raw):
    """VTT -> [(seconds, line)], with YouTube's rolling-caption repeats removed."""
    out = []
    recent = []
    for block in re.split(r"\n\s*\n", raw):
        lines = [l.strip() for l in block.strip().splitlines() if l.strip()]
        if not lines:
            continue
        ts_line = next((l for l in lines if "-->" in l), None)
        if not ts_line:
            continue
        m = re.match(r"(\d+):(\d+):([\d.]+)", ts_line)
        if not m:
            continue
        secs = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

        for line in lines[lines.index(ts_line) + 1:]:
            text = re.sub(r"<[^>]+>", "", line)          # <c>, <00:00:01.000>
            text = re.sub(r"\s+", " ", text).strip()
            text = text.replace("&nbsp;", " ").replace("&amp;", "&")
            if not text or text in recent:
                continue
            out.append((secs, text))
            recent.append(text)
            recent = recent[-4:]
    return out


def from_youtube(url, marker_every=30):
    yt = which(YT_DLP_CANDIDATES)
    if not yt:
        sys.exit("yt-dlp not found. Install it: pip install -U yt-dlp")

    with tempfile.TemporaryDirectory() as tmp:
        title = subprocess.run(
            [yt, "--skip-download", "--print", "%(title)s|%(uploader)s|%(duration_string)s", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        ).stdout.strip().splitlines()
        meta = (title[-1] if title else "|" * 2).split("|")
        meta += [""] * (3 - len(meta))

        subprocess.run(
            [yt, "--skip-download", "--write-subs", "--write-auto-subs",
             "--sub-langs", "en.*,ro.*", "--sub-format", "vtt", "--no-warnings",
             "-o", str(Path(tmp) / "sub.%(ext)s"), url],
            capture_output=True, text=True,
        )
        vtts = sorted(Path(tmp).glob("*.vtt"))
        if not vtts:
            sys.exit("No subtitles available for this video. "
                     "Try a video with captions, or transcribe the audio separately.")
        # prefer a manual (non -orig / non auto) track when both exist
        vtt = min(vtts, key=lambda p: ("orig" in p.name, len(p.name)))
        cues = parse_vtt(vtt.read_text(encoding="utf-8", errors="replace"))

    body, next_marker = [], 0
    for secs, text in cues:
        if secs >= next_marker:
            body.append(f"\n\n**[{int(secs)//60:02d}:{int(secs)%60:02d}]** ")
            next_marker = (int(secs) // marker_every + 1) * marker_every
        body.append(text + " ")

    header = (f"---\nsource_type: youtube\nurl: {url}\ntitle: {meta[0]}\n"
              f"channel: {meta[1]}\nduration: {meta[2]}\n---\n\n# {meta[0]}\n")
    return header + "".join(body).strip() + "\n"


# -------------------------------------------------------------------- PDF


def from_pdf(path):
    tool = which(PDFTOTEXT_CANDIDATES)
    if not tool:
        sys.exit("pdftotext not found. It ships with Git for Windows or poppler-utils.")
    res = subprocess.run([tool, "-layout", "-enc", "UTF-8", str(path), "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        sys.exit(f"pdftotext failed: {res.stderr.strip()}")

    pages = res.stdout.split("\f")
    body, kept = [], 0
    for i, page in enumerate(pages, 1):
        page = re.sub(r"\n{3,}", "\n\n", page.strip())
        if page:
            kept += 1
            body.append(f"\n\n**[p.{i}]**\n\n{page}")

    header = (f"---\nsource_type: pdf\nfile: {Path(path).name}\n"
              f"pages: {kept}\n---\n\n# {Path(path).stem}\n")
    return header + "".join(body).strip() + "\n"


# ------------------------------------------------------------------- text


def from_text(path):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    header = f"---\nsource_type: text\nfile: {Path(path).name}\n---\n\n"
    return header + text


# ------------------------------------------------------------------- main


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, out_path = sys.argv[1], Path(sys.argv[2])

    if re.match(r"https?://", source):
        if re.search(r"(youtube\.com|youtu\.be)", source):
            content = from_youtube(source)
        else:
            sys.exit("For non-YouTube URLs, use WebFetch instead of this script.")
    elif source.lower().endswith(".pdf"):
        content = from_pdf(source)
    else:
        content = from_text(source)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    words = len(content.split())
    print(f"OK  {out_path}  ({words:,} words, ~{words // 750 + 1} min read)")


if __name__ == "__main__":
    main()
