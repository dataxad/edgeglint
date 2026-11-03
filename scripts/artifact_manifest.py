"""Shared by the artifact-keeper generators (undermine #794; edgeglint #38): the manifest, what was last published, computed facts.

A generator writes .artifacts/<id>/manifest.json for ~/.claude/bin/artifact-keeper, which a Haiku keeper carries out.
The generator never sees what the keeper did, so it keeps a ledger: each keeper build records what it emitted, and the
runner's `done` stamp (~/.claude/state/artifact-keeper/<key>.<id>, touched after every call succeeded) confirms it.
A part (a dataset file, a page, an artboard) is emitted when it differs from the last confirmed build, or when the last
confirmed full publish is older than `full_after_h`, so a call the keeper skipped heals on its own.

Manifest rules (runner header): a value only an upload can give is the string "$upload:<relpath>"; Artifact paths are
relative to the worktree; ArtifactData `file_path` is absolute, because the runner resolves only Artifact paths. The
store refuses a write to an existing document that has no `if_version` (#801), so every ArtifactData write carries
the placeholder pin(collection, doc_id) = "$version:<collection>/<doc_id>"; the runner reads each pinned document, puts
in its version, and drops the key for a document that does not exist yet. A literal version number is never allowed.
Several documents go in one `batch` call (batch_call): one approval, atomic.
"""
import hashlib
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = "edgeglint"
LEDGER = Path(os.environ.get("EDGEGLINT_KEEPER_STATE", Path.home() / ".local/state/edgeglint/keeper"))
STAMPS = Path(os.environ.get("ARTIFACT_KEEPER_STATE", Path.home() / ".claude/state/artifact-keeper"))
SUMMARY_MAX = 600
# Only a keeper build (the runner's throwaway worktree ak-<key>-<id>-*) records to the ledger; a run in a lane or the
# main checkout would claim a build the keeper never carried out. Set EDGEGLINT_KEEPER_STATE to record elsewhere.
RECORD = ROOT.name.startswith(f"ak-{KEY}-") or "EDGEGLINT_KEEPER_STATE" in os.environ


def digest(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def utc(ts):
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(ts))


class Ledger:
    """What the keeper last published for one artifact, as far as its `done` stamp proves."""

    def __init__(self, aid, full_after_h, now=None):
        self.path = LEDGER / f"{aid}.json"
        self.now = time.time() if now is None else now
        prev = json.loads(self.path.read_text()) if self.path.exists() else {}
        stamp = STAMPS / f"{KEY}.{aid}"
        done = stamp.stat().st_mtime if stamp.exists() else 0
        if prev.get("built_at") and done >= prev["built_at"]:
            # The build before this one was carried out: it is now the published state.
            self.published, self.published_facts = prev["built"], prev.get("built_facts")
            self.published_at = prev["built_at"]
            self.full_at = prev["built_at"] if prev.get("built_full") else prev.get("full_at", 0)
        else:
            self.published, self.published_facts = prev.get("published", {}), prev.get("published_facts")
            self.published_at, self.full_at = prev.get("published_at"), prev.get("full_at", 0)
        self.full = not self.full_at or self.now - self.full_at >= full_after_h * 3600

    def changed(self, name, sha):
        return self.full or self.published.get(name) != sha

    def save(self, built, facts):
        if not RECORD:
            print(f"ledger not recorded: {ROOT} is not a keeper worktree")
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "built_at": self.now, "built": built, "built_full": self.full, "built_facts": facts,
            "published": self.published, "published_facts": self.published_facts,
            "published_at": self.published_at, "full_at": self.full_at}, indent=1, sort_keys=True))


def summary_text(parts):
    """Join computed parts into the manifest summary; never longer than SUMMARY_MAX characters."""
    text = "; ".join(p for p in parts if p)
    return text if len(text) <= SUMMARY_MAX else text[:SUMMARY_MAX - 1] + "…"


def pin(collection, doc_id):
    """The runner's placeholder for the version of one store document."""
    return f"$version:{collection}/{doc_id}"


def batch_call(url, writes):
    """One ArtifactData batch (one approval, all or nothing). Each write is {collection, doc_id, data | file_path}; it is a
    `set`, and pinned to the version of the document it replaces."""
    assert 1 <= len(writes) <= 50, "a batch holds 1 to 50 writes"
    return {"tool": "ArtifactData", "input": {"action": "batch", "url": url, "writes": [
        {"op": "set", **w, "if_version": pin(w["collection"], w["doc_id"])} for w in writes]}}


STORE_WRITES = ("set", "update", "delete", "str_replace")


def check_calls(calls, url):
    """The runner's rules plus this repo's: one url, allowed tools, no force, and every store write pinned by placeholder."""
    assert calls, "a manifest needs at least one call"
    for c in calls:
        assert c["tool"] in ("Artifact", "ArtifactData"), c["tool"]
        inp = c["input"]
        assert inp.get("url") == url, inp.get("url")
        assert '"force"' not in json.dumps(c), "no force in a manifest"
        if c["tool"] != "ArtifactData":
            assert "if_version" not in json.dumps(c), "only store writes carry a pin"
            continue
        # A write is a top-level set/update/delete/str_replace, or an entry of a batch (its `op`).
        writes = [{**w, "action": w["op"]} for w in inp.get("writes", [])] if inp.get("action") == "batch" else [inp]
        for w in writes:
            if w["action"] in STORE_WRITES:
                assert w.get("if_version") == pin(w["collection"], w["doc_id"]), (
                    f"{w['collection']}/{w['doc_id']}: if_version must be the placeholder {pin(w['collection'], w['doc_id'])}")
            else:
                assert "if_version" not in w, f"{w['action']} takes no pin"


def write(aid, url, calls, summary, facts):
    check_calls(calls, url)
    assert len(summary) <= SUMMARY_MAX
    out = ROOT / ".artifacts" / aid / "manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"calls": calls, "analysis": {"summary": summary, "facts": facts}}, indent=1))
    return out
