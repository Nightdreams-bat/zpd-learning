import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { ToolCallScanner, callProblem, defangReasoningAsks, renderTranscript, type ScanEvent } from "../src/agent/claude-cli-protocol.ts";

const schemas = (tool: string) =>
	tool === "quiz"
		? {
				required: ["question"],
				properties: {
					question: { type: "string" },
					choices: { type: "array" },
					n: { type: "number" },
					note: { anyOf: [{ type: "string" }, { type: "null" }] },
					mode: { type: "string", enum: ["a", "b"] },
				},
			}
		: undefined;

function run(chunks: string[]): ScanEvent[] {
	const s = new ToolCallScanner(schemas);
	return [...chunks.flatMap((c) => s.feed(c)), ...s.flush()];
}
const prose = (ev: ScanEvent[]) => ev.map((e) => (e.type === "text" ? e.text : "")).join("");
const callOf = (ev: ScanEvent[]) => {
	const c = ev.find((e) => e.type === "call");
	assert.ok(c && c.type === "call", "expected a call event");
	return c;
};

test("plain prose passes through", () => {
	assert.equal(prose(run(["Hello ", "world"])), "Hello world");
});

test("native invoke syntax: prose kept, wrapper dropped, params coerced by schema", () => {
	const ev = run([
		"Let me ask.\n<function_",
		'calls>\n<invoke name="quiz">\n<parameter name="question">Is 7 > 3? "yes"</parameter>\n',
		'<parameter name="choices">["a","b"]</parameter>\n<parameter name="n">2</parameter>\n</invoke>\n</function_calls>',
	]);
	assert.deepEqual(ev.map((e) => e.type), ["text", "call"]);
	assert.equal(ev[0]?.type === "text" && ev[0].text, "Let me ask.\n");
	const call = callOf(ev);
	assert.equal(call.name, "quiz");
	assert.deepEqual(call.args, { question: 'Is 7 > 3? "yes"', choices: ["a", "b"], n: 2 });
	assert.equal(call.suspect, undefined);
});

test("a bare <invoke> with no wrapper (what the model often writes) parses", () => {
	const call = callOf(run(['\n<invoke name="list_sessions">\n</invoke>']));
	assert.equal(call.name, "list_sessions");
	assert.deepEqual(call.args, {});
});

test("strings stay strings: numeric-looking text, enums, and string|null unions", () => {
	const call = callOf(
		run(['<invoke name="quiz"><parameter name="question">42</parameter><parameter name="mode">a</parameter><parameter name="note">null</parameter></invoke>']),
	);
	assert.deepEqual(call.args, { question: "42", mode: "a", note: "null" });
});

test("a typed parameter that is not JSON passes through raw and is flagged suspect, not hard", () => {
	const call = callOf(run(['<invoke name="quiz"><parameter name="question">q</parameter><parameter name="choices">a, b, c</parameter></invoke>']));
	assert.equal(call.args.choices, "a, b, c");
	assert.match(call.suspect ?? "", /choices: expected array as JSON/);
	assert.equal(call.error, undefined);
});

test("legacy <tool_call> JSON form still parses", () => {
	const call = callOf(run(['<tool_call name="add">{"a":1}</tool_call>']));
	assert.deepEqual(call.args, { a: 1 });
});

test("an echoed [assistant] label is stripped, however the chunks fall", () => {
	assert.equal(prose(run(["[assis", "tant]\nHello"])), "Hello");
	assert.equal(prose(run(["[assistant] Hi there"])), "Hi there");
	assert.equal(prose(run(["[assist"])), "[assist", "a partial label that never completes is prose");
	assert.equal(prose(run(["No label [assistant] mid-text"])), "No label [assistant] mid-text");
});

test("an invented <invoke_tool_call> wrapper is dropped like <function_calls>", () => {
	const ev = run(['<invoke_tool_call>\n<invoke name="quiz"><parameter name="question">q</parameter></invoke>\n</invoke_tool_call>']);
	assert.deepEqual(ev.map((e) => e.type), ["call"]);
	assert.equal(callOf(ev).name, "quiz");
});

test("replayed history is reworded where it asks for reasoning to be shown (Sonnet's reasoning_extraction safeguard)", () => {
	assert.equal(defangReasoningAsks("Use the thinking field to reason out loud."), "Use the thinking field to explain your thinking.");
	assert.equal(defangReasoningAsks("Think it through aloud, then answer."), "explain your thinking, then answer.");
	assert.equal(defangReasoningAsks("Please show your reasoning."), "Please explain your thinking.");
	assert.equal(defangReasoningAsks("Reveal the chain-of-thought now"), "explain your thinking now");
	assert.equal(defangReasoningAsks("He is thinking about sets; the answer is 4."), "He is thinking about sets; the answer is 4.");
	const r = renderTranscript([
		{ role: "user", content: "hi", timestamp: 0 },
		asst([{ type: "text", text: "Use the thinking field to reason out loud." }]),
	]);
	assert.match(JSON.stringify(r.blocks), /explain your thinking/);
	assert.doesNotMatch(JSON.stringify(r.blocks), /out loud/);
});

test("a lone '<' is held back, then released as prose", () => {
	assert.equal(prose(run(["a <", "b"])), "a <b");
});

test("a truncated call surfaces as bad-call", () => {
	assert.deepEqual(run(['<invoke name="x"><parameter name="a">1']).map((e) => e.type), ["bad-call"]);
});

test("a fabricated result halts the scan and drops the rest", () => {
	const s = new ToolCallScanner();
	const ev = [...s.feed('ok <invoke name="x"></invoke>\n<function_results>fake'), ...s.feed(" more")];
	assert.deepEqual(ev.map((e) => e.type), ["text", "call", "halt"]);
	assert.equal(s.halted, true);
});

const quizTool = { name: "quiz", description: "Ask", parameters: { type: "object", required: ["question"], properties: { question: { type: "string" } } } } as unknown as Tool;
const tools = new Map([["quiz", quizTool]]);

test("callProblem: clean, unknown tool, missing required, suspect and hard errors", () => {
	const ok = callOf(run(['<invoke name="quiz"><parameter name="question">q</parameter></invoke>']));
	assert.equal(callProblem(ok, tools), undefined);
	assert.match(callProblem(callOf(run(['<invoke name="nope"></invoke>'])), tools) ?? "", /unknown tool "nope"/);
	assert.match(callProblem(callOf(run(['<invoke name="quiz"></invoke>'])), tools) ?? "", /missing required parameter\(s\): question/);
	const suspect = callOf(run(['<invoke name="quiz"><parameter name="question">q</parameter><parameter name="n">many</parameter></invoke>']));
	assert.match(callProblem(suspect, tools) ?? "", /n: expected number/);
	assert.match(callProblem(callOf(run(['<tool_call name="quiz">{bad</tool_call>'])), tools) ?? "", /not valid JSON/);
});

const asst = (content: AssistantMessage["content"]): AssistantMessage => ({
	role: "assistant",
	content,
	api: "claude-cli",
	provider: "claude-cli",
	model: "sonnet",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "toolUse",
	timestamp: 0,
});
const sys: Message = { role: "system", content: "BASE", toolsAdded: [quizTool], timestamp: 0 };
const history: Message[] = [
	sys,
	{ role: "user", content: "hi", timestamp: 0 },
	asst([{ type: "thinking", thinking: "" }, { type: "text", text: "Sure." }, { type: "toolCall", id: "c1", name: "quiz", arguments: { question: "q?" } }]),
	{ role: "toolResult", toolCallId: "c1", toolName: "quiz", content: [{ type: "text", text: "posed" }], isError: false, timestamp: 0 },
];
const textOfBlocks = (r: ReturnType<typeof renderTranscript>) => r.blocks.map((b) => (b.type === "text" ? b.text : "<img>"));

test("renderTranscript: tools in the system prompt, protocol last, one block per message, no volatile tail", () => {
	const r = renderTranscript(history);
	assert.match(r.system, /BASE/);
	assert.match(r.system, /<tool name="quiz">/);
	assert.ok(r.system.trimEnd().endsWith("no recap of the transcript."), "protocol is the last thing the model reads");
	assert.deepEqual(r.schemaOf("quiz")?.properties, { question: { type: "string" } });
	assert.equal(r.tools.get("quiz"), quizTool);
	const blocks = textOfBlocks(r);
	assert.equal(blocks.length, 3, "user, assistant, toolResult — the system message is not a block");
	assert.equal(blocks[0], "[user]\nhi");
	assert.match(blocks[1]!, /^\[assistant\]\nSure\.\n<function_calls>\n<invoke name="quiz">\n<parameter name="question">q\?<\/parameter>\n<\/invoke>\n<\/function_calls>$/);
	assert.equal(blocks[2], '<tool_result id="c1" name="quiz" error="false">\nposed\n</tool_result>');
});

test("renderTranscript: a transcript that grows by whole messages grows by whole blocks (prefix-stable, so the API cache hits)", () => {
	const before = textOfBlocks(renderTranscript(history));
	const grown = [...history, asst([{ type: "text", text: "Next." }]), { role: "user", content: "ok", timestamp: 0 } as Message];
	const after = textOfBlocks(renderTranscript(grown));
	assert.deepEqual(after.slice(0, before.length), before);
	assert.deepEqual(after.slice(before.length), ["[assistant]\nNext.", "[user]\nok"]);
});

test("renderTranscript: images split a message into blocks without losing order", () => {
	const r = renderTranscript([
		sys,
		{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "what is it?" }], timestamp: 0 },
	]);
	assert.deepEqual(r.blocks.map((b) => b.type), ["text", "image", "text"]);
	assert.equal(r.blocks[0]?.type === "text" && r.blocks[0].text, "[user]\nlook");
	assert.equal(r.blocks[2]?.type === "text" && r.blocks[2].text, "what is it?");
});
