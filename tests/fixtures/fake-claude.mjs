// A scripted stand-in for `claude -p --input-format stream-json` (tests/claude-cli-provider.test.ts).
// Speaks just enough of the wire: an `initialize` control request (system prompt), one user
// message, then stream events + a result. What it answers is chosen by a marker in the last
// text block; FAKE_LOG (a file) receives one JSON line per spawn and per request.
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const model = arg("--model");
const effort = arg("--effort");
const promptFile = arg("--system-prompt-file");
const log = (o) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ pid: process.pid, ...o })}\n`);
const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

let system = promptFile ? readFileSync(promptFile, "utf8") : undefined;
log({ ev: "spawn", model, effort, fileMode: Boolean(promptFile) });

const ev = (event) => send({ type: "stream_event", event });
const chunks = (text, n = 6) => {
	const out = [];
	for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
	return out;
};

const CALL = (name, params = {}) =>
	`<function_calls>\n<invoke name="${name}">\n${Object.entries(params)
		.map(([k, v]) => `<parameter name="${k}">${typeof v === "string" ? v : JSON.stringify(v)}</parameter>`)
		.join("\n")}\n</invoke>\n</function_calls>`;

function scenario(marker) {
	if (marker.includes("SAY")) return { text: "hello there" };
	if (marker.includes("LABEL")) return { text: "[assistant]\nlabelled" };
	if (marker.includes("CALLQ")) return { text: `Asking.\n${CALL("quiz", { question: "q?", choices: ["a", "b"] })}` };
	if (marker.includes("BADTOOL")) {
		// Light model fumbles (unknown tool); anything stronger gets it right.
		return model === "haiku" ? { text: CALL("nonexistent", { x: 1 }) } : { text: CALL("quiz", { question: "fixed" }) };
	}
	if (marker.includes("RUNON")) return { text: `${CALL("quiz", { question: "real" })}\n<function_results>made up`, linger: true };
	if (marker.includes("THINK")) return { think: 40, text: "pondered" };
	if (marker.includes("ECHOSYS")) return { text: `SYS<${system}>`.replaceAll("<", "‹") }; // defanged: the echo must not parse as a call
	if (marker.includes("HANG")) return { hang: true };
	if (marker.includes("CRASH")) return { crash: true };
	return { text: "ok" };
}

function respond(blocks) {
	const texts = blocks.filter((b) => b.type === "text").map((b) => b.text);
	const marker = texts[texts.length - 1] ?? "";
	log({ ev: "request", model, effort, blocks: blocks.length, systemLen: system?.length ?? 0, marker: marker.slice(0, 40) });
	const sc = scenario(marker);
	if (sc.hang) return void setInterval(() => {}, 1000); // alive, silent
	if (sc.crash) process.exit(3);
	send({ type: "system", subtype: "init", session_id: "fake" });
	ev({ type: "message_start", message: { usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } });
	let index = 0;
	if (sc.think) {
		ev({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
		ev({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: "", estimated_tokens: sc.think } });
		ev({ type: "content_block_stop", index });
		index++;
	}
	ev({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
	for (const piece of chunks(sc.text)) ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
	if (sc.linger) {
		// A model that will not stop writing: the provider must kill us, not wait for this.
		setInterval(() => ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: " more" } }), 20);
		return;
	}
	ev({ type: "content_block_stop", index });
	ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } });
	ev({ type: "message_stop" });
	send({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", result: sc.text, usage: { input_tokens: 2, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } });
	process.exit(0);
}

let buf = "";
process.stdin.on("data", (d) => {
	buf += d;
	let nl;
	while ((nl = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, nl);
		buf = buf.slice(nl + 1);
		if (!line.trim()) continue;
		const msg = JSON.parse(line);
		if (msg.type === "control_request" && msg.request.subtype === "initialize") {
			if (process.env.FAKE_INIT === "reject") {
				send({ type: "control_response", response: { subtype: "error", request_id: msg.request_id, error: "unknown subtype" } });
				continue;
			}
			system = Array.isArray(msg.request.systemPrompt) ? msg.request.systemPrompt.join("\n") : msg.request.systemPrompt;
			send({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response: {} } });
		} else if (msg.type === "user") {
			respond(msg.message.content);
		}
	}
});
