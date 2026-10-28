import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
	createProvider,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Model,
	type Provider,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { acquire, INIT_REQUEST_ID, markInitializeRejected, prewarm, send, type Proc, type Shape } from "./claude-cli-pool.ts";
import { ToolCallScanner, callProblem, renderTranscript, type RenderedTranscript, type ScanEvent } from "./claude-cli-protocol.ts";

export { claudeCliInstalled } from "./claude-cli-pool.ts";

/**
 * "Claude Code (subscription)" — a pi-ai provider that answers by running
 * the user's own installed `claude` CLI in headless mode (`claude -p`), so
 * the learner's Claude subscription can back the agents without an API key.
 * The CLI is the official client doing its own login; this module never
 * reads or forwards a token. Every native Claude Code tool is disabled and
 * pi's tool loop is emulated in text (claude-cli-protocol.ts); processes
 * come from a warm pool (claude-cli-pool.ts). One CLI process per model
 * call; the transcript is replayed each call as one block per message, which
 * the API serves from its prompt cache (see the protocol's CACHE SHAPE).
 *
 * THINKING: pi thinking levels map onto the CLI's --effort. The CLI streams
 * thinking blocks with their text withheld (only a token estimate), so they
 * surface as empty thinking blocks: enough for the UI and liveness checks.
 *
 * ESCALATION: a light model (Haiku) answers first, held back from the
 * consumer; if its tool call is unusable (garbled syntax, unknown tool,
 * missing required parameter, a typed parameter that is not JSON) the same
 * request is re-asked of the next model up and only THAT answer is shown.
 * Stronger models stream straight through.
 */

export const CLAUDE_CLI_PROVIDER_ID = "claude-cli";
export const CLAUDE_CLI_API = "claude-cli";
/** Pseudo env var: the keys seam reports it present when the CLI is installed. */
export const CLAUDE_CLI_ENV_VAR = "CLAUDE_CLI_LOCAL";

/** No output at all for this long = a hung CLI (thinking deltas count as output). */
const IDLE_TIMEOUT_MS = 300_000;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** pi thinking level → `claude --effort`. "off" passes no effort and caps thinking at 0 tokens. */
const EFFORT: Record<string, string | undefined> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/** Who gets asked again when a light model's answer is unusable. */
const ESCALATE_TO: Record<string, string> = { haiku: "sonnet" };

/** Who answers when a model's safeguards refuse the request outright. The refusal is
 *  per model and content-driven (measured: the same request passed Opus and Haiku and
 *  was flagged on Sonnet), so the same request goes to another model instead of failing. */
const FLAG_FALLBACK: Record<string, string> = { sonnet: "opus", opus: "haiku", haiku: "sonnet" };

const FLAGGED = /safeguards flagged/i;

function escalationOf(id: string): string | undefined {
	return process.env.CLAUDE_CLI_ESCALATE === "0" ? undefined : ESCALATE_TO[id];
}

function effortOf(level: string | undefined): string | undefined {
	return level ? EFFORT[level] : undefined;
}

function cliModel(id: string, name: string): Model<typeof CLAUDE_CLI_API> {
	return {
		id,
		name,
		api: CLAUDE_CLI_API,
		provider: CLAUDE_CLI_PROVIDER_ID,
		baseUrl: "claude-cli://local",
		input: ["text", "image"],
		reasoning: true,
		thinkingLevelMap: { off: "off", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
		cost: ZERO_COST,
		contextWindow: 500_000,
		maxTokens: 32_000,
	};
}

const MODELS = [
	cliModel("opus", "Claude Opus (subscription)"),
	cliModel("sonnet", "Claude Sonnet (subscription)"),
	cliModel("haiku", "Claude Haiku (subscription)"),
];

/** Park a process for each (model, thinking level) so the next call skips the ~0.85 s startup.
 *  Idempotent; the server calls it whenever the learner is about to need a model. */
export function warmClaudeCli(specs: ReadonlyArray<{ id: string; level?: string }>): void {
	for (const s of specs) prewarm({ model: s.id, effort: effortOf(s.level) });
}

function emptyMessage(model: Model<string>, answeredBy: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		...(answeredBy !== model.id ? { responseModel: answeredBy } : {}),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

interface CliUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface AttemptResult {
	kind: "ok" | "error" | "aborted" | "flagged";
	message: AssistantMessage;
	/** Set on an "ok" whose content a stronger model might do better (see ESCALATION). */
	problem?: string;
}

type Sink = (event: AssistantMessageEvent) => void;

/** CLAUDE_CLI_DEBUG=1: one stderr line per finished call — what answered, how it ended, what it said. */
function trace(r: AttemptResult, asked: string): void {
	if (process.env.CLAUDE_CLI_DEBUG !== "1") return;
	const m = r.message;
	const body = m.content
		.map((c) => (c.type === "text" ? `text:${JSON.stringify(c.text.slice(0, 300))}` : c.type === "toolCall" ? `call:${c.name}(${JSON.stringify(c.arguments).slice(0, 200)})${c.argumentsError ? `!${c.argumentsError.slice(0, 120)}` : ""}` : c.type))
		.join(" | ");
	console.error(`[claude-cli] ${asked}→${m.responseModel ?? m.model} ${r.kind} stop=${m.stopReason}${m.errorMessage ? ` error=${JSON.stringify(m.errorMessage)}` : ""}${r.problem ? ` problem=${JSON.stringify(r.problem)}` : ""} ${body}`);
}

/** One model call end to end: claim a process, hand it the request, translate its output. */
function attempt(
	model: Model<string>,
	answeredBy: string,
	shape: Shape,
	rendered: RenderedTranscript,
	options: SimpleStreamOptions | undefined,
	sink: Sink,
	/** A safeguard refusal that arrives before any output resolves "flagged" instead of an error. */
	flagFallbackAvailable: boolean,
): Promise<AttemptResult> {
	return new Promise((resolve) => {
		const out = emptyMessage(model, answeredBy);
		let started = false;
		const emit: Sink = (e) => {
			if (!started) {
				started = true;
				sink({ type: "start", partial: out });
			}
			sink(e);
		};
		const idleMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : IDLE_TIMEOUT_MS;

		const run = (proc: Proc, retried: boolean) => {
			const scanner = new ToolCallScanner(rendered.schemaOf);
			const kinds = new Map<number, "text" | "thinking">();
			let textIndex = -1;
			let textBlock: TextContent | undefined;
			let thinkIndex = -1;
			let thinkBlock: ThinkingContent | undefined;
			let pendingBlank = "";
			let sawCall = false;
			let halted = false;
			let settled = false;
			let timedOut = false;
			let sawResult = false;
			let problem: string | undefined;
			let initError: string | undefined;
			let cliError: string | undefined;
			let rawStop: string | undefined;
			let resultUsage: CliUsage | undefined;
			const live: CliUsage = {};
			let buf = "";
			let idleTimer: NodeJS.Timeout | undefined;

			const arm = () => {
				clearTimeout(idleTimer);
				idleTimer = setTimeout(() => {
					timedOut = true;
					proc.child.kill();
				}, idleMs);
			};
			const onAbort = () => proc.child.kill();
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			if (options?.signal?.aborted) onAbort();
			arm();

			const teardown = () => {
				clearTimeout(idleTimer);
				options?.signal?.removeEventListener("abort", onAbort);
			};
			const finishErr = (reason: "error" | "aborted", message: string) => {
				if (flagFallbackAvailable && !started && FLAGGED.test(message)) {
					out.stopReason = "error";
					out.errorMessage = message;
					return resolve({ kind: "flagged", message: out });
				}
				out.stopReason = reason;
				out.errorMessage = message;
				emit({ type: "error", reason, error: out });
				resolve({ kind: reason === "aborted" ? "aborted" : "error", message: out });
			};

			const closeText = () => {
				if (textIndex < 0 || !textBlock) return;
				emit({ type: "text_end", contentIndex: textIndex, content: textBlock.text, partial: out });
				textIndex = -1;
				textBlock = undefined;
			};
			const closeThinking = () => {
				if (thinkIndex < 0 || !thinkBlock) return;
				emit({ type: "thinking_end", contentIndex: thinkIndex, content: thinkBlock.thinking, partial: out });
				thinkIndex = -1;
				thinkBlock = undefined;
			};
			const apply = (events: ScanEvent[]) => {
				for (const ev of events) {
					if (ev.type === "text") {
						// Blank chunks between tags are formatting: hold them until real prose follows.
						if (textIndex < 0 && !ev.text.trim()) {
							pendingBlank += ev.text;
							continue;
						}
						const piece = textIndex < 0 ? pendingBlank + ev.text : ev.text;
						pendingBlank = "";
						if (textIndex < 0) {
							textBlock = { type: "text", text: "" };
							out.content.push(textBlock);
							textIndex = out.content.length - 1;
							emit({ type: "text_start", contentIndex: textIndex, partial: out });
						}
						if (textBlock) textBlock.text += piece;
						emit({ type: "text_delta", contentIndex: textIndex, delta: piece, partial: out });
					} else if (ev.type === "halt") {
						// The model started writing tool results itself: everything after is invented.
						halted = true;
						proc.child.kill();
					} else {
						closeText();
						pendingBlank = "";
						const why = ev.type === "call" ? callProblem(ev, rendered.tools) : `malformed tool call: ${ev.raw.slice(0, 200)}`;
						if (why && !problem) problem = why;
						const hard = ev.type === "call" ? ev.error : why;
						const call = {
							type: "toolCall" as const,
							id: `cli_${randomUUID().slice(0, 12)}`,
							name: ev.type === "call" ? ev.name : "unknown",
							arguments: ev.type === "call" ? ev.args : {},
							...(hard ? { argumentsError: hard } : {}),
						};
						out.content.push(call);
						const idx = out.content.length - 1;
						emit({ type: "toolcall_start", contentIndex: idx, partial: out });
						emit({ type: "toolcall_end", contentIndex: idx, toolCall: call, partial: out });
						sawCall = true;
					}
				}
			};

			const handleLine = (line: string) => {
				if (!line.trim()) return;
				if (process.env.CLAUDE_CLI_DEBUG_RAW) appendFileSync(process.env.CLAUDE_CLI_DEBUG_RAW, `${line}
`);
				let msg: any;
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.type === "control_response") {
					const r = msg.response;
					if (r?.request_id === INIT_REQUEST_ID && r.subtype === "error") {
						initError = typeof r.error === "string" ? r.error : "initialize request rejected";
						proc.child.kill();
					}
				} else if (msg.type === "stream_event") {
					const ev = msg.event;
					if (ev?.type === "message_start") {
						Object.assign(live, ev.message?.usage ?? {});
					} else if (ev?.type === "message_delta") {
						Object.assign(live, ev.usage ?? {});
						rawStop = ev.delta?.stop_reason ?? rawStop;
					} else if (ev?.type === "content_block_start") {
						const t = ev.content_block?.type;
						if (t === "thinking") {
							kinds.set(ev.index, "thinking");
							closeText();
							thinkBlock = { type: "thinking", thinking: "" };
							out.content.push(thinkBlock);
							thinkIndex = out.content.length - 1;
							emit({ type: "thinking_start", contentIndex: thinkIndex, partial: out });
						} else if (t === "text") {
							kinds.set(ev.index, "text");
						}
					} else if (ev?.type === "content_block_delta") {
						const d = ev.delta;
						if (d?.type === "text_delta") {
							apply(scanner.feed(d.text as string));
						} else if (d?.type === "thinking_delta" && thinkBlock) {
							const piece = typeof d.thinking === "string" ? d.thinking : "";
							thinkBlock.thinking += piece;
							emit({ type: "thinking_delta", contentIndex: thinkIndex, delta: piece, partial: out });
						}
					} else if (ev?.type === "content_block_stop" && kinds.get(ev.index) === "thinking") {
						closeThinking();
					}
				} else if (msg.type === "result") {
					sawResult = true;
					resultUsage = msg.usage;
					rawStop = msg.stop_reason ?? rawStop;
					if (msg.is_error) cliError = typeof msg.result === "string" && msg.result ? msg.result : "claude CLI reported an error";
				}
			};

			proc.child.stdout.on("data", (d: Buffer) => {
				arm();
				buf += d.toString();
				let nl: number;
				while ((nl = buf.indexOf("\n")) >= 0) {
					handleLine(buf.slice(0, nl));
					buf = buf.slice(nl + 1);
				}
			});
			proc.child.on("error", (e: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				teardown();
				finishErr("error", e.code === "ENOENT" ? "The `claude` CLI was not found on PATH. Install Claude Code and run `claude` once to log in." : e.message);
			});
			proc.child.on("close", (code) => {
				if (settled) return;
				settled = true;
				teardown();
				if (initError) {
					// This CLI does not take the system prompt over the control channel: switch to
					// launch-argument mode for good and ask again (nothing was emitted yet).
					if (proc.fileMode) return finishErr("error", initError);
					markInitializeRejected();
					return run(acquire(shape, rendered.system, { cold: true }), retried);
				}
				handleLine(buf);
				apply(scanner.flush());
				closeText();
				closeThinking();
				if (options?.signal?.aborted && !halted) return finishErr("aborted", "aborted");
				if (timedOut) return finishErr("error", `claude CLI produced no output for ${Math.round(idleMs / 1000)}s`);
				// A parked process that died before use (idle crash, network) is retried cold, once.
				if (!halted && proc.warm && !retried && out.content.length === 0 && (cliError || !sawResult)) {
					return run(acquire(shape, rendered.system, { cold: true }), true);
				}
				// No result event = the process died or was cut off mid-answer: a truncated answer
				// (half a tool call) must never pass for a finished one.
				if (!halted && (cliError || !sawResult)) {
					return finishErr("error", cliError ?? (proc.stderr.trim() || `claude CLI exited with code ${code} before answering`));
				}
				const u: CliUsage = { ...live, ...(resultUsage ?? {}) };
				out.usage.input = u.input_tokens ?? 0;
				out.usage.output = u.output_tokens ?? 0;
				out.usage.cacheRead = u.cache_read_input_tokens ?? 0;
				out.usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
				out.usage.totalTokens = out.usage.input + out.usage.output + out.usage.cacheRead + out.usage.cacheWrite;
				if (rawStop) out.rawStopReason = rawStop;
				out.stopReason = sawCall ? "toolUse" : rawStop === "max_tokens" ? "length" : "stop";
				if (out.content.length === 0) problem ??= "empty response";
				emit({ type: "done", reason: out.stopReason, message: out });
				// The next call of this conversation will want the same process shape.
				prewarm(shape);
				resolve({ kind: "ok", message: out, ...(problem ? { problem } : {}) });
			});

			if (process.env.CLAUDE_CLI_DEBUG_REQ) {
				const stem = `${process.env.CLAUDE_CLI_DEBUG_REQ}/${Date.now()}-${answeredBy}`;
				mkdirSync(process.env.CLAUDE_CLI_DEBUG_REQ, { recursive: true });
				writeFileSync(`${stem}-system.md`, rendered.system);
				writeFileSync(`${stem}-blocks.json`, JSON.stringify(rendered.blocks, null, 1));
			}
			send(proc, rendered.system, rendered.blocks);
		};

		run(acquire(shape, rendered.system), false);
	});
}

async function drive(
	stream: AssistantMessageEventStream,
	model: Model<string>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
): Promise<void> {
	const rendered = renderTranscript(context.messages);
	const effort = effortOf(options?.reasoning);
	const tried = new Set<string>();
	let id = model.id;

	for (;;) {
		tried.add(id);
		const up = escalationOf(id);
		const fallback = FLAG_FALLBACK[id];
		const canEscalate = up !== undefined && !tried.has(up);
		const canFallBack = fallback !== undefined && !tried.has(fallback);
		// A light model's answer is held until it is known to be usable; anything else streams.
		const held: AssistantMessageEvent[] = [];
		const sink: Sink = canEscalate ? (e) => void held.push(e) : (e) => stream.push(e);
		const r = await attempt(model, id, { model: id, effort }, rendered, options, sink, canFallBack);
		trace(r, id);
		if (r.kind === "flagged" && canFallBack) {
			id = fallback!;
			continue;
		}
		// A light model asked to act (tools on offer) that answers in prose alone has not done the job.
		const silent = rendered.tools.size > 0 && !r.message.content.some((c) => c.type === "toolCall");
		if (canEscalate && r.kind === "ok" && (r.problem || silent)) {
			id = up!;
			continue;
		}
		for (const e of held) stream.push(e);
		stream.end(r.message);
		return;
	}
}

function streamClaudeCli(model: Model<string>, context: TranscriptContext, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	drive(stream, model, context, options).catch((e: unknown) => {
		// A bug must still end the stream, or the turn hangs forever.
		const out = emptyMessage(model, model.id);
		out.stopReason = "error";
		out.errorMessage = e instanceof Error ? e.message : String(e);
		stream.push({ type: "error", reason: "error", error: out });
		stream.end(out);
	});
	return stream;
}

export function claudeCliProvider(): Provider {
	return createProvider({
		id: CLAUDE_CLI_PROVIDER_ID,
		name: "Claude Code (subscription)",
		auth: {
			apiKey: {
				name: "Local claude CLI",
				resolve: async ({ signal }) => {
					signal.throwIfAborted();
					return { auth: { apiKey: "local" }, source: "claude CLI" };
				},
			},
		},
		models: MODELS,
		api: { stream: streamClaudeCli, streamSimple: streamClaudeCli },
	});
}
