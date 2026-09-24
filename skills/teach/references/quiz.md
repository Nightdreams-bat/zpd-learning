# Quiz — the graded open-response question

The original system had a dedicated `quiz` tool: the learner picked an option and got instant ✓/✗. Claude Code has no such tool, and **we do not use multiple choice at all**. A quiz here is a **plain-text question you ask in your message, which the learner answers in their own words**. You then grade that free-form answer in your very next message.

Grading is your job, and it is mandatory. **A quiz that isn't graded in your very next message is not a quiz — it's a survey, and it teaches nothing.**

## The two shapes, and never confuse them

| | **Quiz** | **Open fork** |
|---|---|---|
| Has a correct answer | Yes | No |
| Purpose | Locate the edge / confirm a node landed | Learn a preference or direction |
| Example | "What does a TCP sequence number identify?" | "Want the math derivation or the intuition first?" |
| How you ask it | Prose question in your message; they type a free answer | `AskUserQuestion` tool |
| After the answer | **Grade it: ✓/✗, correct answer, explanation** | Just act on it; never grade |
| Tracked in the vault | Yes — every answer updates the concept file | No |

If a question has a definite right answer, it is a quiz, even when you're using it Socratically to let them discover something. Gradable-and-Socratic is the normal case, not a contradiction.

`AskUserQuestion` is **only** for open forks. Never use it to pose a quiz, and never hand the learner answer options to choose between.

## Presenting a quiz

- Ask **1–2 questions at a time** during Phase 1a probing, so you can adapt difficulty to the last answer — binary-searching the edge is impossible if you fire a fixed batch at once. A broader sweep can be 3–4, still all open-response.
- Number them (`Q1`, `Q2`) and put each on its own line so the answer is easy to give.
- Ask about behaviour, purpose, cause, or a distinction — phrase it so it can only be answered by someone who knows the material.
- **No hints in the stem.** BAD: "Which error stream does `error()` use?" GOOD: "Where does `error()` output go?"
- Ask for the reasoning, not just the verdict: "…and why?" A bare right answer with wrong reasoning is a miss.

## Writing good open-response questions

1. **Aim at the node, not trivia.** One question per node of the dependency graph, phrased as the thing understood.
2. **Make it un-guessable.** With no options to eliminate, a vague question gets a vague answer. Pin it to a concrete scenario: "Given X happens, what does the system do, and why?"
3. **Prefer "why" and "what happens when" over "what is".** Definitions can be parroted; consequences and mechanisms can't.
4. **One idea per question.** If you need two things confirmed, ask two questions.

## Question types to draw from

1. **Conceptual understanding** — "Why does the system use X?"
2. **Behavioural prediction** — "What happens when X fails?"
3. **Comparison/distinction** — "What's the difference between X and Y, and when does it matter?"
4. **Debugging scenario** — "Given this error, what's the most likely cause?"
5. **Factual recall** — use sparingly, only when the fact is genuinely load-bearing.

Phase 1a difficulty is adaptive by definition — binary-search the edge rather than following a fixed easy/medium/hard mix.

## Grading — your next message, always

Immediately after their answer comes back:

1. **Verdict line**: ✓ or ✗ (or "partial"), restating what they got right and what's missing or wrong.
2. **Explanation** — for a miss, name *the belief that produced that specific wrong answer* and why it fails, not just the correct answer. What they said is the diagnostic; use it. For a hit, one line confirming *why* it's right, so the connection is reinforced, not just the fact. For a partial, close the gap explicitly.
3. If they missed, **the node is not solid.** Do not build on it. Go back, re-motivate, re-establish, re-check.
4. **Write it to the concept tracker** — see `vault.md`.

For a multi-question round, a small table reads best:

```markdown
| # | Question | Their answer | Correct? | Note |
|---|----------|--------------|----------|------|
| 1 | ...      | ...          | ✓        | ...  |
```

## Drilling a concept they already missed

Do **not** re-ask the same question — test the same underlying knowledge from a different angle, in a new context. If they confused "400 vs 422", give a fresh scenario where they must say which applies and why, not the same definition question again.
