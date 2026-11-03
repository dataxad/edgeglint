#!/usr/bin/env python3
"""Build the "edgeglint one-pagers" canvas manifest for ~/.claude/bin/artifact-keeper (undermine #794; edgeglint #38).

  python3 scripts/canvas_artifact.py      # the build command in docs/artifacts.json

Each docs/one-page/*.svg is one artboard. The sheet is rendered with scripts/one_page_check.py --render (2x PNG,
byte-stable on one machine) and the artboard shows that PNG. The canvas (a Design-type artifact) serves only text
support files under project/, so the PNG is an upload: the artboard source names it "$upload:<path>" and the runner
fills in the /_blob url, a cached one when the same PNG was uploaded before (`edits` is refused in a session with a
file-edit hook, so the url cannot be patched in at publish time). An artboard is published when
its sheet or file changed since the last confirmed keeper build, and all of them once a week; otherwise the manifest
holds one read of project/canvas.json. A new sheet without an artboard is an `upgrade:` fact: add it to SHEETS in the
same PR.

This script also owns project/canvas.json, the canvas index (undermine #820). canvas_index() computes it from SHEETS: boards in a
grid by each sheet's size, an `order` slot per sheet, the title note. A new sheet therefore gets its board with its
artboard, and nobody edits the index by hand. The index is published only when its digest differs from the last build
that the runner's `done` stamp confirmed; the weekly full republish leaves it alone, because a publish replaces the whole
file and would undo a board moved on the canvas.

The Artifact tool refuses a publish that touches a path it has not read by that path in the same session, and a bare
read (url only) does not count (undermine #841). The runner puts a bare read before a page publish itself; publish_calls() adds one
read with `paths` for every file of the publish that is already on the canvas, right before the publish. A new file needs
no read. What is already on the canvas is what the last confirmed build published (the ledger); with no confirmed build the
state is unknown and every path is read, because a path that is not there only reports itself as unread. No call depends
on the result of an earlier one.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import artifact_manifest as am

REGISTRY = json.loads((am.ROOT / "docs/artifacts.json").read_text())["artifacts"]
URL = next(a["url"] for a in REGISTRY if a["id"] == "canvas")  # one source for the url: the keeper checks calls against it
OUT = am.ROOT / ".artifacts" / "canvas"
FULL_AFTER_H = 24 * 7
# Sheet stem -> (artboard file, page title, image alt text). The artboard files and their frames are on the canvas.
# A new sheet is added here only; canvas_index() gives it a board and an order slot.
SHEETS = {
    "privacy-solution": ("Main.dc.html", "Privacy solution",
                         "Privacy solution one-page design: what the tracker reads and never reads, the script gate, the seven "
                         "collect gates where a beacon dies, the row that is written, the levels and the bot-defence layer. "
                         "Source docs/one-page/privacy-solution.svg."),
}
# Frame label on the canvas, when it is longer than the page title. A sheet without an entry shows its page title.
BOARD_TITLES = {
    "privacy-solution": "Privacy solution: a beacon dies at the first gate it fails",
}
INDEX = "canvas.json"
GAP_X, GAP_Y, COLUMNS = 80, 120, 2  # px between frames in a row, px between rows, frames per row
# The canvas was created on 2026-11-03 (version 1793729703-f403); the index carries that time as it is.
CREATED_ON_FILES = {"v": 1, "at": "2026-11-03T18:15:03Z"}
TITLE_NOTE = {"x": 0, "y": -300, "text": "edgeglint: one-page designs", "kind": "title1"}


def artboard(title, alt, w, h, src):
    """The artboard source, as the canvas holds it today; `src` is the PNG url."""
    alt = alt.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{{margin:0}}
</style>
</helmet>
<div style="width: {w}px; height: {h}px; background: #ffffff">
<img src="{src}" alt="{alt}" style="display: block; width: {w}px; height: {h}px">
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
"""


def size(svg):
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', re.search(r"<svg\b[^>]*>", svg.read_text()).group(0))
    return int(m.group(1)), int(m.group(2))


def canvas_index(sheets, svg_dir):
    """The canvas's project/canvas.json for `sheets` (the SHEETS shape), sized from svg_dir/<stem>.svg.

    Frames fill rows of COLUMNS, GAP_X apart; a row is as tall as its tallest frame and GAP_Y above the next one. A sheet whose svg
    is gone or has no viewBox gets no board; main() reports it.
    """
    frames = []
    for stem, (name, title, _) in sheets.items():
        try:
            frames.append((name, BOARD_TITLES.get(stem, title), *size(svg_dir / (stem + ".svg"))))
        except (OSError, AttributeError):
            continue
    boards, y, widest = {}, 0, 0
    for i in range(0, len(frames), COLUMNS):
        x = 0
        for name, title, w, h in frames[i:i + COLUMNS]:
            boards[name] = {"x": x, "y": y, "w": w, "h": h, "title": title}
            x += w + GAP_X
        widest = max(widest, x - GAP_X)
        y += max(h for _, _, _, h in frames[i:i + COLUMNS]) + GAP_Y
    return {"v": 3, "createdOnFiles": CREATED_ON_FILES, "title": "edgeglint one-pagers", "launch": {"view": "canvas"},
            "pages": [], "boards": boards, "order": [name for name, *_ in frames],
            "notes": {"title": {**TITLE_NOTE, "maxW": widest}}, "designSystems": []}


def publish_calls(publish, existing=None):
    """The manifest calls for `publish`, the canvas paths (project/<file>) to publish; none: one read of project/canvas.json.

    `existing` is the set of those paths that are already on the canvas, or None when that is unknown. Each existing path
    is read by its path in one call right before the publish (#841); a new path is not. An unknown state reads all of them.
    """
    if not publish:
        return [{"tool": "Artifact", "input": {"action": "read", "url": URL, "path": f"project/{INDEX}"}}]
    read = [p for p in publish if existing is None or p in existing]
    calls = [{"tool": "Artifact", "input": {"action": "read", "url": URL, "paths": read}}] if read else []
    return calls + [{"tool": "Artifact", "input": {
        "action": "publish", "url": URL, "root": ".artifacts/canvas", "file_path": f".artifacts/canvas/{publish[0]}",
        "files": {p: p for p in publish[1:]}}}]


def main():
    sheets = sorted((am.ROOT / "docs/one-page").glob("*.svg"))
    png_dir = OUT / "png"
    for old in png_dir.glob("*.png"):
        old.unlink()  # a PNG left by an earlier local run must not stand in for a sheet that fails the check now
    check = subprocess.run([sys.executable, str(am.ROOT / "scripts/one_page_check.py"), "--render", str(png_dir),
                            *map(str, sheets)], capture_output=True, text=True, cwd=am.ROOT)
    failed = sorted({line.split(":", 1)[0] for line in check.stdout.splitlines() if ": rendered " not in line})
    ledger = am.Ledger("canvas", FULL_AFTER_H)
    facts, built, changed = [], {}, []
    for svg in sheets:
        rel = svg.relative_to(am.ROOT).as_posix()
        if svg.stem not in SHEETS:
            facts.append(f"upgrade: {rel} has no artboard; add it to SHEETS in scripts/canvas_artifact.py")
            continue
        png = png_dir / (svg.stem + ".png")
        if str(svg) in failed or not png.exists():
            facts.append(f"red: {rel} fails scripts/one_page_check.py; its artboard keeps the last published image")
            continue
        name, title, alt = SHEETS[svg.stem]
        text = artboard(title, alt, *size(svg), f"$upload:.artifacts/canvas/png/{svg.stem}.png")
        (OUT / "project").mkdir(parents=True, exist_ok=True)
        (OUT / "project" / name).write_text(text)
        built[name] = am.digest(png.read_bytes() + text.encode())
        if ledger.changed(name, built[name]):
            changed.append((name, svg.stem))
    for stem, (name, _, _) in SHEETS.items():
        if not (am.ROOT / "docs/one-page" / (stem + ".svg")).exists():
            facts.append(f"upgrade: SHEETS names docs/one-page/{stem}.svg, which is gone; remove its artboard {name}")
    idx = canvas_index(SHEETS, am.ROOT / "docs/one-page")
    index = json.dumps(idx, indent=1) + "\n"
    (OUT / "project").mkdir(parents=True, exist_ok=True)
    (OUT / "project" / INDEX).write_text(index)
    built[INDEX] = am.digest(index)
    index_changed = ledger.published.get(INDEX) != built[INDEX]  # not ledger.changed: no weekly rewrite of the owner's layout
    publish = [f"project/{name}" for name, _ in changed] + ([f"project/{INDEX}"] if index_changed else [])
    existing = {f"project/{name}" for name in ledger.published} if ledger.published else None
    calls = publish_calls(publish, existing)
    facts += [f"changed: {stem} -> project/{name}" for name, stem in changed]
    read = next((c["input"]["paths"] for c in calls if "paths" in c["input"]), [])
    if read:
        facts.append(f"read before the publish: {', '.join(read)}")
    if index_changed:
        facts.append(f"changed: canvas index -> project/{INDEX} ({len(idx['boards'])} boards)")
    if ledger.full and ledger.published_at:
        facts.append(f"weekly republish: last full publish {am.utc(ledger.full_at)}" if ledger.full_at else "first full publish")
    summary = am.summary_text([
        f"Canvas: {len(sheets)} sheets",
        f"{len(changed)} artboard(s) to publish ({', '.join(s for _, s in changed)})" if changed else "no artboard changed",
        "canvas index to publish" if index_changed else "",
        f"{sum(f.startswith('upgrade:') for f in facts)} upgrade line(s)",
        f"{sum(f.startswith('red:') for f in facts)} sheet(s) failing the check",
        f"since {am.utc(ledger.published_at)}" if ledger.published_at else "no build confirmed by done yet"])
    out = am.write("canvas", URL, calls, summary, facts)
    ledger.save(built, {"sheets": sorted(built)})
    print(f"wrote {out}: {len(calls)} call(s); {summary}")


if __name__ == "__main__":
    main()
