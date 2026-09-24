# Quiz Design Rules

## Open-Response Only (CRITICAL)

Every quiz question is answered by the user **in their own words**. There are no answer options, ever — no multiple choice, no AskUserQuestion for questions. Post the questions as plain text; wait for the user's typed answers; then grade.

## Zero-Hint Policy (CRITICAL)

Every question must be answerable ONLY by someone who actually knows the material.

1. **Question phrasing**: Ask about behavior/purpose/output/cause, don't hint at the answer
   - BAD: "Which error stream does error() use?"
   - GOOD: "Where does the error() method's output go, and why?"
2. **Make it un-guessable**: with no options to eliminate, a vague question gets a vague answer. Anchor each question to a concrete scenario.
3. **Ask for reasoning**: "…and why?" — a correct verdict with wrong reasoning is not a pass.

## Question Types

1. **Conceptual understanding**: "Why does the system use X pattern?"
2. **Behavioral prediction**: "What happens when X fails?"
3. **Comparison/distinction**: "What is the difference between X and Y, and when does it matter?"
4. **Debugging scenario**: "Given this error, what is the most likely cause?"
5. **Factual recall**: use sparingly, only for genuinely load-bearing facts.

## Difficulty Balancing

- Diagnostic: easy 40%, medium 40%, hard 20%
- Weak-area drill: medium 30%, hard 70%
- Review: all levels evenly

## Drilling Unresolved Concepts

When targeting 🔴 concepts from concept files:
- Do NOT repeat the exact same question — rephrase in a new context
- Test the same underlying knowledge from a different angle
- E.g., if user confused "400 vs 422", give a new scenario where they must say which status code applies and why

## Format

- 4 questions per round, plain text, numbered Q1–Q4
- User answers each in free text

## Grading Protocol

After the user answers:
1. Results table: question / correct answer / user's answer / ✓ / ✗ / partial
2. For wrong or partial answers: name the misconception behind what they wrote, then give the correct understanding
3. Update `concepts/{area}.md` — add/update concept rows + error notes
4. Update dashboard — recalculate area stats from concept files
5. Badges: 🟥 0-39% · 🟨 40-69% · 🟩 70-89% · 🟦 90-100% · ⬜ no data

## Language Rule

All file content and output in the user's detected language. Badge emojis are universal.
