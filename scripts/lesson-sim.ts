/**
 * Long-lesson simulator (claude-cli provider evaluation, 2026-10-24).
 *
 * Drives the app's REAL turn pipeline (handleChatRequest → prober/teacher
 * agents → the claude-cli engine) in-process with a scripted learner, for
 * as many turns as asked, in a throwaway data directory — then reports what
 * a long lesson actually does to the protocol: per-call latency, prompt
 * cache hits, tool-call validity, retries the app had to ask for, escalations
 * from the light model, phases reached.
 *
 *   npx tsx scripts/lesson-sim.ts [--topic "…"] [--turns 16] [--strong sonnet:high]
 *                                 [--cheap haiku:low] [--vision sonnet:medium] [--seed 7]
 *
 * Output: D:\tmp\lh-sim\<timestamp>\{report.json, transcript.txt, data/}.
 * Spends real subscription usage — roughly one model call per learner turn.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const TOPIC = opt("topic", "I want to understand what a proof by induction really is. I'm comfortable with high-school calculus but new to formal proofs.");
const TURNS = Number(opt("turns", "16"));
const SEED = Number(opt("seed", "7"));
const slotSpec = (v: string) => {
	const [id, level] = v.split(":");
	return { id: id!, level: level as "low" | "medium" | "high" | undefined };
};
const STRONG = slotSpec(opt("strong", "sonnet:high"));
const CHEAP = slotSpec(opt("cheap", "haiku:low"));
const VISION = slotSpec(opt("vision", "sonnet:medium"));

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join(opt("out", "D:/tmp/lh-sim"), stamp);
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
process.env.LH_DATA_DIR = path.join(OUT, "data"); // before any app module loads
process.env.CLAUDE_CLI_WORKDIR ??= path.join(OUT, "cli-work");

const { writeSettings } = await import("../src/store/settings.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { danglingQuestionOf, hasProbeDone } = await import("../src/core/native-messages.ts");
const { toolQuestionKind } = await import("../src/core/pending.ts");
const q = await import("../src/core/question-core.ts");
const { resetPoolForTests } = await import("../src/agent/claude-cli-pool.ts");

type Q = import("../src/core/question-core.ts").QuestionData;

// ── the learner: a seeded, plausible, imperfect student ──
let rng = SEED >>> 0;
const rand = () => {
	rng = (rng + 0x6d2b79f5) >>> 0;
	let t = rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const THINKING = [
	"My gut says this one, though I'm not fully sure why the other options fail.",
	"I'm reasoning by analogy with something I know from calculus — it might not transfer.",
	"I narrowed it to two and picked the one that feels more like what we just discussed.",
	"Honestly guessing a bit; the wording of the question threw me.",
];
const RECALL = [
	"I think the idea is a chain: prove the first step, then show each step forces the next, so all of them follow — like dominoes.",
	"The base case anchors it, and the inductive step is a conditional: if it holds for k then it holds for k+1. Together that covers every natural number.",
	"I'm not sure about the 'why it's valid' part; I only know the recipe: base case, assume for k, show for k+1.",
];

interface Pending {
	toolCallId: string;
	tool: string;
	input: unknown;
}

function questionData(p: Pending): Q {
	const kind = toolQuestionKind(p.tool);
	const input = p.input as Record<string, any>;
	const multi = input.multiSelect === true;
	const hasOptions = Array.isArray(input.options) && input.options.length > 0;
	const mode: Q["mode"] = kind === "quiz" ? (multi ? "multi-select" : "single-select") : hasOptions ? (multi ? "multi-select" : "single-select") : "text";
	const options = q.normalizeOptions((input.options ?? []) as { label: string; value?: string }[]);
	const ordered = kind === "quiz" && options.length > 0 ? q.shuffleOptions(options, q.seededRandom(p.toolCallId)) : options;
	const qd: Q = {
		id: p.toolCallId,
		kind,
		questionType: kind === "quiz" ? q.normalizeQuizType(input.type) : undefined,
		question: String(input.question ?? ""),
		context: input.details,
		mode,
		options: ordered,
		createdAt: new Date().toISOString(),
	};
	if (kind === "quiz") {
		const resolved = q.resolveCorrect(input.correctAnswer, ordered);
		qd.correctIndices = resolved.indices;
		qd.explanation = input.explanation;
	}
	if (kind === "explain") qd.committedAnswer = input.correctAnswer;
	return qd;
}

function answerFor(p: Pending) {
	const qd = questionData(p);
	const thinking = pick(THINKING);
	if (qd.kind === "quiz") {
		const correct = qd.correctIndices ?? [];
		const wantRight = rand() < 0.6 && correct.length > 0;
		const idxs = wantRight ? correct : qd.options.map((_, i) => i).filter((i) => !correct.includes(i));
		const chosen = qd.mode === "multi-select" ? idxs : idxs.length ? [pick(idxs)] : [0];
		const values = chosen.map((i) => qd.options[i]?.value).filter((v): v is string => typeof v === "string");
		return q.buildAnswer(qd, { values, thinking, confidence: pick([50, 70, 90]) }, p.tool);
	}
	if (qd.kind === "explain") return q.buildAnswer(qd, { text: pick(RECALL), thinking }, p.tool);
	if (qd.options.length > 0) return q.buildAnswer(qd, { values: [qd.options[Math.min(1, qd.options.length - 1)]!.value], thinking }, p.tool);
	return q.buildAnswer(qd, { text: pick(RECALL), thinking }, p.tool);
}

// ── plumbing ──
const post = (chatId: string, input: unknown) =>
	new Request("http://sim/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, input }) });

async function settle(chatId: string, timeoutMs = 600_000): Promise<void> {
	const t0 = Date.now();
	for (;;) {
		const handle = runningTurn(chatId);
		if (handle) await new Response(handle.subscribe()).text().catch(() => "");
		const jobsRunning = jobStore.listJobs(chatId).some((j) => j.status === "running");
		if (!handle && !isTurnRunning(chatId) && !jobsRunning) return;
		if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting for the turn/jobs to settle");
		await new Promise((r) => setTimeout(r, 400));
	}
}

writeSettings({
	version: 1,
	models: {
		strong: { model: { provider: "claude-cli", id: STRONG.id }, ...(STRONG.level ? { thinkingLevel: STRONG.level } : {}) },
		cheap: { model: { provider: "claude-cli", id: CHEAP.id }, ...(CHEAP.level ? { thinkingLevel: CHEAP.level } : {}) },
		vision: { model: { provider: "claude-cli", id: VISION.id }, ...(VISION.level ? { thinkingLevel: VISION.level } : {}) },
	},
});

const chat = chatStore.createChat(TOPIC.slice(0, 60));
const log: string[] = [];
const say = (s: string) => {
	console.log(s);
	log.push(s);
};

interface CallRow {
	turn: number;
	model: string;
	answeredBy: string;
	ms: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	tools: string[];
	toolErrors: string[];
	stop: string;
	error?: string;
}
const calls: CallRow[] = [];
const toolCounts: Record<string, number> = {};
const problems: string[] = [];

let seen = 0;
function harvest(turn: number): void {
	const rec = chatStore.getChat(chat.id)!;
	const fresh = rec.messages.slice(seen);
	seen = rec.messages.length;
	const resultErrors = new Map<string, string>();
	for (const m of fresh as any[]) {
		if (m.role === "toolResult" && m.isError) {
			const text = (m.content ?? []).map((c: any) => c.text ?? "").join(" ").replace(/\s+/g, " ").slice(0, 220);
			resultErrors.set(m.toolCallId, `${m.toolName}: ${text}`);
		}
	}
	for (const m of fresh as any[]) {
		if (m.role === "user") {
			say(`  [learner] ${typeof m.content === "string" ? m.content.slice(0, 160) : "(structured)"}`);
		} else if (m.role === "assistant") {
			const toolCalls = m.content.filter((c: any) => c.type === "toolCall");
			for (const c of toolCalls) toolCounts[c.name] = (toolCounts[c.name] ?? 0) + 1;
			const errs = toolCalls.flatMap((c: any) => [c.argumentsError ? `${c.name}: argumentsError ${String(c.argumentsError).slice(0, 120)}` : "", resultErrors.get(c.id) ?? ""]).filter(Boolean);
			problems.push(...errs.map((e: string) => `turn ${turn}: ${e}`));
			calls.push({
				turn,
				model: m.model,
				answeredBy: m.responseModel ?? m.model,
				ms: m.durationMs ?? 0,
				input: m.usage?.input ?? 0,
				cacheRead: m.usage?.cacheRead ?? 0,
				cacheWrite: m.usage?.cacheWrite ?? 0,
				output: m.usage?.output ?? 0,
				tools: toolCalls.map((c: any) => c.name),
				toolErrors: errs,
				stop: m.stopReason,
				...(m.errorMessage ? { error: m.errorMessage } : {}),
			});
			const text = m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
			say(`  [teacher${m.responseModel ? `→${m.responseModel}` : ""}] ${m.durationMs ?? "?"}ms in:${m.usage?.input} cr:${m.usage?.cacheRead} cw:${m.usage?.cacheWrite} out:${m.usage?.output} ${m.stopReason}${m.errorMessage ? ` ERROR ${m.errorMessage}` : ""}`);
			if (text) say(`      ${text.slice(0, 400).replace(/\n/g, "\n      ")}`);
			for (const c of toolCalls) say(`      → ${c.name}(${JSON.stringify(c.arguments).slice(0, 300)})${c.argumentsError ? "  !! " + c.argumentsError : ""}`);
		} else if (m.role === "toolResult") {
			if (m.isError) say(`  [tool error] ${resultErrors.get(m.toolCallId)}`);
		}
	}
}

say(`# lesson sim — ${TOPIC}\n# strong ${STRONG.id}:${STRONG.level} cheap ${CHEAP.id}:${CHEAP.level} vision ${VISION.id}:${VISION.level} · ${TURNS} turns · seed ${SEED}\n`);
let input: unknown = { type: "text", text: TOPIC };
let idleReplies = 0;
const wall0 = Date.now();
let turnsRun = 0;

for (let turn = 1; turn <= TURNS; turn++) {
	const t0 = Date.now();
	say(`\n── turn ${turn} (${JSON.stringify(input).slice(0, 90)})`);
	const ack = await handleChatRequest(post(chat.id, input));
	if (ack.status !== 200) {
		say(`!! turn refused: ${ack.status} ${await ack.text()}`);
		problems.push(`turn ${turn}: refused ${ack.status}`);
		break;
	}
	await settle(chat.id);
	turnsRun = turn;
	harvest(turn);
	say(`  (turn wall ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

	const rec = chatStore.getChat(chat.id)!;
	const last = rec.messages.at(-1) as any;
	if (last?.role === "assistant" && last.stopReason === "error") {
		problems.push(`turn ${turn}: assistant error ${last.errorMessage}`);
		break;
	}
	const pending = danglingQuestionOf(rec.messages as any);
	if (pending) {
		idleReplies = 0;
		input = { type: "answer", toolCallId: pending.toolCallId, answer: answerFor(pending) };
	} else {
		if (++idleReplies > 2) {
			say("(no question pending after repeated nudges — stopping)");
			break;
		}
		input = { type: "text", text: "Okay — please continue." };
	}
}

// ── report ──
const rec = chatStore.getChat(chat.id)!;
const phase = hasProbeDone(rec.messages as any) ? "teach (probe concluded)" : "probe";
const planInit = (rec.messages as any[]).some((m) => m.role === "assistant" && m.content.some((c: any) => c.type === "toolCall" && c.name === "plan_init"));
const sum = (f: (c: CallRow) => number) => calls.reduce((a, c) => a + f(c), 0);
const lat = calls.map((c) => c.ms).sort((a, b) => a - b);
const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0;
const read = sum((c) => c.cacheRead);
const written = sum((c) => c.cacheWrite);
const fresh = sum((c) => c.input);
const report = {
	topic: TOPIC,
	turnsRun,
	wallSeconds: Math.round((Date.now() - wall0) / 1000),
	modelCalls: calls.length,
	phaseReached: phase,
	planInitCalled: planInit,
	latencyMs: { median: pct(0.5), p90: pct(0.9), max: lat.at(-1) ?? 0 },
	tokens: { uncachedInput: fresh, cacheRead: read, cacheWrite: written, output: sum((c) => c.output), cacheReadShareOfInput: Number((read / Math.max(1, read + written + fresh)).toFixed(3)) },
	toolCalls: toolCounts,
	escalations: calls.filter((c) => c.answeredBy !== c.model).length,
	callErrors: calls.filter((c) => c.error).length,
	toolProblems: problems,
	messages: rec.messages.length,
};
say(`\n# REPORT\n${JSON.stringify(report, null, 2)}`);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ report, calls }, null, 2));
fs.writeFileSync(path.join(OUT, "transcript.txt"), log.join("\n"));
console.log(`\nwritten: ${OUT}`);
resetPoolForTests();
process.exit(0);
