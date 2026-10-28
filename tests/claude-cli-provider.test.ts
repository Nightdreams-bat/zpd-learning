/**
 * The claude-cli provider against a scripted fake `claude` (tests/fixtures/
 * fake-claude.mjs): process pool, system prompt over `initialize`, tool-call
 * translation, light-model escalation, run-on halting, the launch-argument
 * fallback, timeouts and aborts — zero tokens, no real CLI.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { createModels, type AssistantMessage, type AssistantMessageEvent, type Tool } from "@earendil-works/pi-ai";
import { claudeCliProvider } from "../src/agent/claude-cli-provider.ts";
import { resetPoolForTests } from "../src/agent/claude-cli-pool.ts";

const LOG = path.join(os.tmpdir(), `fake-claude-${process.pid}.log`);
process.env.CLAUDE_CLI_COMMAND = JSON.stringify([process.execPath, path.join(import.meta.dirname, "fixtures", "fake-claude.mjs")]);
process.env.FAKE_LOG = LOG;

const quizTool = {
	name: "quiz",
	description: "Ask a question",
	parameters: { type: "object", required: ["question"], properties: { question: { type: "string" }, choices: { type: "array" } } },
} as unknown as Tool;

const models = createModels();
models.setProvider(claudeCliProvider());

interface LogLine {
	pid: number;
	ev: "spawn" | "request";
	model?: string;
	effort?: string;
	fileMode?: boolean;
	systemLen?: number;
	marker?: string;
}
const readLog = (): LogLine[] =>
	fs.existsSync(LOG)
		? fs
				.readFileSync(LOG, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as LogLine)
		: [];

async function waitFor(cond: () => boolean, what: string, ms = 5000): Promise<void> {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > ms) assert.fail(`timeout waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 25));
	}
}

async function ask(
	marker: string,
	opts: { model?: string; reasoning?: "low" | "high"; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage }> {
	const model = models.getModel("claude-cli", opts.model ?? "sonnet")!;
	const stream = models.streamSimple(
		model,
		{ systemPrompt: "SYS-PROMPT", tools: [quizTool], messages: [{ role: "user", content: marker, timestamp: Date.now() }] },
		{ ...(opts.reasoning ? { reasoning: opts.reasoning } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.signal ? { signal: opts.signal } : {}) },
	);
	const events: AssistantMessageEvent[] = [];
	for await (const e of stream) events.push(e);
	return { events, message: await stream.result() };
}
const textOf = (m: AssistantMessage) => m.content.map((c) => (c.type === "text" ? c.text : "")).join("");

beforeEach(() => {
	resetPoolForTests();
	fs.rmSync(LOG, { force: true });
	process.env.CLAUDE_CLI_WARM = "0"; // tests that want the pool switch it back on
});
afterEach(() => {
	delete process.env.FAKE_INIT;
	delete process.env.CLAUDE_CLI_ESCALATE;
	resetPoolForTests();
});
after(() => {
	resetPoolForTests();
	fs.rmSync(LOG, { force: true });
	delete process.env.CLAUDE_CLI_WARM;
});

describe("claude-cli provider (fake CLI)", () => {
	it("streams start → text → done, delivers the system prompt over initialize, maps usage", async () => {
		const { events, message } = await ask("ECHOSYS");
		assert.deepEqual(
			[...new Set(events.map((e) => e.type))],
			["start", "text_start", "text_delta", "text_end", "done"],
		);
		assert.equal(events.filter((e) => e.type === "start").length, 1);
		assert.equal(message.stopReason, "stop");
		const text = textOf(message);
		assert.match(text, /^SYS‹SYS-PROMPT/, "the system prompt reached the CLI (the fake defangs its '<')");
		assert.match(text, /‹tool name="quiz">/, "tool declarations ride in the system prompt");
		assert.match(text, /next assistant turn/, "the protocol instructions are appended");
		assert.deepEqual([message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite], [2, 7, 100, 10]);
		assert.equal(readLog().find((l) => l.ev === "spawn")?.fileMode, false, "initialize mode, not a launch argument");
	});

	it("turns a native <function_calls> block into a toolCall (typed args) and ends with toolUse", async () => {
		const { events, message } = await ask("CALLQ");
		assert.equal(message.stopReason, "toolUse");
		const call = message.content.find((c) => c.type === "toolCall");
		assert.ok(call && call.type === "toolCall");
		assert.equal(call.name, "quiz");
		assert.deepEqual(call.arguments, { question: "q?", choices: ["a", "b"] });
		assert.equal(call.argumentsError, undefined);
		assert.ok(events.some((e) => e.type === "toolcall_end"));
		assert.equal(textOf(message).trim(), "Asking.");
	});

	it("passes the thinking level as --effort and surfaces thinking blocks first", async () => {
		const { events, message } = await ask("THINK", { reasoning: "high" });
		assert.equal(readLog().find((l) => l.ev === "spawn")?.effort, "high");
		assert.equal(message.content[0]?.type, "thinking");
		assert.equal(textOf(message), "pondered");
		const kinds = events.map((e) => e.type);
		assert.ok(kinds.indexOf("thinking_start") < kinds.indexOf("text_start"));
		assert.ok(kinds.includes("thinking_end"));
	});

	it("no thinking level → no --effort", async () => {
		await ask("SAY");
		assert.equal(readLog().find((l) => l.ev === "spawn")?.effort, undefined);
	});

	it("strips an echoed [assistant] label", async () => {
		const { message } = await ask("LABEL");
		assert.equal(textOf(message), "labelled");
	});

	it("keeps a parked process for the next call (generic: claimed by the next request)", async () => {
		process.env.CLAUDE_CLI_WARM = "1";
		await ask("SAY");
		await waitFor(() => readLog().filter((l) => l.ev === "spawn").length === 2, "the successor to be parked");
		const [first, parked] = readLog().filter((l) => l.ev === "spawn");
		await ask("SAY");
		const requests = readLog().filter((l) => l.ev === "request");
		assert.equal(requests[0]?.pid, first!.pid);
		assert.equal(requests[1]?.pid, parked!.pid, "the second call ran on the process parked after the first");
		await waitFor(() => readLog().filter((l) => l.ev === "spawn").length === 3, "a new successor");
	});

	it("a parked process takes ANY system prompt: the system prompt is per request, not per process", async () => {
		process.env.CLAUDE_CLI_WARM = "1";
		await ask("SAY");
		await waitFor(() => readLog().filter((l) => l.ev === "spawn").length === 2, "park");
		const model = models.getModel("claude-cli", "sonnet")!;
		const stream = models.streamSimple(model, { systemPrompt: "A COMPLETELY DIFFERENT PROMPT", messages: [{ role: "user", content: "ECHOSYS", timestamp: 0 }] });
		for await (const e of stream) void e;
		const text = textOf(await stream.result());
		assert.match(text, /^SYS‹A COMPLETELY DIFFERENT PROMPT/);
		const spawns = readLog().filter((l) => l.ev === "spawn");
		assert.equal(readLog().filter((l) => l.ev === "request")[1]?.pid, spawns[1]!.pid, "…and it still ran on the parked process");
	});

	it("escalates a fumbled light-model tool call: only the stronger model's answer is delivered", async () => {
		const { events, message } = await ask("BADTOOL", { model: "haiku" });
		assert.equal(message.model, "haiku", "what the agent asked for");
		assert.equal(message.responseModel, "sonnet", "what actually answered");
		const call = message.content.find((c) => c.type === "toolCall");
		assert.ok(call && call.type === "toolCall");
		assert.deepEqual(call.arguments, { question: "fixed" });
		assert.equal(events.filter((e) => e.type === "start").length, 1);
		assert.equal(events.filter((e) => e.type === "done").length, 1);
		assert.ok(!events.some((e) => e.type === "toolcall_end" && e.toolCall.name === "nonexistent"), "the haiku attempt was never shown");
		assert.deepEqual(readLog().filter((l) => l.ev === "request").map((l) => l.model), ["haiku", "sonnet"]);
	});

	it("a sound light-model tool call is delivered as-is (no second call)", async () => {
		const { message } = await ask("CALLQ", { model: "haiku" });
		assert.equal(message.stopReason, "toolUse");
		assert.equal(message.responseModel, undefined);
		assert.equal(readLog().filter((l) => l.ev === "request").length, 1);
	});

	it("a light model that answers in prose when tools were offered is re-asked of the stronger one", async () => {
		const { message } = await ask("SAY", { model: "haiku" });
		assert.equal(message.responseModel, "sonnet");
		assert.deepEqual(readLog().filter((l) => l.ev === "request").map((l) => l.model), ["haiku", "sonnet"]);
	});

	it("CLAUDE_CLI_ESCALATE=0 turns escalation off", async () => {
		process.env.CLAUDE_CLI_ESCALATE = "0";
		const { message } = await ask("BADTOOL", { model: "haiku" });
		const call = message.content.find((c) => c.type === "toolCall");
		assert.ok(call && call.type === "toolCall");
		assert.equal(call.name, "nonexistent");
		assert.equal(readLog().filter((l) => l.ev === "request").length, 1);
	});

	it("a model that starts writing tool results is cut off at its real call", async () => {
		const t0 = Date.now();
		const { message } = await ask("RUNON");
		assert.ok(Date.now() - t0 < 10_000, "the lingering process was killed, not waited for");
		assert.equal(message.stopReason, "toolUse");
		const calls = message.content.filter((c) => c.type === "toolCall");
		assert.equal(calls.length, 1);
		assert.ok(!textOf(message).includes("made up"));
	});

	it("falls back to --system-prompt-file when the CLI rejects initialize, and stays there", async () => {
		process.env.CLAUDE_CLI_WARM = "1";
		process.env.FAKE_INIT = "reject";
		const first = await ask("ECHOSYS");
		assert.match(textOf(first.message), /^SYS‹SYS-PROMPT/, "the retry in file mode still delivered the prompt");
		const spawns = readLog().filter((l) => l.ev === "spawn");
		assert.deepEqual(spawns.map((s) => s.fileMode), [false, true], "initialize attempt, then the file-mode retry");
		await ask("ECHOSYS");
		const after2 = readLog().filter((l) => l.ev === "spawn");
		assert.deepEqual(after2.map((s) => s.fileMode), [false, true, true], "from then on every launch is file mode, and nothing is parked");
	});

	it("an idle CLI is killed after timeoutMs and reported", async () => {
		const { message } = await ask("HANG", { timeoutMs: 300 });
		assert.equal(message.stopReason, "error");
		assert.match(message.errorMessage ?? "", /no output/);
	});

	it("an abort ends the call as aborted", async () => {
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 150);
		const { message } = await ask("HANG", { signal: ac.signal });
		assert.equal(message.stopReason, "aborted");
	});

	it("a safeguard refusal on Sonnet is retried on Opus without the consumer ever seeing the refusal", async () => {
		const { events, message } = await ask("FLAGGED");
		assert.equal(message.stopReason, "stop");
		assert.equal(message.responseModel, "opus");
		assert.equal(events.filter((e) => e.type === "start").length, 1);
		assert.ok(!events.some((e) => e.type === "error"));
		assert.deepEqual(readLog().filter((l) => l.ev === "request").map((l) => l.model), ["sonnet", "opus"]);
	});

	it("when Sonnet and Opus both refuse, the chain ends at Haiku", async () => {
		const { message } = await ask("FLAGGED ALLFLAG");
		assert.equal(message.stopReason, "stop");
		assert.equal(message.responseModel, "haiku");
		assert.deepEqual(readLog().filter((l) => l.ev === "request").map((l) => l.model), ["sonnet", "opus", "haiku"]);
	});

	it("a CLI that dies without output is an error carrying its exit code", async () => {
		const { message } = await ask("CRASH");
		assert.equal(message.stopReason, "error");
		assert.match(message.errorMessage ?? "", /exited with code 3/);
	});
});
