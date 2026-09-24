# Teaching from a source (video, PDF, article, book chapter)

When the learner brings a source — "teach me this YouTube video", "I need to understand this PDF", "help me with this chapter" — the process does not change. Probe → plan → teach runs exactly as always. What changes is **where the material comes from** and **one extra risk to manage**.

## The core idea: the source's order is not the teaching order

This is the whole reason to route a source through `teach` instead of just reading it.

A video, a chapter, or a lecture is written in the **author's** order — narrative order, historical order, or whatever fit their runtime. That order is almost never the dependency order, and it is never adapted to *this* learner's existing knowledge. It teaches things they already know, skips the one prerequisite they're missing, and presents derived results before the truths they rest on.

So: **extract the content from the source, then rebuild the dependency graph from scratch.** In Phase 2 you plan the DAG against the *material*, not against the source's table of contents. Expect the teaching order to differ substantially from the source order — if your plan mirrors the source's sequence exactly, you probably didn't do the work.

State this to the learner when you present the plan: "the video does X → Y → Z; we'll do Y → X → Z, because Z rests on Y and you already have X."

## Step 1 — Ingest

Everything lands in `StudyVault/<Area>/_sources/<slug>.md`. Do this before Phase 1.

### YouTube

```bash
python ~/.claude/skills/teach/scripts/ingest.py "<url>" "<vault>/StudyVault/<Area>/_sources/<slug>.md"
```

On Windows, if bare `python` opens the Microsoft Store stub, call your real interpreter by its full path instead.

Pulls the captions (manual track preferred over auto-generated), strips YouTube's rolling-caption duplication, and writes the transcript with `**[mm:ss]**` markers every 30 seconds. Those markers matter — cite them when you teach ("the derivation at [07:30]") so the learner can jump back to the exact moment.

If the video has no captions at all, the script says so. There is no local transcription (no ffmpeg/whisper installed), so in that case ask the learner for another source or teach the topic from research instead.

### PDF

```bash
python ~/.claude/skills/teach/scripts/ingest.py "<file.pdf>" "<vault>/StudyVault/<Area>/_sources/<slug>.md"
```

Uses `pdftotext -layout`, with `**[p.N]**` page markers. Cite page numbers when teaching.

**Caveat — two-column PDFs.** `-layout` preserves visual columns, which for academic two-column papers can interleave the two columns line by line into nonsense. **Read the output before teaching from it.** If it looks interleaved, re-extract without layout preservation:

```bash
pdftotext -enc UTF-8 "<file.pdf>" "<out.txt>"
```

Scanned PDFs (images, no text layer) produce an empty or near-empty file. There's no OCR installed — say so rather than teaching from a broken extraction.

### Web article

No script. Use `WebFetch`, then write the returned content to the same `_sources/` path yourself so the lesson stays reproducible.

### A physical book, or something you can't extract

Fine — the learner reads it, and you teach from research plus what they report. Say clearly that you're working from the topic rather than from their specific text, since the source's own framing and notation may differ.

## Step 2 — Read it fully, before probing

Read the whole extracted file. Not a skim, not the first 200 lines — you cannot plan a dependency graph over material you've only seen part of.

While reading, build three lists:

1. **The claims the source makes** — what it's actually trying to establish.
2. **The prerequisites it assumes silently** — the things it uses without explaining. This is where learners get stranded, and it directly seeds the Phase 1a probe: probe each assumed prerequisite, because the source will not.
3. **The unconditional truths it rests on** — often unstated, because the author took them for granted. These become your roots, and they frequently do not appear in the source at all.

## Step 3 — Verify the source

**A source is evidence, not authority.** This is the extra risk that isn't there when you teach from research: the learner has handed you a text and implicitly asked you to trust it, and popular explainers in particular trade accuracy for punchiness.

Fire a `researcher` agent on the source's central claims before planning. Then:

- **Wrong claim** → say so plainly, with the correction and a source, before teaching that part. Never quietly teach the correct version while pretending the source said it.
- **Oversimplification** → teach the accurate version and name the simplification explicitly. The learner will hit the discrepancy later otherwise, and it will unpick everything hung off it.
- **Terminology that differs from the standard** → flag it, so they can read other material without confusion.

Getting this wrong is worse than the usual hallucination risk, because the learner has the source open in front of them and will trust the mismatch in the wrong direction.

## Step 4 — Probe, plan, teach as normal

From here it is the standard process, with these adjustments:

- **Phase 1a** probes the source's *assumed* prerequisites first — that's the highest-yield place to find the edge, because it's exactly where the source will fail them.
- **Phase 1b** matters more than usual and has a specific question to answer: **why this source?** "Understand the whole video" and "understand the one part at 12:00 that lost me" are completely different lessons. Ask which it is. Very often they only need one segment, and the honest answer is a 15-minute lesson instead of a 90-minute one.
- **Phase 2** presents the dependency map *and* the reordering, with the reason for it (see the top of this file). Link back to the source file: `[[<slug>]]`.
- **Phase 3** cites `[mm:ss]` / `[p.N]` at each node, so the lesson stays anchored to material they can re-open.
- **Phase 4** notes which parts of the source are now covered — a source is rarely finished in one session, and the next session should resume rather than restart.

## Front matter for a source-based lesson

```markdown
---
area: Networking
date: 2026-08-25
source: "[[how-i-use-ai-to-learn]]"
source_type: youtube
coverage: 00:00–08:30
goal: ...
---
```

`coverage` is what makes resuming possible. Keep it updated as you go.
