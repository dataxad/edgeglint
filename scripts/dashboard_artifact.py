#!/usr/bin/env python3
"""Collect the edgeglint project status from GitHub and Git; write the keeper's dashboard data (#38).

  python3 scripts/dashboard_artifact.py    # the build command in docs/artifacts.json

Stdlib only. Every value comes from gh or git; a call that fails leaves its values out and is listed as a `gap:` fact.
The live dashboard is the Dashboard-type artifact registered as "dashboard" in docs/artifacts.json. Its page source is
scripts/dashboard_page.html; its one dataset is the `work` rows that put() collects, each tagged with a type `t` that the
page's calcs pick apart. ~/.claude/bin/artifact-keeper runs this in a throwaway worktree at origin/main and carries out
the calls in .artifacts/dashboard/manifest.json (an upload of work.json, then one pinned batch write).
"""
import datetime as dt
import json
import subprocess

import artifact_manifest as am

ROOT = am.ROOT
REPO, PUBLIC = "dataxad/edgeglint-dev", "dataxad/edgeglint"
REGISTRY = json.loads((ROOT / "docs/artifacts.json").read_text())["artifacts"]
URL = next(a["url"] for a in REGISTRY if a["id"] == "dashboard")
PAGE = ROOT / "scripts/dashboard_page.html"
OUT = ROOT / ".artifacts/dashboard"
TYPES = ("fact", "issue", "pr", "merge", "milestone", "tag")
rows, gaps = [], []


def put(t, **fields):
    assert t in TYPES, f"declare row type {t} in TYPES and give the page a calc for it"
    rows.append({"t": t, **fields})


def sh(*args):
    try:
        r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else None
    except OSError:
        return None


def api(path):
    out = sh("gh", "api", path)
    if out is None:
        gaps.append(path)
        return None
    return json.loads(out)


def day(s):
    return (s or "")[:10] or None


def collect():
    now = dt.datetime.now(dt.timezone.utc)
    # ponytail: one page of 100 per list; paginate when the repo grows past that (today: 6 open issues).
    issues = api(f"repos/{REPO}/issues?state=open&per_page=100")
    prs = api(f"repos/{REPO}/pulls?state=open&per_page=100")
    closed = api(f"repos/{REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=50")
    milestones = api(f"repos/{REPO}/milestones?state=all&per_page=100")
    dev = api(f"repos/{REPO}/commits/main")
    pub = api(f"repos/{PUBLIC}/commits/main")
    releases = api(f"repos/{PUBLIC}/releases?per_page=30")
    tags = sh("git", "for-each-ref", "--sort=-creatordate", "--format=%(refname:short)\t%(creatordate:short)", "refs/tags")

    issues = [i for i in (issues or []) if "pull_request" not in i] if issues is not None else None
    for i in issues or []:
        put("issue", number=i["number"], title=i["title"], milestone=(i.get("milestone") or {}).get("title") or "none",
            labels=", ".join(l["name"] for l in i.get("labels", [])), updated=day(i["updated_at"]), url=i["html_url"])
    for p in prs or []:
        put("pr", number=p["number"], title=p["title"], state="draft" if p.get("draft") else "ready",
            author=p["user"]["login"], updated=day(p["updated_at"]), url=p["html_url"])
    merged = sorted((p for p in (closed or []) if p.get("merged_at")), key=lambda p: p["merged_at"], reverse=True)
    for p in merged[:15]:
        put("merge", number=p["number"], title=p["title"], merged=day(p["merged_at"]), url=p["html_url"])
    for m in milestones or []:
        put("milestone", title=m["title"], state=m["state"], open=m["open_issues"], closed=m["closed_issues"],
            due=day(m.get("due_on")) or "none", url=m["html_url"])
    tag_rows = [line.split("\t") for line in (tags or "").splitlines() if "\t" in line]
    for name, date in tag_rows[:10]:
        put("tag", name=name, date=date)

    mirror = None
    if dev and pub:
        mirror = "in sync" if dev["commit"]["tree"]["sha"] == pub["commit"]["tree"]["sha"] else "differs"
    last_merge = merged[0]["merged_at"] if merged else None
    since = (now - dt.datetime.fromisoformat(last_merge.replace("Z", "+00:00"))).days if last_merge else None
    facts = [
        ("open_issues", "Open issues", len(issues) if issues is not None else None),
        ("open_prs", "Open pull requests", len(prs) if prs is not None else None),
        ("milestones_open", "Open milestones", sum(m["state"] == "open" for m in milestones) if milestones is not None else None),
        ("unmilestoned", "Open issues without a milestone", sum(not i.get("milestone") for i in issues) if issues is not None else None),
        ("mirror", "Public mirror against dev main", mirror),
        ("dev_head", "dev main", dev["sha"][:7] if dev else None),
        ("public_head", "public main", pub["sha"][:7] if pub else None),
        ("last_merge", "Last merge", day(last_merge)),
        ("days_since_merge", "Days since the last merge", since),
        ("latest_tag", "Latest tag", tag_rows[0][0] if tag_rows else "none"),
        ("public_releases", "Public GitHub releases", len(releases) if releases is not None else None),
        ("collected_at", "Collected", now.strftime("%Y-%m-%d %H:%M UTC")),
        ("generator_sha", "Generator commit", sh("git", "rev-parse", "--short", "HEAD")),
    ]
    for key, label, value in facts:
        put("fact", key=key, label=label, value=value)
    return {"open_issues": len(issues) if issues is not None else None, "open_prs": len(prs) if prs is not None else None,
            "mirror": mirror, "merged_at": {str(p["number"]): p["merged_at"] for p in merged}}


def main():
    cur = collect()
    now = dt.datetime.now(dt.timezone.utc)
    OUT.mkdir(parents=True, exist_ok=True)
    template = PAGE.read_text()
    assert len(json.dumps({"text": template}).encode()) < 256_000, "the page document must stay under 256 KB"
    (OUT / "page.json").write_text(json.dumps({"text": template}))
    data = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    (OUT / "work.json").write_text(data)
    ledger = am.Ledger("dashboard", 24)
    built = {"page": am.digest(template), "work": am.digest(data)}
    head = sh("git", "rev-parse", "--short", "HEAD") or "?"
    writes, sent = [], []
    if ledger.changed("work", built["work"]):
        sent.append("work")
        writes.append({"collection": "datasets", "doc_id": "work", "data": {
            "title": "Open work from GitHub and Git",
            "description": f"Open issues, pull requests, recent merges, milestones, tags and the public mirror's parity, read "
                           f"from GitHub and Git. scripts/dashboard_artifact.py built it at origin/main {head}.",
            "source": {"kind": "file", "url": "$upload:.artifacts/dashboard/work.json", "name": "work.json"},
            "updated": {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "by": "artifact-keeper, scripts/dashboard_artifact.py"},
            "schedule": "artifact-keeper rebuilds it every hour from origin/main and sends it when it changed",
            "staleAfterHours": 3}})
    if ledger.changed("page", built["page"]):
        sent.append("page")
        writes.append({"collection": "files", "doc_id": "index.html", "file_path": str(OUT / "page.json")})
    # One batch, each write pinned to the document it replaces; the runner fills the versions in after the upload.
    calls = [am.batch_call(URL, writes)] if writes else [
        {"tool": "ArtifactData", "input": {"action": "get", "url": URL, "collection": "dash", "doc_id": "meta"}}]

    facts, parts = [f"gap: {g} could not be read" for g in gaps], []
    pub, since = ledger.published_facts, ledger.published_at
    if pub and since:
        for key, label in (("open_issues", "open issues"), ("open_prs", "open PRs")):
            if cur[key] is not None and pub.get(key) is not None and cur[key] != pub[key]:
                facts.append(f"delta: {label} {pub[key]} -> {cur[key]} ({cur[key] - pub[key]:+d}) since {am.utc(since)}")
        iso = dt.datetime.fromtimestamp(since, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        new = sorted(int(n) for n, at in cur["merged_at"].items() if at > iso)
        if new:
            facts.append("merged since last publish: " + ", ".join(f"#{n}" for n in new))
        parts.append(f"edgeglint since {am.utc(since)}: {cur['open_issues']} open issues, {cur['open_prs']} open PRs, "
                     f"{len(new)} merged")
    else:
        facts.append("baseline: no snapshot confirmed by done yet, nothing to compare against")
        n = lambda k: "?" if cur[k] is None else cur[k]
        parts.append(f"edgeglint baseline: {n('open_issues')} open issues, {n('open_prs')} open PRs")
    if cur["mirror"] == "differs":
        facts.append("red: the public mirror's tree differs from dev main (AGENTS.md: mirror the reviewed dev result)")
    parts.append(f"mirror {cur['mirror'] or 'unknown'}")
    parts.append(f"{len(gaps)} gap(s)")
    parts.append("to send: " + ", ".join(sent) if sent else "nothing changed")
    summary = am.summary_text(parts)
    path = am.write("dashboard", URL, calls, summary, facts)
    ledger.save(built, {k: cur[k] for k in ("open_issues", "open_prs", "mirror")})
    print(f"wrote {path}: {len(calls)} call(s); {summary}")


if __name__ == "__main__":
    main()
