"""Self-test for learn.py — run with:  uv run ~/.claude/skills/teach/scripts/learn.py selftest

Every check runs against a throwaway vault in a temp dir; the real vault is never touched.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import learn as L

RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))


@contextlib.contextmanager
def at(ts: str):
    old = os.environ.get("LEARN_NOW")
    os.environ["LEARN_NOW"] = ts
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("LEARN_NOW", None)
        else:
            os.environ["LEARN_NOW"] = old


def run(vault, *argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        L.main(["--vault", str(vault), *argv])
    txt = buf.getvalue()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        return txt


def expect_error(vault, *argv, contains=""):
    try:
        run(vault, *argv)
    except L.LearnError as e:
        return contains.lower() in str(e).lower()
    return False


def new_vault(tmp: Path, name="v") -> Path:
    v = tmp / name
    v.mkdir()
    with at("2026-09-27T10:00:00Z"):
        run(v, "init")
    return v


def write_json(tmp: Path, obj) -> str:
    p = tmp / f"spec-{time.monotonic_ns()}.json"
    p.write_text(json.dumps(obj), encoding="utf-8")
    return str(p)


VERIFIED = {"by": "selftest", "sources": ["unit"], "date": "2026-09-27"}


def add_active_item(v, tmp, area="Math", name="Chain rule", itype="concept", **extra):
    with at("2026-09-27T10:00:00Z"):
        cid = run(v, "concept", "add", "--area", area, "--name", name, "--stage", "1")["concept_id"]
        spec = {"concept_id": cid, "type": itype, "state": "active", "prompt": f"Explain {name}",
                "key": "k", "rubric": "r", "verified": VERIFIED, **extra}
        iid = run(v, "item", "add", "--json", write_json(tmp, spec))["added"][0]
    return cid, iid


def answer_and_grade(v, iid, when, outcome="correct", kind="scheduled", self_report=None, assisted=False):
    with at(when):
        aid = run(v, "attempt", "start", "--item", iid, "--kind", kind)["attempt_id"]
        args = ["attempt", "answer", "--id", aid, "--text", "my answer"]
        if self_report:
            args += ["--self", self_report]
        if assisted:
            args += ["--assisted"]
        run(v, *args)
        g = run(v, "grade", aid, "--outcome", outcome)
    return aid, g


# ----------------------------------------------------------------------------- tests

def t_fsrs_matches_library(tmp):
    """Our replay must equal a direct py-fsrs run with the same fixed config (fuzz off, no steps)."""
    from fsrs import Card, Rating, Scheduler

    v = new_vault(tmp, "fsrs")
    _, iid = add_active_item(v, tmp)
    seq = [("2026-09-28T08:00:00Z", "correct", None), ("2026-10-01T08:00:00Z", "correct", "instant"),
           ("2026-10-12T08:00:00Z", "incorrect", None), ("2026-10-14T08:00:00Z", "correct", "struggled")]
    for when, outc, sr in seq:
        answer_and_grade(v, iid, when, outc, self_report=sr)
    with at("2026-10-14T09:00:00Z"):
        it = run(v, "show", iid)
    sch = Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False)
    card = Card(card_id=it["card"]["card_id"], due=L.parse_ts(it["activated"]))
    rmap = {"correct": {None: Rating.Good, "instant": Rating.Easy, "struggled": Rating.Hard}}
    for when, outc, sr in seq:
        r = Rating.Again if outc == "incorrect" else rmap["correct"][sr]
        card, _ = sch.review_card(card, r, L.parse_ts(when))
    check("fsrs: replay equals direct py-fsrs", abs(card.stability - it["card"]["stability"]) < 1e-9
          and card.due.isoformat() == it["card"]["due"], f"{card.stability} vs {it['card']['stability']}")
    check("fsrs: lapse counted", it["lapses"] == 1)


def t_rating_policy(tmp):
    check("rating: incorrect→again", L.rating_for("incorrect", False, "instant") == "again")
    check("rating: assisted correct→again", L.rating_for("correct", True, None) == "again")
    check("rating: correct default→good", L.rating_for("correct", False, None) == "good")
    check("rating: struggled→hard", L.rating_for("correct", False, "struggled") == "hard")
    check("rating: instant→easy", L.rating_for("correct", False, "instant") == "easy")
    check("rating: ungradable→none", L.rating_for("ungradable", False, None) == "none")


def t_idempotency_and_stale(tmp):
    v = new_vault(tmp, "idem")
    _, iid = add_active_item(v, tmp)
    with at("2026-09-28T08:00:00Z"):
        aid = run(v, "attempt", "start", "--item", iid)["attempt_id"]
        check("attempt: second open attempt on same item refused",
              expect_error(v, "attempt", "start", "--item", iid, contains="open attempt"))
        check("grade before answer refused", expect_error(v, "grade", aid, "--outcome", "correct", contains="no recorded answer"))
        run(v, "attempt", "answer", "--id", aid, "--text", "x")
        check("duplicate answer refused", expect_error(v, "attempt", "answer", "--id", aid, "--text", "y", contains="duplicate"))
        run(v, "grade", aid, "--outcome", "correct")
        check("duplicate grade refused", expect_error(v, "grade", aid, "--outcome", "correct", contains="duplicate"))
        reviews = run(v, "show", iid)["reviews"]
        check("one answer → exactly one scheduling update", reviews == 1, str(reviews))
    # stale: item revised between start and grade
    with at("2026-10-05T08:00:00Z"):
        aid2 = run(v, "attempt", "start", "--item", iid)["attempt_id"]
        run(v, "attempt", "answer", "--id", aid2, "--text", "x")
        run(v, "item", "revise", iid, "--json", write_json(tmp, {"key": "new key"}))
        check("stale attempt (item rev changed) refused", expect_error(v, "grade", aid2, "--outcome", "correct", contains="stale"))
        run(v, "attempt", "abandon", "--id", aid2)
        check("abandon is not a failure", run(v, "show", iid)["lapses"] == 0)


def t_regrade_supersedes(tmp):
    v = new_vault(tmp, "regrade")
    _, iid = add_active_item(v, tmp)
    a1, _ = answer_and_grade(v, iid, "2026-09-28T08:00:00Z", "incorrect")
    answer_and_grade(v, iid, "2026-09-30T08:00:00Z", "correct")
    with at("2026-09-30T09:00:00Z"):
        before = run(v, "show", iid)
        run(v, "grade", a1, "--outcome", "correct", "--regrade")
        after = run(v, "show", iid)
    check("regrade: no extra retrieval counted", after["reviews"] == before["reviews"] == 2)
    check("regrade: lapse removed after supersede", before["lapses"] == 1 and after["lapses"] == 0)
    check("regrade: later state re-derived", after["card"]["stability"] != before["card"]["stability"])


def t_replay_stable_after_config_change(tmp):
    v = new_vault(tmp, "cfg")
    _, iid = add_active_item(v, tmp)
    answer_and_grade(v, iid, "2026-09-28T08:00:00Z", "correct")
    with at("2026-09-28T09:00:00Z"):
        before = run(v, "show", iid)["card"]
    store = L.Store(v)
    cfg = store.config()
    params = list(cfg["config_versions"][0]["parameters"])
    params[2] = params[2] * 3
    cfg["config_versions"].append({"version": 2, "parameters": params, "created": "2026-09-28T09:00:00Z", "note": "t"})
    cfg["current_version"] = 2
    cfg["default_retention"] = 0.8
    store.write_config(cfg)
    with at("2026-09-28T09:00:00Z"):
        after = run(v, "show", iid)["card"]
    check("replay: past events keep their own config_version/retention", before == after)


def t_crash_boundaries(tmp):
    v = new_vault(tmp, "crash")
    _, iid = add_active_item(v, tmp)
    ev = v / ".learn" / "events.jsonl"
    # crash mid-append: partial last line
    with open(ev, "ab") as f:
        f.write(b'{"type": "attempt_start", "attem')
    check("crash: partial trailing line → refuse", expect_error(v, "queue", contains="incomplete line"))
    with at("2026-09-28T08:00:00Z"):
        run(v, "doctor", "--fix-trailing")
        q = run(v, "queue")
    check("crash: doctor --fix-trailing recovers", isinstance(q, dict) and "items" in q)
    # crash after attempt_start, before answer: attempt stays open, can be abandoned, no schedule change
    with at("2026-09-28T08:00:00Z"):
        aid = run(v, "attempt", "start", "--item", iid)["attempt_id"]
        run(v, "attempt", "abandon", "--id", aid)
        check("crash after start: nothing scheduled", run(v, "show", iid)["reviews"] == 0)
    # crash after answer, before grade: shows as pending, not re-served
    with at("2026-09-28T08:05:00Z"):
        aid = run(v, "attempt", "start", "--item", iid)["attempt_id"]
        run(v, "attempt", "answer", "--id", aid, "--text", "x")
        pend = run(v, "pending")
        q = run(v, "queue")
    check("crash after answer: listed as pending grade", any(p["attempt_id"] == aid for p in pend))
    check("crash after answer: item not re-served while pending", all(r["item_id"] != iid for r in q["items"]))
    # malformed line in the middle
    lines = ev.read_text(encoding="utf-8").splitlines(keepends=True)
    lines.insert(1, "not json\n")
    ev.write_text("".join(lines), encoding="utf-8")
    check("malformed line → refuse, with line number", expect_error(v, "queue", contains="line 2"))
    check("malformed line → writes refused too", expect_error(v, "concept", "add", "--area", "X", "--name", "y", contains="line 2"))


def t_lock(tmp):
    v = new_vault(tmp, "lock")
    store = L.Store(v)
    ok = {}

    def hold():
        with store.lock():
            time.sleep(1.5)

    th = threading.Thread(target=hold)
    th.start()
    time.sleep(0.2)
    s2 = L.Store(v)
    try:
        with s2.lock(timeout=0.5):
            ok["got"] = True
    except L.LearnError as e:
        ok["err"] = str(e)
    th.join()
    check("lock: second writer gets 'busy'", "busy" in ok.get("err", ""), str(ok))
    # stale lock (crashed process) is reclaimed
    (v / ".learn" / "lock").write_text("999 old")
    old = time.time() - 600
    os.utime(v / ".learn" / "lock", (old, old))
    with store.lock(timeout=0.5):
        pass
    check("lock: stale lock from a crashed process is reclaimed", True)


def t_time(tmp):
    cfg = dict(L.DEFAULT_CONFIG)
    # 02:30 local on Sep 28 still belongs to Sep 27 (rollover 04:00); Vienna = UTC+2 in summer
    check("rollover: 02:30 local counts as previous day",
          str(L.local_day(L.parse_ts("2026-09-28T00:30:00Z"), cfg)) == "2026-09-27")
    check("rollover: 04:30 local is the new day",
          str(L.local_day(L.parse_ts("2026-09-28T02:30:00Z"), cfg)) == "2026-09-28")
    # DST end 2026-10-25: day end must be 04:00 local on the 26th = 03:00Z (UTC+1 after the switch)
    e = L.day_end_utc(datetime(2026, 10, 25).date(), cfg)
    check("DST autumn: day end = 04:00 local (03:00Z)", L.iso(e) == "2026-10-26T03:00:00Z", L.iso(e))
    e2 = L.day_end_utc(datetime(2027, 3, 28).date(), cfg)
    check("DST spring: day end = 04:00 local (02:00Z)", L.iso(e2) == "2027-03-29T02:00:00Z", L.iso(e2))
    e3 = L.day_end_utc(datetime(2027, 3, 27).date(), cfg)
    check("DST spring eve: day end on switch day 04:00 CEST (02:00Z)", L.iso(e3) == "2027-03-28T02:00:00Z", L.iso(e3))


def t_exam_cap(tmp):
    v = new_vault(tmp, "exam")
    _, iid = add_active_item(v, tmp, course="Calc1")
    for when in ["2026-09-28T08:00:00Z", "2026-10-01T08:00:00Z", "2026-10-12T08:00:00Z"]:
        answer_and_grade(v, iid, when, "correct", self_report="instant")
    store = L.Store(v)
    with at("2026-10-12T09:00:00Z"):
        cfg = store.config()
        st = L.replay(store.read_events(), cfg)
        raw_due = L.parse_ts(st["items"][iid]["card"]["due"])
        # add an exam 10 days out AFTER the card was already scheduled past it
        cfg["courses"] = {"Calc1": {"area": "Math", "exams": ["2026-10-22"]}}
        store.write_config(cfg)
        cfg = store.config()
        ed = L.effective_due(st["items"][iid], cfg)
    exam = datetime(2026, 10, 22, 9, tzinfo=L.ZoneInfo("Europe/Vienna"))
    check("exam cap: card scheduled past the exam is re-capped", raw_due > exam and ed < exam,
          f"raw {raw_due} capped {ed}")
    check("exam cap: gap ≈ 20% of time left (≈2 days)", timedelta(days=1.5) < ed - L.parse_ts("2026-10-12T08:00:00Z") < timedelta(days=2.5))
    with at("2026-10-23T09:00:00Z"):
        ed2 = L.effective_due(st["items"][iid], cfg)
    check("exam cap lifts after the exam", ed2 == raw_due)
    events_before = len(store.read_events())
    check("exam cap writes no events", events_before == len(store.read_events()))


def t_queue(tmp):
    v = new_vault(tmp, "queue")
    ids = []
    for i in range(6):
        fam = "parts" if i % 2 else "substitution"
        _, iid = add_active_item(v, tmp, area="Math", name=f"integral {i}", itype="problem", family=fam,
                                 course="Calc1", week=i // 2 + 1)
        ids.append(iid)
    for i in range(3):
        add_active_item(v, tmp, area="Lang", name=f"word {i}", itype="fact", tags=["wordlist:greek"])
    with at("2026-09-28T08:00:00Z"):
        q = run(v, "queue", "--minutes", "100", "--seed", "1")
    fams = [r["family"] for r in q["items"] if r["family"]]
    check("queue: new items capped by new_per_day (10 max)", len(q["items"]) <= 10)
    check("queue: no same family back to back when avoidable",
          all(a != b for a, b in zip(fams, fams[1:])), str(fams))
    words = [i for i, r in enumerate(q["items"]) if r["type"] == "fact"]
    check("queue: word-list facts stay grouped", words == list(range(words[0], words[0] + len(words))) if words else True)
    with at("2026-09-28T08:00:00Z"):
        q2 = run(v, "queue", "--minutes", "10")
    check("queue: minute budget respected (problems 8 min each)", q2["est_minutes"] <= 10 or len(q2["items"]) == 1,
          str(q2["est_minutes"]))
    with at("2026-09-28T08:00:00Z"):
        q3 = run(v, "queue", "--mode", "problems", "--minutes", "100")
    check("queue: problems mode only serves problems", all(r["type"] in ("problem", "mistake") for r in q3["items"]))
    # needs_teaching and draft never served
    with at("2026-09-28T08:00:00Z"):
        cid = run(v, "concept", "add", "--area", "Math", "--name", "gap")["concept_id"]
        run(v, "item", "add", "--json", write_json(tmp, {"concept_id": cid, "state": "needs_teaching"}))
        q4 = run(v, "queue", "--minutes", "500")
    check("queue: needs_teaching never served; surfaced as teach_next",
          all(r["concept"] != "gap" for r in q4["items"]) and "gap" in q4.get("teach_next", []))


def t_activation_rules(tmp):
    v = new_vault(tmp, "act")
    with at("2026-09-27T10:00:00Z"):
        cid = run(v, "concept", "add", "--area", "A", "--name", "n")["concept_id"]
        check("activation: unverified key refused", expect_error(
            v, "item", "add", "--json", write_json(tmp, {"concept_id": cid, "state": "active", "prompt": "p", "key": "k",
                                                        "rubric": "r"}), contains="not verified"))
        iid = run(v, "item", "add", "--json", write_json(tmp, {"concept_id": cid, "prompt": "p"}))["added"][0]
        check("activation: incomplete draft refused", expect_error(v, "item", "state", iid, "--state", "active", contains="missing"))
        lid = run(v, "lesson", "start", "--area", "A", "--path", "A/x.md")["lesson_id"]
        run(v, "item", "revise", iid, "--json", write_json(tmp, {"lesson_id": lid}))
        check("lesson finalize blocked by incomplete drafts", expect_error(v, "lesson", "finalize", "--id", lid, contains="fix these"))
        run(v, "item", "revise", iid, "--json", write_json(tmp, {"key": "k", "rubric": "r", "verified": VERIFIED}))
        r1 = run(v, "lesson", "finalize", "--id", lid)
        r2 = run(v, "lesson", "finalize", "--id", lid)
    check("lesson finalize activates drafts", r1["activated"] == [iid])
    check("lesson finalize is idempotent", r2["activated"] == [])
    with at("2026-09-27T10:00:00Z"):
        it = run(v, "show", iid)
    check("first review is delayed to the next day (≥ next 04:00 rollover)",
          it["activated"] == "2026-09-28T02:00:00Z", it["activated"])


def t_stages(tmp):
    v = new_vault(tmp, "stage")
    cid, i1 = add_active_item(v, tmp, name="bayes")
    with at("2026-09-27T10:00:00Z"):
        run(v, "formative", cid, "--outcome", "correct")
        spec = {"concept_id": cid, "state": "active", "prompt": "p2", "key": "k", "rubric": "r", "verified": VERIFIED}
        i2 = run(v, "item", "add", "--json", write_json(tmp, spec))["added"][0]
    _, g = answer_and_grade(v, i1, "2026-09-28T08:00:00Z")
    check("stage: formative + delayed pass → Understand", g["concept_stage"] == "2 Understand", g["concept_stage"])
    _, g = answer_and_grade(v, i1, "2026-09-30T08:00:00Z")
    check("stage: same item again ≠ Practice", g["concept_stage"] == "2 Understand", g["concept_stage"])
    _, g = answer_and_grade(v, i2, "2026-10-01T08:00:00Z")
    check("stage: 2 different items on different days → Practice", g["concept_stage"] == "3 Practice", g["concept_stage"])
    with at("2026-10-02T08:00:00Z"):
        aid = run(v, "attempt", "start", "--concept", cid, "--kind", "apply", "--prompt", "novel task")["attempt_id"]
        run(v, "attempt", "answer", "--id", aid, "--text", "x")
        g = run(v, "grade", aid, "--outcome", "correct")
    check("stage: unseen apply task passed → Apply", g["concept_stage"] == "4 Apply", g["concept_stage"])
    _, g = answer_and_grade(v, i1, "2026-10-20T08:00:00Z", "incorrect")
    check("stage: failed re-check drops one stage", g["concept_stage"] == "3 Practice", g["concept_stage"])
    _, g = answer_and_grade(v, i2, "2026-10-21T08:00:00Z", "correct", assisted=True)
    check("stage: assisted success counts as a miss", g["rating"] == "again")


def t_leech(tmp):
    v = new_vault(tmp, "leech")
    _, iid = add_active_item(v, tmp)
    day = datetime(2026, 9, 28, 8, tzinfo=timezone.utc)
    g = None
    for k in range(4):
        _, g = answer_and_grade(v, iid, L.iso(day + timedelta(days=3 * k)), "incorrect")
    check("leech: 4 lapses → suspended with remediation note", g.get("item_state") == "suspended" and "leech" in g.get("suspended", ""))


def t_mistake_cap(tmp):
    v = new_vault(tmp, "mistake")
    cid, iid = add_active_item(v, tmp, itype="problem")
    with at("2026-09-28T08:00:00Z"):
        run(v, "item", "add", "--json", write_json(tmp, {"concept_id": cid, "type": "mistake", "spawned_from": iid}))
        check("mistake items capped at 1 per source", expect_error(
            v, "item", "add", "--json", write_json(tmp, {"concept_id": cid, "type": "mistake", "spawned_from": iid}),
            contains="max 1"))


def t_runner(tmp):
    d = tmp / "code"
    d.mkdir()
    (d / "test_sq.py").write_text("from solution import sq\n\ndef test_sq():\n    assert sq(3) == 9\n", encoding="utf-8")
    (d / "ref.py").write_text("def sq(x):\n    return x * x\n", encoding="utf-8")
    (d / "stub.py").write_text("def sq(x):\n    return 0\n", encoding="utf-8")
    (d / "hang.py").write_text("import time\ndef sq(x):\n    time.sleep(60)\n", encoding="utf-8")
    v = new_vault(tmp, "runner")
    with at("2026-09-27T10:00:00Z"):
        cid = run(v, "concept", "add", "--area", "Code", "--name", "squares")["concept_id"]
        iid = run(v, "item", "add", "--json", write_json(tmp, {
            "concept_id": cid, "type": "problem", "prompt": "write sq", "key": "x*x", "rubric": "r",
            "verified": VERIFIED, "tests": {"test_file": str(d / "test_sq.py"), "entry": "solution.py"}}))["added"][0]
        check("runner: problem with unvalidated tests can't activate",
              expect_error(v, "item", "state", iid, "--state", "active", contains="not validated"))
        r = run(v, "check-item", iid, "--reference", str(d / "ref.py"), "--stub", str(d / "stub.py"))
        check("runner: reference passes, stub fails", r["reference"] == "pass" and r["stub"] == "fail", str(r))
        run(v, "item", "state", iid, "--state", "active")
    with at("2026-09-28T08:00:00Z"):
        aid = run(v, "attempt", "start", "--item", iid)["attempt_id"]
        run(v, "attempt", "answer", "--id", aid, "--text", "see file")
        r = run(v, "check", aid, "--solution", str(d / "hang.py"))
        check("runner: timeout kills and reports fail", r["result"] == "fail" and "timed out" in r["output"], str(r))
        (d / "test_sq.py").write_text("changed\n", encoding="utf-8")
        r = run(v, "check", aid, "--solution", str(d / "ref.py"))
        check("runner: changed test file → infra_error, not a grade", r["result"] == "infra_error", str(r))
        check("runner: infra_error blocks a correct/incorrect grade",
              expect_error(v, "grade", aid, "--outcome", "incorrect", contains="infrastructure"))


def t_checkpoint(tmp):
    v = new_vault(tmp, "cp")
    for i in range(6):
        add_active_item(v, tmp, area="A" if i < 3 else "B", name=f"c{i}")
    with at("2026-10-01T08:00:00Z"):
        r = run(v, "checkpoint", "--n", "4", "--seed", "3")
    check("checkpoint: nothing eligible before 14 days → valid 'too few' result", r["sampled"] == [] and r["eligible"] == 0)
    with at("2026-10-20T08:00:00Z"):
        r = run(v, "checkpoint", "--n", "4", "--seed", "3")
    check("checkpoint: samples regardless of review history, stratified by area",
          len(r["sampled"]) == 4 and r["eligible"] == 6)


def t_migration(tmp):
    v = new_vault(tmp, "mig")
    (v / "concepts").mkdir()
    (v / "Trading").mkdir()
    (v / "Trading" / "2026-08-30 - candles.md").write_text("candle body wick stop loss", encoding="utf-8")
    (v / "concepts" / "Trading.md").write_text(
        "# Trading — Concept Tracker\n\n| Concept | Stage | Attempts | Correct | Last Tested | Next Review | Status |\n"
        "|---|---|---|---|---|---|---|\n| Candle body vs wick | 2 Understand | 2 | 1 | 2026-08-30 | 2026-08-31 | 🟢 |\n"
        "| Stop loss | 1 Discover | 1 | 0 | 2026-08-30 | 2026-08-31 | 🔴 |\n\n### Error Notes\n\n**Stop loss**\n"
        "- Confusion: thought it guarantees the price\n- Key point: it is a market order\n", encoding="utf-8")
    with at("2026-09-27T10:00:00Z"):
        d = run(v, "migrate", "--dry-run")
        check("migrate dry-run: counts rows, writes nothing", d["concepts"] == 2 and
              (v / "concepts" / "Trading.md").exists() and not (v / "concepts" / "_v2-archive").exists())
        r = run(v, "migrate")
        items = run(v, "list")
        concepts = run(v, "list", "--concepts")
    check("migrate: rows become concepts + DRAFT items (never active)",
          r["migrated_concepts"] == 2 and all(i["state"] == "draft" for i in items) and len(items) == 2)
    check("migrate: legacy stage kept on the concept", {c["name"]: c["stage"] for c in concepts}["Candle body vs wick"] == "2 Understand")
    check("migrate: old file archived, view regenerated", (v / "concepts" / "_v2-archive" / "Trading.md").exists()
          and "Generated by" in (v / "concepts" / "Trading.md").read_text(encoding="utf-8"))
    with at("2026-09-27T10:00:00Z"):
        r2 = run(v, "migrate")
    check("migrate: re-run adds nothing", r2["migrated_concepts"] == 0)
    iid = items[0]["item_id"]
    with at("2026-09-27T10:00:00Z"):
        run(v, "item", "revise", iid, "--json", write_json(tmp, {"prompt": "p", "key": "k", "rubric": "r", "verified": VERIFIED}))
        run(v, "item", "state", iid, "--state", "active")
        cp = run(v, "checkpoint", "--n", "4", "--seed", "1", "--baseline")
    check("migrate: legacy learn date makes migrated items checkpoint-eligible now (baseline)", cp["sampled"] == [iid], str(cp))


def t_due_brief(tmp):
    v = new_vault(tmp, "brief")
    _, iid = add_active_item(v, tmp)
    answer_and_grade(v, iid, "2026-09-28T08:00:00Z")
    with at("2026-10-15T08:00:00Z"):
        txt = run(v, "due", "--brief")
    check("due --brief: one line when something is due", isinstance(txt, str) and txt.count("\n") == 1 and "review" in txt, repr(txt))
    empty = tmp / "nothing"
    empty.mkdir()
    check("due --brief: silent on a missing vault", run(empty, "due", "--brief") == "")


def t_rebuild_equals_cache(tmp):
    v = new_vault(tmp, "rebuild")
    _, iid = add_active_item(v, tmp)
    answer_and_grade(v, iid, "2026-09-28T08:00:00Z")
    with at("2026-09-28T09:00:00Z"):
        store = L.Store(v)
        cfg = store.config()
        st = L.replay(store.read_events(), cfg)
        cache = json.loads(store.state_path.read_text(encoding="utf-8"))
    ed = L.effective_due(st["items"][iid], cfg)
    check("cache: state.json due equals a fresh replay", cache["items"][iid]["due"] == L.iso(ed))


TESTS = [t_fsrs_matches_library, t_rating_policy, t_idempotency_and_stale, t_regrade_supersedes,
         t_replay_stable_after_config_change, t_crash_boundaries, t_lock, t_time, t_exam_cap, t_queue,
         t_activation_rules, t_stages, t_leech, t_mistake_cap, t_runner, t_checkpoint, t_migration,
         t_due_brief, t_rebuild_equals_cache]


def run_all() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="learn-selftest-"))
    try:
        for t in TESTS:
            try:
                t(tmp)
            except Exception as e:  # a crashing test is a failed test
                import traceback
                RESULTS.append((t.__name__, False, "".join(traceback.format_exception_only(type(e), e)).strip()))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    bad = [r for r in RESULTS if not r[1]]
    for name, ok, detail in RESULTS:
        print(f"  {'✓' if ok else '✗'} {name}" + (f"  — {detail}" if (detail and not ok) else ""))
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(run_all())
