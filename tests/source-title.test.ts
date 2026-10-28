import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceTitle } from "../src/core/graph.ts";

test("imported-note sources show only their title: no source tag, folder, date or extension", () => {
	assert.equal(sourceTitle("obsidian__concepts__Math for AI.md"), "Math for AI");
	assert.equal(sourceTitle("notion__JKU__2026-10-07 - AI Lecture 1 - What is Artificial Intelligence.md"), "AI Lecture 1 - What is Artificial Intelligence");
	assert.equal(sourceTitle("obsidian__Claude Code__2026-08-26 - Beginner hacks (32 tricks video).md"), "Beginner hacks (32 tricks video)");
	assert.equal(sourceTitle("obsidian__Brain__Learning__Agentic Workflow Field Manual.md"), "Agentic Workflow Field Manual");
});

test("plain file names and paths just lose the directory and extension", () => {
	assert.equal(sourceTitle("My notes.md"), "My notes");
	assert.equal(sourceTitle("D:\\Notes\\Topology.txt"), "Topology");
	assert.equal(sourceTitle("notes/2026-01-02 - Sets.md"), "Sets");
	assert.equal(sourceTitle("weird__name.md"), "weird__name", "only the import convention's prefixes are unpicked");
});

test("a name that would reduce to nothing falls back to the original", () => {
	assert.equal(sourceTitle("2026-01-02 - .md"), "2026-01-02 - .md");
});
