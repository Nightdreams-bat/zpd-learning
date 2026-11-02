import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildVisualizeIndex,
	buildVisualizeRequest,
	MAX_VISUALIZE_PASSAGE,
	parseVisualizeRequest,
} from "../components/visualize.tsx";
import { MOTION_KIT_JS, withMotionKit } from "../src/core/motion-kit.ts";

test("a visualize request round-trips scope, concept, and passage", () => {
	const text = buildVisualizeRequest({
		scope: "selection",
		passage: "f maps 2 to 5.\nEvery x gets one arrow.",
		concept: { title: "Functions as mappings", summary: "inputs to outputs" },
	});
	assert.ok(text.startsWith("[visualize] selected passage"));
	assert.deepEqual(parseVisualizeRequest(text), {
		scope: "selected passage",
		concept: "Functions as mappings — inputs to outputs",
		passage: "f maps 2 to 5.\nEvery x gets one arrow.",
	});
	assert.equal(parseVisualizeRequest("plain message"), null);
});

test("the passage is capped so a request never ships a whole lesson", () => {
	const text = buildVisualizeRequest({ scope: "step", passage: "x".repeat(MAX_VISUALIZE_PASSAGE * 3) });
	assert.ok(parseVisualizeRequest(text)!.passage.length <= MAX_VISUALIZE_PASSAGE + 2);
});

test("teaching text belongs to the next check's node; a sub-lesson ends where checks move on", () => {
	const quiz = (nodeId: string) => ({ type: "tool-quiz", input: { nodeId } });
	const text = (t: string) => ({ type: "text", text: t });
	const idx = buildVisualizeIndex([
		{ role: "assistant", parts: [text("intro to A"), quiz("a")] },
		{ role: "user", parts: [text("answer")] },
		{ role: "assistant", parts: [text("more A"), quiz("a"), text("now B"), quiz("b")] },
		{ role: "assistant", parts: [text("still B, no check yet")] },
	]);
	assert.equal(idx.nodeOfText.get("0:0"), "a");
	assert.equal(idx.nodeOfText.get("2:0"), "a");
	assert.equal(idx.nodeOfText.get("2:2"), "b");
	assert.equal(idx.nodeOfText.get("3:0"), "b");
	assert.deepEqual([...idx.sublessonEnds], [[2, ["a"]]]); // b is still in progress
});

test("the motion kit parses and is injected before scene code", () => {
	assert.doesNotThrow(() => new Function(MOTION_KIT_JS));
	const html = withMotionKit("<html><head><title>t</title></head><body><script>LH.scene()</script></body></html>");
	assert.ok(html.indexOf("window.LH=LH") < html.indexOf("LH.scene()"));
	assert.ok(withMotionKit("<script>x</script>").startsWith("<script>"));
});
