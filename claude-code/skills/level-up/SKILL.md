---
name: level-up
description: >-
  Gauge the user's technical + product knowledge through a short adaptive assessment, log
  verbatim answers with honest ratings, and grow a learning plan from the gaps found. Use when
  the user says "level up", "level-up session", "gauge my knowledge", "quiz my knowledge", "find
  my gaps", or wants a fresh assessment round. Differentiator: this FINDS and MAPS gaps; the
  `teach` skill DELIVERS lessons on them, and `/tutor` drills them. Invoke with /level-up.
---

# Level Up — knowledge gap assessment

Run a 7-question adaptive assessment that maps what the user knows about the current project
(or a named topic), rates each answer honestly, and turns the genuine gaps into a learning plan
that `teach` and `/tutor` then work through.

This is the diagnostic front-end to the learning loop:

```
/level-up  →  gaps found  →  teach (lessons)  →  /tutor (drill)  →  /level-up (re-check)
```

## Where results are stored

Vault-first. Use `$OBSIDIAN_VAULT_PATH` (`<vault>`).

- `<vault>/Learning/user-knowledge.md` — verbatim Q&A pairs with ratings; **append** a new
  dated block each round, never overwrite.
- `<vault>/Learning/LEARNING-PLAN.md` — one bullet per genuine gap, newest on top, each tagged
  with the round it surfaced in and a `status:` (`open` / `teaching` / `closed`).

If a project `context/` folder exists and the assessment is project-scoped, also drop a one-line
pointer in `context/log.md` via `ctx log`.

Create the `Learning/` folder and files on first run.

## Workflow

**1 — State check.** Read both files if they exist. For a returning user: pick mostly-new
territory, and set starting difficulty from prior performance (strong history → start harder).

**2 — Scope.** If the user named a topic, use it. Otherwise infer scope from the current
project's `context/_map.md`, stack, and recent `log.md`. Confirm the scope in one line before
starting.

**3 — Seven questions, one at a time, plain text.** No multiple choice. For each question:
  - **Before asking**, write its answer key and rubric (the core idea a good answer must contain) to a
    scratch `k.json`: `{"key": …, "rubric": …, "accepted_alternatives": […]}`. Any non-trivial claim in
    the key gets a quick `researcher` check first, because a wrong key corrupts the whole map.
  - Record it: `learn.py attempt start --concept <cid> --kind probe --prompt "<question>"` (make the
    concept first with `concept add --area <Area> --name … --stage 0` if it's new), then save the
    verbatim answer with `attempt answer`.
  - **Grade blind**: `learn.py payload <aid> --key-file k.json`, pass that JSON (and nothing else) to the
    `learn-assessor` agent, then `learn.py grade <aid> --outcome …`. Report its verdict honestly, and add
    your 1–10 depth rating for the map. The rating is yours, but the right/wrong call is the grader's.
    (Protocol: `~/.claude/skills/teach/references/retention.md`.)
  - Teach the missed piece in 2–4 sentences (this is not a `teach` session — keep it tight).
  - **Immediately log** the verbatim question, answer, verdict and rating to `user-knowledge.md`.
  - If the answer exposed a real gap (not a slip), add one bullet to `LEARNING-PLAN.md` **and** mark it
    in the retention layer as untaught: `learn.py item add` with `"state": "needs_teaching"` on that
    concept. `/tutor` never drills it; it surfaces as "teach next".
  - Adapt: strong answer → next question harder; weak → hold level or step back one.

**4 — Content focus.** Orchestrator-level concerns: systems, architecture, failure modes,
security, data modelling, scaling, cost/economics, product strategy, and the specific
trade-offs baked into *this* project. **Not** syntax, API trivia, or "what does this keyword do".

**5 — After Q7.** Append a summary block to `user-knowledge.md`: per-question scores, overall
rating, recurring patterns, genuine strengths, and the ranked gap list. Then show the user the
updated `LEARNING-PLAN.md` and offer: "want me to `teach` the top gap now?"

## Rules

- Rate like a tough mentor who respects the user's time, not a cheerleader.
- A "gap" is a concept they can't reason from first principles — not a fact they happened not to
  recall. Don't pad the plan.
- Never invent a score to be encouraging. If a round is weak, the summary says so plainly.
- Keep every turn short. The value is the map, not the lecture.
