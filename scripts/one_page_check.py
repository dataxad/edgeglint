#!/usr/bin/env python3
"""Check the one-page design sheets in docs/one-page/*.svg before they are published (undermine #778; edgeglint #38).

  python3 scripts/one_page_check.py [--render DIR] docs/one-page/*.svg

Fails loud (exit 1) when a sheet is not well-formed XML, has no viewBox, or has a <text> whose
estimated width runs off the sheet or out of the <rect> drawn on the same source line (the
header-box pattern), or a <text>/<tspan> with a fill= attribute (the sheet's text{fill} rule beats it, so the
label keeps the CSS colour: edgeglint #40, 2026-10-29; write style="fill:…"). Width is estimated at 0.5 em per character, so a flag near an edge deserves a
render and a look, not a blind rewrite; a pass does not replace the look.
--render DIR writes a 2x PNG of each sheet for visual-critic.sh. macOS qlmanage renders a square,
so the copy it renders is padded to a square viewBox and the PNG is cropped back (2026-10-29 lesson).
"""
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

EM = 0.5  # ponytail: a constant, not a font engine; Avenir Next measures 0.46 to 0.51 em per character
TOL = 3  # px a box label may overrun by estimate: 0.5 em overshoots Avenir Next by up to 8% (three slot labels of the
          # privacy sheet, verified in the render, estimated 1 px over their 118 px boxes); a real overflow is wider.


def styles(svg_text):
    """{class: (font_size or None, anchor or None)} from the sheet's <style>, plus the base text size."""
    base = 15.0
    m = re.search(r"\btext\{[^}]*font-size:(\d+(?:\.\d+)?)px", svg_text)
    if m:
        base = float(m.group(1))
    table = {}
    for cls, body in re.findall(r"\.([A-Za-z]\w*)\{([^}]*)\}", svg_text):
        size = re.search(r"font-size:(\d+(?:\.\d+)?)px", body)
        anchor = re.search(r"text-anchor:(middle|end)", body)
        table[cls] = (float(size.group(1)) if size else None, anchor.group(1) if anchor else None)
    return base, table


def span(el, base, table):
    """(x0, x1) of a <text> element from its estimated width and anchor."""
    size, anchor = base, "start"
    for cls in (el.get("class") or "").split():
        s, a = table.get(cls, (None, None))
        size = s or size
        anchor = a or anchor
    style = el.get("style") or ""
    m = re.search(r"font-size:(\d+(?:\.\d+)?)px", style)
    if m:
        size = float(m.group(1))
    m = re.search(r"text-anchor:(middle|end)", style)
    if m:
        anchor = m.group(1)
    text = "".join(el.itertext())
    width = len(text) * size * EM
    x = float(el.get("x") or 0)
    if anchor == "middle":
        return x - width / 2, x + width / 2, text
    if anchor == "end":
        return x - width, x, text
    return x, x + width, text


def check(path):
    problems = []
    svg_text = path.read_text()
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError as e:
        return [f"not well-formed XML: {e}"]
    vb = (root.get("viewBox") or "").split()
    if len(vb) != 4:
        return [f"viewBox is {root.get('viewBox')!r}; the sheet needs one, e.g. 0 0 1400 880"]
    width = float(vb[2])
    base, table = styles(svg_text)
    ns = "{http://www.w3.org/2000/svg}"
    for tag in ("text", "tspan"):
        for el in root.iter(ns + tag):
            if el.get("fill"):
                problems.append(f'<{tag}> has fill="{el.get("fill")}"; write style="fill:…" (the sheet style\'s text{{fill}} rule wins)')
    for el in root.iter(ns + "text"):
        x0, x1, text = span(el, base, table)
        if x0 < 0 or x1 > width:
            problems.append(f"text runs off the sheet (est. {x0:.0f}..{x1:.0f}): {text[:60]!r}")
    # A <rect .../> with <text> elements on the same source line is a labelled box when the text's x sits inside
    # the rect (a header or a node); a legend swatch with its label beside it is not, and is skipped.
    for line in svg_text.splitlines():
        rect = re.match(r'\s*<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"', line)
        if not rect or "<text" not in line:
            continue
        bx0 = float(rect.group(1))
        bx1 = bx0 + float(rect.group(2))
        for el in ET.fromstring(f"<g xmlns='http://www.w3.org/2000/svg'>{line.strip()}</g>").iter(ns + "text"):
            x0, x1, text = span(el, base, table)
            if bx0 <= float(el.get("x") or 0) <= bx1 and (x0 < bx0 - TOL or x1 > bx1 + TOL):
                problems.append(f"label wider than its box {bx0:.0f}..{bx1:.0f} (est. {x0:.0f}..{x1:.0f}): {text[:60]!r}")
    return problems


def render(path, out_dir):
    """2x PNG of the sheet via qlmanage: pad the viewBox to a square, render, crop the band back."""
    src = path.read_text()
    tag = re.search(r"<svg\b[^>]*>", src)
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', tag.group(0))
    w, h = int(m.group(1)), int(m.group(2))
    pad = (w - h) / 2
    # Rewrite only the root tag, whatever order its attributes come in; a padded copy whose
    # viewBox did not change would render unpadded and crop the wrong band without a word.
    root = tag.group(0)
    root = re.sub(r'viewBox="[^"]*"', f'viewBox="0 -{pad:g} {w} {w}"', root)
    root = re.sub(r'\bwidth="[^"]*"', f'width="{w}"', root)
    root = re.sub(r'\bheight="[^"]*"', f'height="{w}"', root)
    assert f'viewBox="0 -{pad:g} {w} {w}"' in root and f'width="{w}"' in root and f'height="{w}"' in root
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / path.name
        copy.write_text(src[:tag.start()] + root + src[tag.end():])
        subprocess.run(["qlmanage", "-t", "-s", str(2 * w), "-o", tmp, str(copy)], capture_output=True, check=True)
        png = out_dir / (path.stem + ".png")
        subprocess.run(["sips", "-c", str(2 * h), str(2 * w), str(copy) + ".png", "--out", str(png)],
                       capture_output=True, check=True)
    return png


def main(argv):
    out_dir = None
    if "--render" in argv:
        i = argv.index("--render")
        out_dir = Path(argv[i + 1])
        out_dir.mkdir(parents=True, exist_ok=True)
        del argv[i:i + 2]
    if not argv:
        print(__doc__)
        return 2
    failed = 0
    for arg in argv:
        path = Path(arg)
        problems = check(path)
        for p in problems:
            print(f"{path}: {p}")
        failed += bool(problems)
        if out_dir and not problems:
            print(f"{path}: rendered {render(path, out_dir)}")
        elif not problems:
            print(f"{path}: ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
