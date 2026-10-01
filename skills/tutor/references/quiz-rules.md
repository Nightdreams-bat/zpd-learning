# Quiz design rules (tutor v3)

Items are written once, verified and frozen (see `~/.claude/skills/teach/references/retention.md` → "Writing an item"). These rules cover the questions `tutor` composes on the fly: **variants**, **apply** and **transfer** tasks, and **explain-a-change** probes.

## Always

1. **Production, never recognition.** The learner writes the answer, derivation or code. No options, no yes/no.
2. **No hints in the stem.** BAD: "Which error stream does error() use?" GOOD: "Where does error() output go, and why?"
3. **Anchor to a concrete scenario** so a vague answer can't pass.
4. **Ask for the reason** ("…and why?"). A right verdict with wrong reasoning is a miss.
5. **One idea per question.** Split it if the rubric would need two unrelated ideas.
6. **Key first.** Write `k.json` (key, rubric with the core idea or required steps, accepted alternatives) *before* asking. The grader grades against it blind.

## By purpose

| Purpose | Shape |
|---|---|
| **Variant** (→ Practice) | Same core idea, new numbers or context. Solvable fast by someone fluent. |
| **Apply** (→ Apply) | Unseen situation from the learner's world (trading plan, Pine script, Claude Code setup, degree exercise), or "critique this flawed use". The learner must decide *whether and how* the idea applies. |
| **Transfer** (checkpoint) | An unseen problem matched in difficulty and family to taught ones. |
| **Explain-a-change** | "What does this diff do, why, and what could break?" |

## Math and code

- Math rubrics list the **required steps**, not only the final answer. A valid alternative method counts.
- Code items use tests (`LEARN check`). Tests passing is necessary. If the prompt also asks for an explanation, the explanation is graded too.
- For the same concept, **vary the surface** (numbers, names, context) and keep the method. For discrimination practice, **vary the method** across neighbouring families, e.g. substitution vs parts, or two-pointer vs hash map.

## Drilling a concept that was missed

Never re-ask the same question verbatim. Test the same idea from a new angle, in a new context.
