import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceTitle } from "../src/core/graph.ts";

test("a notes source shows its file name without folder or extension", () => {
	assert.equal(sourceTitle("/vault/learn vim.md"), "learn vim");
	assert.equal(sourceTitle("D:\Notes\Topology.txt"), "Topology");
	assert.equal(sourceTitle("notes/lecture 3.pdf"), "lecture 3");
	assert.equal(sourceTitle("My notes"), "My notes");
});

test("a name that would reduce to nothing falls back to the original", () => {
	assert.equal(sourceTitle("/vault/.md"), "/vault/.md");
});
