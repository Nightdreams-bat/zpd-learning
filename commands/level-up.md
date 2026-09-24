---
description: Adaptive assessment that maps your technical/product knowledge gaps and grows a learning plan. Usage: /level-up [topic]
---

The argument is: `$ARGUMENTS`

Load the `level-up` skill and run a fresh assessment round.

- If `$ARGUMENTS` names a topic, scope the questions to it.
- Otherwise scope to the current project (read its README and any project notes).
- 7 questions, one at a time, plain text, honest 1–10 ratings, log each answer verbatim to
  `<vault>/Learning/user-knowledge.md` as you go.
- Genuine gaps go to `<vault>/Learning/LEARNING-PLAN.md`.
- After Q7: summary block + show the updated plan + offer to `teach` the top gap.
