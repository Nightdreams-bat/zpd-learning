---
name: tutor
description: >
  Spaced-retrieval drill for the StudyVault (learning system v3). Use when the user wants to:
  (1) do their due reviews, (2) quiz/drill/practice, (3) re-solve math or coding problems cold,
  (4) take the closed-book checkpoint, (5) check they understand a change Claude made to their code,
  (6) see their learning dashboard — or says "quiz me", "test me", "let's study", "reviews",
  "/tutor", "학습", "퀴즈", "평가".
---

# Tutor (v3): spaced retrieval with blind grading

`teach` builds understanding. `tutor` keeps it: it serves what is due, the learner **produces** answers from memory, an independent grader marks them, and `learn.py` schedules the next review with FSRS-6.

**Read `~/.claude/skills/teach/references/retention.md` at the start of every session.** It holds the command cookbook, the blind-grading protocol and the hint rules. Also read `~/.claude/skills/teach/references/engagement.md` for tone.

```
LEARN = uv run "~/.claude/skills/teach/scripts/learn.py"
```

Hard rules:
- **Never compute dates, intervals or stages yourself.**
- **Never grade a scheduled answer yourself.** The `learn-assessor` does, from the payload alone.
- **Never multiple choice. Never show the key before the answer is saved.**
- **Never write the vault's concept tables or dashboard by hand.** `LEARN render` generates them.

## Phase 1: open the session

1. Run `LEARN pending`. If there are answered-but-ungraded attempts, grade those first (Phase 4), because they're owed.
2. Run `LEARN queue`. It returns the due items (lowest recall first, already interleaved), `est_minutes`, `notes`, and `teach_next` / `checkpoint_due` when relevant. If the vault or the script errors, show the error and stop.
3. Offer a menu with **AskUserQuestion**. This is the one allowed use: a menu choice with no right answer, never a quiz. Pick the 4 most relevant options, with the recommended one first:
   - **Due reviews (~N min)**: the default when anything is due.
   - **Checkpoint**: only when `checkpoint_due`. It's closed-book and timed, about 20 min.
   - **Problems**: `--mode problems`, 1–2 cold re-solves of math or code.
   - **Quick (5 min)**: `--mode quick`.
   - **Level up a concept**: Practice or Apply tasks on a concept at Understand or Practice (Phase 5).
   - **Teach next**: when `teach_next` lists untaught gaps. Hand these to the `teach` skill; they aren't drills.
   - **Explain a change**: comprehension check on a diff Claude wrote (Phase 6).

   Nothing due and no checkpoint? Say so plainly and offer Problems, Level up, or Teach next.

## Phase 2: ask

- **Before showing each item, run `LEARN attempt start --item <id>`** and keep its `attempt_id`.
- Show only the item's `prompt`. Facts and concepts can come in rounds of up to 3 (Q1–Q3, one per line). Problems come **one at a time**.
- Say once per session: *"From memory: no scrolling up, no notes, no asking me. If you want a hint, ask for one; it's allowed but it counts as a miss for scheduling. Optional: end an answer with `!s` if it was a struggle or `!i` if it was instant."*
- **Code problems:** ask the learner to write the solution to a file (e.g. `scratch/<item>.py`) or paste it. Save pasted code to a file yourself, then run `LEARN check <aid> --solution <file>`. The test result goes to the grader as evidence. `infra_error` means the tests or runner broke, not the learner: say so and grade `ungradable`.
- **Math:** answers come as LaTeX/text in chat, or as a photo of paper work. Pass the photo path as `--artifact`.
- **Hints:** use the ladder from `retention.md` (nudge → key idea → one worked step). Any rung used → `--assisted`.

## Phase 3: record before grading

For every answer, **before anything else**:
1. Write the learner's verbatim answer (minus any `!s` / `!i` tag) to a scratch file.
2. `LEARN attempt answer --id <aid> --file <f> [--self struggled|instant] [--assisted] [--artifact <path>]`

If the learner stops mid-item ("skip", "later", "gtg"), run `LEARN attempt abandon --id <aid>`. It's not a failure.

## Phase 4: blind grading

For each recorded answer:
1. `LEARN payload <aid>` gives you the JSON.
2. Spawn `learn-assessor` with **only** that JSON. If that agent type isn't available in this session, use a `general-purpose` agent on `sonnet` with the prompt: `Read ~/.claude/agents/learn-assessor.md and follow it exactly. Payload:` + the JSON. For a round of several answers, spawn the graders in parallel, one per answer.
3. `LEARN grade <aid> --outcome <outcome> [--misconception "<quote>"] [--note "<missing_core_idea>"]`
4. Show the results as a table: `| # | Verdict | What was missing / wrong | Next review | Stage |`. Use the grader's feedback and the `next_due_local` / `concept_stage` that `grade` printed. If a concept climbed a stage, say so in one line.
5. **Dispute:** if the learner, or you, thinks a verdict is wrong, run a *fresh* grader on the same payload, then `LEARN grade <aid> --outcome … --regrade`. The second verdict stands. If the **key** was the problem, fix it with `LEARN item revise` and say so.
6. **Misses:**
   - The grader's feedback is the correction. Add the one-line "why" if it helps the idea connect.
   - For a missed **problem**, offer a `mistake` item on that exact trap: a draft with `spawned_from`, key verified, then activated.
   - If `grade` says the item was **suspended (leech)**, don't drill it again. It needs a teach pass on its prerequisites; offer one.

## Phase 5: level up (Practice and Apply)

Re-passing the same card doesn't prove fluency or transfer. The script requires different tasks:
- **To reach Practice** (concept at Understand): pose a **variant**, i.e. the same idea in new numbers or a new context, or ask for a second item on the concept. Use `attempt start --concept <cid> --kind variant --prompt "<the question>"`. **Before asking**, write the key, rubric and alternatives to a `k.json` grounded in the concept's verified item key. Grade with `payload <aid> --key-file k.json`.
- **To reach Apply** (concept at Practice): an **unseen** scenario. Examples: their own trading plan or Pine script, a Claude Code setup, a degree exercise, or "critique this flawed use". Use `--kind apply`, with the same key-first rule. Never re-show an Apply task verbatim later.
- If a variant or apply task relies on facts that aren't in the verified key, check them with a `researcher` agent before freezing `k.json`.

## Phase 6: explain a change (AI-code comprehension check)

Only when the learner asks. It's never automatic.
1. Take the diff, e.g. `git diff` or the last commit.
2. **Before asking**, write `k.json` with what the change does, why, and one risk.
3. Ask: "Explain what this change does and why it's safe (or not)."
4. `attempt start --concept <cid> --kind probe --prompt …` (make or reuse a concept for that codebase area), record the answer, grade blind.
5. A miss: offer a `concept` item so the idea gets reviewed.

## Checkpoint (the headline metric)

Every 14–21 days. The script says when (`checkpoint_due`).
1. `LEARN checkpoint` returns a stratified random sample of items first learned ≥14 days ago, *whatever* their review history, plus `session_id` and `eligible`. Use `--baseline` the first time. If it says there are too few eligible items, that's the result; say so.
2. Add 2–3 **unseen matched problems** per active degree course as `--kind transfer --concept <cid> --session <sid>`, with the key written first.
3. Rules, stated up front: **timed (≈20 min), closed book, no AI, no hints.** Show all the prompts at once. Start each attempt with `--kind checkpoint --session <sid>` when you show it, then record and grade blind as usual.
4. Report the score as **correct / graded, with n and eligible**, e.g. "9/12 graded (eligible 40)". Name the weakest area. This number, not in-session hit rate, is how the system is judged.

## Phase 7: close

1. `LEARN render`.
2. One-line summary: items done, correct/graded, what's due next (from `LEARN queue` or `due`), and anything suspended or pending.
3. **Engagement:** grades are fixed, but the *session shape* isn't. After two misses in a row, switch to an easier item type or stop early with a win. After a string of instant hits, offer Level up. Praise the reasoning specifically, never "great job".

## Notes

- The vault is `<vault>/StudyVault/`. The script finds it itself, so there's no need to glob for it.
- Teach in English (see `teach`).
- No streaks, no gamified counts. The only numbers shown are the ones `learn.py` prints.
