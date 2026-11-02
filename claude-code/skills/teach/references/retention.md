# Retention layer (v3): items, blind grading, FSRS

Shared by `teach`, `tutor` and `level-up`. The evidence and design notes are in the project history.

## The one rule

**You never compute a date, an interval, a stage or a statistic.** `learn.py` does. You call it and read its JSON. If you catch yourself writing "next review in 3 days" from your own head, stop and run the command.

```
LEARN = uv run "~/.claude/skills/teach/scripts/learn.py"
```

Every command prints JSON. When a command fails, it prints `error: …` to stderr and exits 2. **Show the learner the error and stop.** Don't work around it: the refusals are deliberate (duplicate grade, stale attempt, vault missing, malformed log).

## Why it's built this way (the evidence in one breath)

- Spaced retrieval with feedback is the best-supported technique. Retrieval means *producing* the answer, not recognising it.
- For math and code, retrieval has to mean **regenerating the solution**, not recalling words. Skills also need interleaving and feedback-rich practice at the edge of ability.
- Learners misjudge fluency. So the system is judged only by **delayed, unassisted checkpoints**, and the teacher never grades its own teaching into the schedule.
- Answer-giving AI lowers unassisted performance (Bastani 2025, *PNAS*). So hints are laddered, and any help marks the attempt `assisted`.

## Data model

- **Concept** = one node of a lesson DAG. It carries the **stage**: 0 untaught, 1 Discover, 2 Understand, 3 Practice, 4 Apply.
- **Item** = one retrieval task on a concept. FSRS schedules items. Items have four types:
  - `fact`: produce a definition, notation or API detail.
  - `concept`: explain from memory why something is true, or predict what happens.
  - `problem`: re-solve cold. The key is a full worked solution, and code problems carry pytest tests.
  - `mistake`: re-attempt one specific trap you fell into. Max 1 per source item.
- **Item states:**
  - `draft`: not scheduled yet.
  - `needs_teaching`: a gap that nobody has taught yet. It is never quizzed and surfaces as "teach next".
  - `active`: scheduled by FSRS.
  - `suspended`: a leech with 4 lapses. It needs a teach pass on its prerequisites, then goes back to `active`.
- **Attempt kinds:**
  - `scheduled` and `checkpoint` move FSRS.
  - `variant`, `apply`, `transfer` and `probe` are concept-level. They are graded, count toward the stage, and never touch FSRS.
- **Formative** checks (teach's in-lesson quiz-checks) are logged with `formative` and never scheduled.

## Stage rules (enforced by the script)

| To reach | Needs |
|---|---|
| 1 Discover | taught in a lesson |
| 2 Understand | a passed in-lesson (formative) check **and** a passed delayed recall (≥ next day) |
| 3 Practice | ≥2 *different* items or variants passed on ≥2 different days, unassisted |
| 4 Apply | an *unseen* `apply` or `transfer` task passed while at Practice |

Failing at or below the current stage drops the stage by one. Failing a stage-up attempt is normal and changes nothing.

## Writing an item (the quality bar)

A bad key poisons the schedule, so every item passes this bar before it can go `active`. The script refuses anything else.

1. **The prompt asks for production.** Write "Explain why…", "Derive…", "Write the function…", "What happens to X when Y doubles, and why?". Never "Which of these…", and never a yes/no. No hints in the stem.
2. **The key is complete and correct.** For problems it is the full worked solution. For concepts it is the explanation a strong student would give.
3. **The rubric names the core idea(s) or the required steps.** Those are what a correct answer *must* contain. One idea per item, and split the item if the rubric has two unrelated ideas.
4. **`accepted_alternatives`** lists other valid methods you can foresee.
5. **Verify before freezing.** Check the key against the lesson and the source. Any non-trivial claim goes to a `researcher` agent. For code, the reference solution must pass the tests and a stub must fail them: `LEARN check-item <id> --reference ref.py --stub stub.py`. Then set `"verified": {"by": "...", "sources": [...], "date": "YYYY-MM-DD"}`.
6. **Tag it for interleaving.** `family` is the method or problem type, e.g. "integration by parts", "two-pointer", "position sizing". `course` and `week` are for degree courses. Word-list vocabulary gets `"tags": ["wordlist:<name>"]` so it stays grouped, because blocking wins for word lists.
7. **Arbitrary facts** (names, conventions, magic numbers) get `"arbitrary": true`, and a mnemonic in the key is fine.

Item JSON (a list is allowed):

```json
{"concept_id": "trading-position-sizing", "type": "problem", "state": "draft", "lesson_id": "l-…",
 "prompt": "You risk $150 per trade on MNQ ($2/pt) with a 25-point stop. How many contracts, and why?",
 "key": "Risk per contract = 25 × $2 = $50. 150/50 = 3 → 3 contracts (loss at stop = $150).",
 "rubric": "Risk per contract = stop × point value; budget ÷ that; round DOWN.",
 "accepted_alternatives": ["Testing counts directly against the budget."],
 "family": "position sizing", "verified": {"by": "claude+lesson", "sources": ["Trading/2026-08-30 - risk.md"], "date": "2026-09-27"}}
```

## Command cookbook

| Moment | Command |
|---|---|
| lesson opens | `LEARN lesson start --area Trading --path "Trading/2026-09-28 - topic.md"` → `lesson_id` |
| new node | `LEARN concept add --area Trading --name "why stops slip" --lesson "Trading/…md" --stage 1` |
| in-lesson quiz-check graded | `LEARN formative <concept_id> --outcome correct\|incorrect --note "…"` |
| draft an item at the node's lock | write JSON → `LEARN item add --json <file>` |
| fix a draft / key | `LEARN item revise <item_id> --json <fields.json>` (bumps rev; open attempts go stale) |
| lesson close | `LEARN lesson finalize --id <lesson_id>` (activates verified drafts; lists what blocks) |
| session queue | `LEARN queue [--mode due\|quick\|problems] [--minutes N]` |
| ask one item | `LEARN attempt start --item <id> [--kind checkpoint --session <sid>]` → `attempt_id` |
| record the answer (before grading) | save verbatim to a file → `LEARN attempt answer --id <aid> --file <f> [--self struggled\|instant] [--assisted] [--artifact <photo>]` |
| run code tests | `LEARN check <aid> --solution <file>` |
| blind payload | `LEARN payload <aid> [--key-file k.json]` → give this JSON, and nothing else, to `learn-assessor` |
| record the grade | `LEARN grade <aid> --outcome correct\|incorrect\|ungradable --misconception "…" --note "…"` |
| learner disputes | fresh `learn-assessor` on the same payload → `LEARN grade <aid> --outcome … --regrade` |
| paused mid-answer | `LEARN attempt abandon --id <aid>` (not a failure) |
| answered but never graded | `LEARN pending` — grade these first next session |
| concept-level task (variant/apply/transfer/probe) | `LEARN attempt start --concept <cid> --kind apply --prompt "…"`, then write the key to `k.json` **before asking** (`{"key":…,"rubric":…,"accepted_alternatives":[…]}`) and use `payload <aid> --key-file k.json` |
| checkpoint | `LEARN checkpoint [--baseline]` → sampled item ids + session id |
| views | `LEARN render` (dashboard.md + concepts/*.md). `LEARN stats`, `LEARN list [--area A] [--state draft] [--concepts]`, `LEARN show <id>` |
| something looks wrong | `LEARN doctor` |

## Blind grading protocol

1. The learner answers. **Save the answer verbatim before anything else** (`attempt answer`). The optional self-report (`struggled` / `instant`) is captured *before* the verdict is shown. That is the only effort signal. The grader never judges effort.
2. `LEARN payload <aid>` is the grader's whole world. Spawn the grader with `Agent(subagent_type="learn-assessor", prompt=<the payload JSON>)`. If that agent type isn't registered in the session, use `general-purpose` with the prompt "Read ~/.claude/agents/learn-assessor.md and follow it exactly. Payload:" + the payload. **Never add lesson context, your own opinion, or past grades.**
3. The grader returns JSON. Record its `outcome` with `grade`, including `misconception` if it gave one. If the reply isn't valid JSON, retry once. After that, leave the attempt pending (`LEARN pending` shows it) and move on.
4. Show the learner the verdict and the grader's feedback, plus the `next_due_local` and `concept_stage` that `grade` printed. **Don't soften or overrule the grader.** If you think it's wrong, say so and offer a regrade by a fresh grader, or revise the key if the key was the problem.
5. The mapping to FSRS is the script's job: incorrect or assisted → Again, otherwise Good, with Hard or Easy only from the self-report.

## Hints and assistance (the Bastani guard)

Hints come as a ladder: a nudge, then the key idea, then one worked step. **Never the full solution** unless the learner explicitly asks. Any rung used → `--assisted` on `attempt answer`, which schedules the item as a miss so it comes back soon. On assessed degree work (homework), assisted problems become `draft` problem items to re-solve cold later.
