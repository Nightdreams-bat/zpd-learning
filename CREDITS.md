# Credits

## `teach`, `visualize`: from `amosblomqvist/learn` by Eero Alvar

Ported from <https://github.com/amosblomqvist/learn>, the system shown in
[How I Use AI to Learn Things](https://youtu.be/kzcI5F4tGiU). The teaching philosophy (the two
principles, the dependency-graph model of understanding, and the probe → plan → teach shape) is his.
The upstream repo is shared as-is without a license file, so the original ideas and wording remain
his. This repo adapts them for Claude Code: graded open-response quizzes in place of the `quiz`
extension, vault writes in place of `md-log`, a Claude Code `researcher` agent, and source ingestion.

## `tutor`, `tutor-setup`: from `bevibing/tutor-skills` (MIT © 2026 tak)

From <https://github.com/bevibing/tutor-skills>. The original MIT license is kept in
`skills/tutor/LICENSE` and `skills/tutor-setup/LICENSE`. Modified here: open-response questions in
place of multiple choice, grading that names the misconception, and a struggle-rate dashboard shared
with `teach`.

## Mine

`level-up`, `commands/level-up.md`, `agents/researcher.md`, `teach/scripts/ingest.py`, the shared
learner model between the skills, the installers, and the ZPD / adaptive-testing / learner-model
framing. MIT, see `LICENSE`.
