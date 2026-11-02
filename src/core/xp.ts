/**
 * The XP engine (fork, Sprint mode game layer, 2026-10-31). PURE: XP is a
 * fold over the session's view messages, never stored — the record is the
 * truth, so XP can't drift from what actually happened.
 *
 * Owner rule: XP comes ONLY from understanding — right answers, good
 * say-backs, defeated bosses. Time spent and message count earn nothing.
 *
 * Free-recall answers have no client verdict (the model grades in prose),
 * so Sprint mode's teacher opens those reactions with a verdict line
 * (prompts/sprint/teacher/25-sprint.md): **✓ Right.** / **◐ Partly.** /
 * **✗ Not yet.** and the pitch verdict **⚔ Boss defeated.**
 */
import type { LhViewMessage } from "./view.ts";
import type { QuestionAnswerData } from "./question-core.ts";

export type XpKind = "probe" | "predict" | "check" | "recall" | "called-it" | "combo" | "boss";

export interface XpEvent {
	/** Stable id — the HUD animates events it hasn't seen yet. */
	id: string;
	kind: XpKind;
	amount: number;
	label: string;
}

export interface RecallCard {
	question: string;
	answer: string;
}

export const XP = {
	probeRight: 10,
	sayBack: 5,
	predictRight: 15,
	predictTry: 3,
	checkRight: 20,
	recallRight: 20,
	recallPartly: 8,
	calledIt: 5,
	combo: 10,
	boss: 100,
} as const;

const QUESTION_PARTS = new Set(["tool-quiz", "tool-probe", "tool-explain", "tool-recall", "tool-ask_user_question"]);
const VERDICT_RIGHT = /\*\*✓\s*Right\.?\*\*/;
const VERDICT_PARTLY = /\*\*◐\s*Partly\.?\*\*/;
const VERDICT_BOSS = /\*\*⚔\s*Boss defeated\.?\*\*/;

function answerOf(part: { state?: string; output?: unknown }): QuestionAnswerData | null {
	if (part.state !== "output-available") return null;
	const out = part.output as QuestionAnswerData | undefined;
	if (!out || typeof out !== "object" || !("kind" in out) || out.dismissed) return null;
	return out;
}

/** Every XP event in one session, in transcript order. */
export function sessionXpEvents(messages: readonly LhViewMessage[]): XpEvent[] {
	const events: XpEvent[] = [];
	let streak = 0;
	// The last free-text answer still waiting for the teacher's verdict line.
	let awaitingVerdict: string | null = null;
	const right = (id: string) => {
		streak += 1;
		if (streak >= 3) events.push({ id: `${id}:combo`, kind: "combo", amount: XP.combo, label: `Combo ×${streak}` });
	};
	for (const message of messages) {
		message.parts.forEach((part, i) => {
			if (message.role === "assistant" && part.type === "text" && typeof part.text === "string") {
				const id = `${message.id}:${i}`;
				if (VERDICT_BOSS.test(part.text)) {
					events.push({ id: `${id}:boss`, kind: "boss", amount: XP.boss, label: "Boss defeated" });
					awaitingVerdict = null;
					right(id);
				} else if (awaitingVerdict && VERDICT_RIGHT.test(part.text)) {
					events.push({ id: `${awaitingVerdict}:right`, kind: "recall", amount: XP.recallRight, label: "Explained it" });
					right(awaitingVerdict);
					awaitingVerdict = null;
				} else if (awaitingVerdict && VERDICT_PARTLY.test(part.text)) {
					events.push({ id: `${awaitingVerdict}:partly`, kind: "recall", amount: XP.recallPartly, label: "Partly there" });
					streak = 0;
					awaitingVerdict = null;
				}
				return;
			}
			if (!QUESTION_PARTS.has(part.type)) return;
			const answer = answerOf(part);
			if (!answer) return;
			const id = String(part.toolCallId ?? `${message.id}:${i}`);
			if (answer.kind === "quiz") {
				if (answer.dontKnow) { streak = 0; return; }
				const isProbe = answer.tool === "probe" || !answer.questionType;
				if (answer.correct) {
					if (isProbe) events.push({ id, kind: "probe", amount: XP.probeRight, label: "Calibration hit" });
					else if (answer.questionType === "predict") events.push({ id, kind: "predict", amount: XP.predictRight, label: "Predicted it" });
					else events.push({ id, kind: "check", amount: XP.checkRight, label: "Locked in" });
					if ((answer.confidence ?? 0) >= 70) events.push({ id: `${id}:called`, kind: "called-it", amount: XP.calledIt, label: "Called it" });
					right(id);
				} else {
					if (answer.questionType === "predict") events.push({ id, kind: "predict", amount: XP.predictTry, label: "Took a shot" });
					streak = 0;
				}
				return;
			}
			// Free text (explain / recall / a typed ask answer): the say-back
			// earns a little now; the teacher's verdict line earns the rest.
			const text = (answer.text ?? answer.other ?? "").trim();
			if (!text || answer.dontKnow) { streak = 0; return; }
			if (answer.tool === "recall") events.push({ id, kind: "probe", amount: XP.sayBack, label: "Said it back" });
			awaitingVerdict = id;
		});
	}
	return events;
}

export function sumXp(events: readonly XpEvent[]): number {
	return events.reduce((n, e) => n + e.amount, 0);
}

/** XP to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
	return 100 + 50 * (level - 1);
}

const TITLES = ["Novice", "Apprentice", "Thinker", "Builder", "Analyst", "Strategist", "Engineer", "Architect", "Sage", "Polymath", "Legend"];

export interface LevelInfo {
	level: number;
	title: string;
	/** XP earned inside the current level. */
	into: number;
	/** XP the current level needs in total. */
	needed: number;
}

export function levelFor(totalXp: number): LevelInfo {
	let level = 1;
	let rest = Math.max(0, totalXp);
	while (rest >= xpForLevel(level)) {
		rest -= xpForLevel(level);
		level += 1;
	}
	const title = TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))]!;
	return { level, title, into: rest, needed: xpForLevel(level) };
}

/** Flash cards for the waiting time: the session's own answered questions. */
export function recallCards(messages: readonly LhViewMessage[]): RecallCard[] {
	const cards: RecallCard[] = [];
	for (const message of messages) {
		for (const part of message.parts) {
			if (!QUESTION_PARTS.has(part.type) || part.type === "tool-ask_user_question") continue;
			const answer = answerOf(part);
			if (!answer) continue;
			const right = answer.kind === "quiz"
				? (answer.options ?? []).filter((o) => (answer.correctIndices ?? []).includes(o.index)).map((o) => o.label).join(" · ")
				: (answer.committed ?? "");
			if (answer.questionText && right) cards.push({ question: answer.questionText, answer: right });
		}
	}
	return cards;
}
