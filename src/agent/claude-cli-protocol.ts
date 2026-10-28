import type { JsonObject, JsonValue, Message, TextContent, Tool } from "@earendil-works/pi-ai";

/**
 * The text protocol the Claude Code CLI provider speaks (claude-cli
 * provider, 2026-10-24). `claude -p` runs with every native tool disabled,
 * so pi's tool loop is emulated in plain text: tool declarations go into the
 * system prompt, the model writes Claude's NATIVE call syntax
 *
 *   <function_calls><invoke name="NAME"><parameter name="arg">value</parameter></invoke></function_calls>
 *
 * and the transcript replays earlier calls and results the same way. Native
 * syntax matters: asked for a bespoke tag, the model still reaches for
 * <invoke> from habit. The scanner therefore also accepts bare <invoke>
 * and the legacy <tool_call name="…">{json}</tool_call> form.
 *
 * CACHE SHAPE: the transcript is sent as ONE TEXT BLOCK PER MESSAGE and
 * NEVER ends in a volatile cue. The API caches a prefix at the end of the
 * request's last block and finds it again at any block boundary within ~20
 * blocks, so a transcript that only ever grows by appended whole messages
 * re-reads its entire history from cache (measured: 22.7k of 24k tokens)
 * where one growing block, or a trailing "[assistant]" cue, re-writes it
 * every call.
 *
 * PURE — no process, no fs — so the whole protocol is unit-testable.
 */

type PropSchema = { type?: unknown; anyOf?: unknown; oneOf?: unknown; enum?: unknown; const?: unknown };
type Schema = { type?: unknown; required?: unknown; properties?: Record<string, PropSchema | undefined> };
export type SchemaLookup = (tool: string) => Schema | undefined;

interface Opener {
	open: string;
	close: string;
}
/** Wrapper tags: dropped from the prose, carry nothing themselves. */
/** (Haiku sometimes invents an `<invoke_tool_call>` wrapper; it is dropped the same way.) */
const WRAPPERS = ["<function_calls>", "</function_calls>", "<invoke_tool_call>", "</invoke_tool_call>"] as const;
const CALL_FORMS: readonly Opener[] = [
	{ open: "<invoke", close: "</invoke>" },
	{ open: "<tool_call", close: "</tool_call>" },
];
/** A model that starts writing results itself has run past its turn. */
const RUN_ON = ["<function_results", "<tool_result", "<result>"] as const;
/** The transcript's own speaker label; a model that echoes it has it stripped. */
const LABEL = "[assistant]";

const ALL_TOKENS: readonly string[] = [...WRAPPERS, ...CALL_FORMS.map((f) => f.open), ...RUN_ON];

export type ScanEvent =
	| { type: "text"; text: string }
	/** `error` is HARD (the call is unusable: arguments become {}); `suspect` is SOFT
	 *  (the call parsed but a typed parameter was not valid JSON — passed through raw so the
	 *  app's own argument healing gets its chance; only escalation heuristics read it). */
	| { type: "call"; name: string; args: JsonObject; error?: string; suspect?: string }
	| { type: "bad-call"; raw: string }
	/** The model began fabricating a tool result: nothing after this point is real. */
	| { type: "halt" };

/** Incremental splitter: model text in, prose and tool calls out. Holds back
 *  only a suffix that might still grow into a recognised tag. */
export class ToolCallScanner {
	#buf = "";
	#active: Opener | undefined;
	#halted = false;
	#atStart = true;
	readonly #schemaOf: SchemaLookup;

	constructor(schemaOf: SchemaLookup = () => undefined) {
		this.#schemaOf = schemaOf;
	}

	get halted(): boolean {
		return this.#halted;
	}

	feed(chunk: string): ScanEvent[] {
		if (this.#halted) return [];
		this.#buf += chunk;
		const out: ScanEvent[] = [];
		for (;;) {
			if (this.#active) {
				const end = this.#buf.indexOf(this.#active.close);
				if (end < 0) return out;
				const raw = this.#buf.slice(0, end + this.#active.close.length);
				this.#buf = this.#buf.slice(end + this.#active.close.length);
				this.#active = undefined;
				out.push(this.#parse(raw));
				continue;
			}
			if (this.#atStart) {
				const head = this.#buf.trimStart();
				if (head.length < LABEL.length && LABEL.startsWith(head)) return out; // may still become the label
				this.#atStart = false;
				this.#buf = head.startsWith(LABEL) ? head.slice(LABEL.length).replace(/^[ \t]*(\r?\n)?/, "") : this.#buf;
				continue;
			}
			const hit = earliest(this.#buf);
			if (!hit) {
				const keep = partialSuffix(this.#buf);
				const emit = this.#buf.slice(0, this.#buf.length - keep);
				if (emit) out.push({ type: "text", text: emit });
				this.#buf = this.#buf.slice(this.#buf.length - keep);
				return out;
			}
			// Blank space around a tag is formatting, not prose.
			if (hit.at > 0 && this.#buf.slice(0, hit.at).trim()) out.push({ type: "text", text: this.#buf.slice(0, hit.at) });
			this.#buf = this.#buf.slice(hit.at);
			if ((WRAPPERS as readonly string[]).includes(hit.token)) {
				this.#buf = this.#buf.slice(hit.token.length);
			} else if ((RUN_ON as readonly string[]).includes(hit.token)) {
				this.#halted = true;
				this.#buf = "";
				out.push({ type: "halt" });
				return out;
			} else {
				this.#active = CALL_FORMS.find((f) => f.open === hit.token);
			}
		}
	}

	/** End of stream: whatever is left is prose, or a truncated call. */
	flush(): ScanEvent[] {
		const rest = this.#buf;
		this.#buf = "";
		const was = this.#active;
		this.#active = undefined;
		if (!rest || (!was && !rest.trim())) return [];
		return was ? [{ type: "bad-call", raw: rest }] : [{ type: "text", text: rest }];
	}

	#parse(raw: string): ScanEvent {
		const legacy = /^<tool_call\s+name="([^"]+)"\s*>/.exec(raw);
		if (legacy) {
			const body = raw.slice(legacy[0].length, raw.length - "</tool_call>".length).trim();
			return { type: "call", name: legacy[1] ?? "", ...parseCallArgs(body) };
		}
		const head = /^<invoke\s+name="([^"]+)"\s*>/.exec(raw);
		if (!head) return { type: "bad-call", raw };
		const name = head[1] ?? "";
		const schema = this.#schemaOf(name);
		const args: JsonObject = {};
		const suspects: string[] = [];
		const re = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;
		for (let m = re.exec(raw); m; m = re.exec(raw)) {
			const key = m[1] ?? "";
			const { value, suspect } = coerceParam(m[2] ?? "", schema?.properties?.[key]);
			args[key] = value;
			if (suspect) suspects.push(`${key}: ${suspect}`);
		}
		return { type: "call", name, args, ...(suspects.length ? { suspect: suspects.join("; ") } : {}) };
	}
}

function earliest(s: string): { at: number; token: string } | undefined {
	let best: { at: number; token: string } | undefined;
	for (const token of ALL_TOKENS) {
		const at = s.indexOf(token);
		if (at >= 0 && (!best || at < best.at)) best = { at, token };
	}
	return best;
}

/** Length of the longest suffix of `s` that is a proper prefix of some tag. */
function partialSuffix(s: string): number {
	let keep = 0;
	for (const token of ALL_TOKENS) {
		const max = Math.min(token.length - 1, s.length);
		for (let n = max; n > keep; n--) {
			if (token.startsWith(s.slice(s.length - n))) {
				keep = n;
				break;
			}
		}
	}
	return keep;
}

/** The JSON types a property schema admits (unions flattened; enums of strings count as string). */
function typesOf(p: PropSchema | undefined): Set<string> {
	const out = new Set<string>();
	if (!p) return out;
	if (typeof p.type === "string") out.add(p.type);
	else if (Array.isArray(p.type)) for (const t of p.type) if (typeof t === "string") out.add(t);
	for (const alt of [p.anyOf, p.oneOf]) {
		if (Array.isArray(alt)) for (const a of alt) for (const t of typesOf(a as PropSchema)) out.add(t);
	}
	if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === "string")) out.add("string");
	if (typeof p.const === "string") out.add("string");
	return out;
}

/** A <parameter> body to a JSON value. Strings stay verbatim; anything the schema types
 *  otherwise is parsed as JSON, and a failed parse passes the raw text through flagged `suspect`. */
function coerceParam(raw: string, prop: PropSchema | undefined): { value: JsonValue; suspect?: string } {
	const text = raw.replace(/^\n/, "").replace(/\n$/, "");
	const types = typesOf(prop);
	if (types.size === 1 && types.has("string")) return { value: text };
	const trimmed = text.trim();
	const parse = (): { ok: true; value: JsonValue } | { ok: false } => {
		try {
			return { ok: true, value: JSON.parse(trimmed) as JsonValue };
		} catch {
			return { ok: false };
		}
	};
	if (types.size === 0) {
		// No schema for this parameter: JSON only when it unmistakably is.
		if (/^[[{]/.test(trimmed) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)) {
			const r = parse();
			if (r.ok) return { value: r.value };
		}
		return { value: text };
	}
	if (types.has("string")) {
		// string | other: JSON only for structure-looking text, else the literal string.
		if (/^[[{]/.test(trimmed)) {
			const r = parse();
			if (r.ok) return { value: r.value };
		}
		return { value: text };
	}
	const r = parse();
	if (r.ok) return { value: r.value };
	return { value: text, suspect: `expected ${[...types].join("|")} as JSON, got ${JSON.stringify(trimmed.slice(0, 60))}` };
}

/** Parse a legacy call body into the arguments object; invalid yields `{}` plus the reason. */
export function parseCallArgs(argsText: string): { args: JsonObject; error?: string } {
	if (!argsText) return { args: {} };
	try {
		const v: unknown = JSON.parse(argsText);
		if (v && typeof v === "object" && !Array.isArray(v)) return { args: v as JsonObject };
		return { args: {}, error: `tool arguments must be a JSON object, got: ${argsText.slice(0, 200)}` };
	} catch (e) {
		return { args: {}, error: `tool arguments were not valid JSON (${(e as Error).message}): ${argsText.slice(0, 200)}` };
	}
}

/** Why a parsed call is not trustworthy enough to hand to the app, or undefined when it is.
 *  Used to decide when a light model's answer should be re-asked of a stronger one. */
export function callProblem(ev: Extract<ScanEvent, { type: "call" }>, tools: ReadonlyMap<string, Tool>): string | undefined {
	if (ev.error) return ev.error;
	const tool = tools.get(ev.name);
	if (!tool) return `unknown tool "${ev.name}"`;
	if (ev.suspect) return ev.suspect;
	const required = (tool.parameters as Schema | undefined)?.required;
	if (Array.isArray(required)) {
		const missing = required.filter((k): k is string => typeof k === "string" && !(k in ev.args));
		if (missing.length) return `${ev.name} is missing required parameter(s): ${missing.join(", ")}`;
	}
	return undefined;
}

/**
 * Sonnet's safeguards reject a request whose text asks for its reasoning to be shown
 * (`[reasoning_extraction]`) — and the replayed transcript is ONE user message, so a
 * phrase the app wrote into an earlier tool call ("use the thinking field to reason out
 * loud", aimed at the learner) reads as the user asking for it. Measured on a real chat:
 * removing the sentence or rewording it to "explain your thinking" passes, "show your
 * reasoning" is flagged too. Replayed history therefore rewords these phrasings; the
 * system prompt and live output are never touched.
 */
const REASONING_ASKS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\b(?:reason(?:ing)?|think(?:ing|s)?|work(?:ing)?)(?:\s+(?:it|things|this|that|them))?(?:\s+through)?\s+(?:out\s+loud|aloud)\b/gi, "explain your thinking"],
	[/\bshow\s+(?:your|the|its|their)\s+(?:reasoning|chain[- ]of[- ]thought|thought\s+process|working)\b/gi, "explain your thinking"],
	[/\b(?:reveal|expose|output|print|write\s+out)\s+(?:your|the)\s+(?:reasoning|chain[- ]of[- ]thought|thought\s+process)\b/gi, "explain your thinking"],
];

export function defangReasoningAsks(text: string): string {
	let out = text;
	for (const [re, to] of REASONING_ASKS) out = out.replace(re, to);
	return out;
}

function textOf(content: string | TextContent[]): string {
	return typeof content === "string" ? content : content.map((c) => c.text).join("");
}

function renderCall(name: string, args: JsonObject): string {
	const params = Object.entries(args)
		.map(([k, v]) => `<parameter name="${k}">${typeof v === "string" ? v : JSON.stringify(v)}</parameter>`)
		.join("\n");
	return `<function_calls>\n<invoke name="${name}">\n${params}\n</invoke>\n</function_calls>`;
}

export type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface RenderedTranscript {
	system: string;
	/** One text block per message (images split a message into several), oldest first. */
	blocks: Block[];
	/** The tools in force, by name. */
	tools: ReadonlyMap<string, Tool>;
	/** Parameter schemas of those tools, for argument coercion. */
	schemaOf: SchemaLookup;
}

const PROTOCOL = `You are the assistant in a conversation transcript. You have NO built-in tools; the only tools are the ones listed under <tools>.

To call a tool, write exactly this (one <invoke> per call, several allowed in one <function_calls> block):
<function_calls>
<invoke name="TOOL_NAME">
<parameter name="PARAM_NAME">value</parameter>
</invoke>
</function_calls>
String values go in verbatim; numbers, booleans, arrays and objects go in as JSON. After </function_calls> STOP writing: the results arrive in the next turn as <tool_result> entries. Never write <tool_result> or <function_results> yourself and never invent a result.

The user turn is the conversation so far, oldest entry first, each entry labelled [user], [assistant] or <tool_result>. Write ONLY the next assistant turn: no "[assistant]" label, no recap of the transcript.`;

/** Replay the system messages (base prompt, sections, tool add/remove) and render
 *  the rest of the transcript. */
export function renderTranscript(messages: readonly Message[]): RenderedTranscript {
	const tools = new Map<string, Tool>();
	const baseParts: string[] = [];
	const sections = new Map<string, string>();
	const blocks: Block[] = [];
	let sawSystem = false;

	const text = (t: string) => blocks.push({ type: "text", text: defangReasoningAsks(t) });
	const image = (c: { data: string; mimeType: string }) =>
		blocks.push({ type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } });

	for (const m of messages) {
		if (m.role === "system") {
			const body = textOf(m.content);
			if (!sawSystem) {
				sawSystem = true;
				if (body) baseParts.push(body);
			} else if (body) {
				text(`[system note]\n${body}`);
			}
			for (const [k, v] of Object.entries(m.sections ?? {})) {
				if (v === null) sections.delete(k);
				else sections.set(k, v);
			}
			for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
			for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
		} else if (m.role === "user") {
			if (typeof m.content === "string") {
				text(`[user]\n${m.content}`);
			} else {
				let first = true;
				let run = "";
				const flush = () => {
					if (run || first) text(`${first ? "[user]\n" : ""}${run}`.trimEnd());
					first = false;
					run = "";
				};
				for (const c of m.content) {
					if (c.type === "text") run += `${run ? "\n" : ""}${c.text}`;
					else {
						flush();
						image(c);
					}
				}
				flush();
			}
		} else if (m.role === "assistant") {
			let body = "[assistant]";
			for (const c of m.content) {
				if (c.type === "text") body += `\n${c.text}`;
				else if (c.type === "toolCall") body += `\n${renderCall(c.name, c.arguments)}`;
			}
			text(body);
		} else {
			let run = `<tool_result id="${m.toolCallId}" name="${m.toolName}" error="${m.isError}">`;
			for (const c of m.content) {
				if (c.type === "text") run += `\n${c.text}`;
				else {
					text(run);
					run = "";
					image(c);
				}
			}
			text(`${run}\n</tool_result>`);
		}
	}

	const toolList = [...tools.values()]
		.map((t) => `<tool name="${t.name}">\n${t.description}\nparameters (JSON Schema): ${JSON.stringify(t.parameters)}\n</tool>`)
		.join("\n");
	const sectionText = [...sections.values()].join("\n\n");
	const system = [baseParts.join("\n\n"), sectionText, toolList ? `<tools>\n${toolList}\n</tools>` : "<tools>\n(none)\n</tools>", PROTOCOL]
		.filter(Boolean)
		.join("\n\n");
	const schemaOf: SchemaLookup = (name) => tools.get(name)?.parameters as Schema | undefined;
	return { system, blocks, tools, schemaOf };
}
