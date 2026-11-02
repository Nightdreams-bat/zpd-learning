/**
 * Auto-calibration (fork, Sprint phase 4, 2026-10-31). PURE.
 *
 * Layer 1 (instant) lives in the teacher prompt: when he trips, the teacher
 * adapts at once and writes a tagged line, e.g.
 *   *↻ wording — Simplified wording, fewer terms from here.*
 * Layer 2 (lasting) is here: those tags are counted across sessions; a
 * category seen ≥3 times in ≥2 sessions becomes a PROPOSAL. Nothing
 * changes until he approves it; approved rules are injected into the
 * prober's and teacher's prompts, and he can switch any of them off.
 */
import type { LhViewMessage } from "./view.ts";

export const FRICTION_CATEGORIES = ["wording", "syntax", "smaller-steps", "bigger-steps", "concrete-first"] as const;
export type FrictionCategory = (typeof FRICTION_CATEGORIES)[number];

export const ADAPTATIONS: Record<FrictionCategory, { title: string; noticed: string; rule: string }> = {
	wording: {
		title: "Plain words first",
		noticed: "Technical wording keeps tripping you up.",
		rule: "Technical wording trips him. Apply the Feynman ladder strictly: story first, then the name, then the formula. Short sentences, everyday words. When a term comes back later, re-say it in plain words once.",
	},
	syntax: {
		title: "Template before syntax",
		noticed: "You get the idea right but trip on syntax or notation.",
		rule: "He gets ideas right but trips on syntax and notation. Before asking him to write a formula, symbol, or code, show one worked template. Grade the idea and the syntax separately and say which one slipped.",
	},
	"smaller-steps": {
		title: "Smaller steps",
		noticed: "Big steps keep losing you.",
		rule: "Big steps lose him. One fact per step, a check after each, and never two new terms in one step.",
	},
	"bigger-steps": {
		title: "Bigger steps",
		noticed: "You keep getting things right fast.",
		rule: "He moves fast. Take bigger steps, skip checks on the obvious, and make predictions harder.",
	},
	"concrete-first": {
		title: "Example before rule",
		noticed: "Abstract explanations don't land until you see an example.",
		rule: "Abstract statements don't land for him until he sees a case. Lead every idea with a concrete example or picture, then state the general rule.",
	},
};

export const PROPOSAL_MIN_HITS = 3;
export const PROPOSAL_MIN_SESSIONS = 2;

const TAG_RE = new RegExp(`\\*\\s*↻\\s*(${FRICTION_CATEGORIES.join("|")})\\s*[—–-]\\s*([^*\\n]+)\\*`, "g");

export interface FrictionHit {
	category: FrictionCategory;
	chatId: string;
	chatTitle: string;
	/** The teacher's own adaptation line — the evidence shown to him. */
	note: string;
}

/** The friction tags in one session's teacher prose. */
export function frictionHits(chatId: string, chatTitle: string, messages: readonly LhViewMessage[]): FrictionHit[] {
	const hits: FrictionHit[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type !== "text" || typeof part.text !== "string") continue;
			for (const m of part.text.matchAll(TAG_RE)) {
				hits.push({ category: m[1] as FrictionCategory, chatId, chatTitle, note: m[2]!.trim() });
			}
		}
	}
	return hits;
}

export type AdaptationStatus = "on" | "off" | "rejected";

/** The persisted profile: his decisions only. Evidence is always re-derived. */
export interface LearnerProfile {
	adaptations: Partial<Record<FrictionCategory, { status: AdaptationStatus; decidedAt: string; hitsAtDecision: number }>>;
}

export interface AdaptationView {
	category: FrictionCategory;
	title: string;
	noticed: string;
	rule: string;
	hits: number;
	sessions: number;
	evidence: FrictionHit[];
	/** "pending" = crossed the threshold, waiting for his tap. */
	status: AdaptationStatus | "pending" | "watching";
}

export function profileView(profile: LearnerProfile, hits: readonly FrictionHit[]): AdaptationView[] {
	return FRICTION_CATEGORIES.map((category) => {
		const own = hits.filter((h) => h.category === category);
		const sessions = new Set(own.map((h) => h.chatId)).size;
		const decided = profile.adaptations[category];
		const crossed = own.length >= PROPOSAL_MIN_HITS && sessions >= PROPOSAL_MIN_SESSIONS;
		// A rejection holds until the pattern keeps going: 3 more hits re-propose.
		const reproposed = decided?.status === "rejected" && own.length >= decided.hitsAtDecision + PROPOSAL_MIN_HITS;
		const status: AdaptationView["status"] = decided && !reproposed ? decided.status : crossed ? "pending" : "watching";
		return { category, ...ADAPTATIONS[category], hits: own.length, sessions, evidence: own.slice(-5), status };
	});
}

/** The prompt segment for the approved rules, or "" when none are on. */
export function profilePromptSegment(profile: LearnerProfile): string {
	const rules = FRICTION_CATEGORIES.filter((c) => profile.adaptations[c]?.status === "on").map((c) => `- ${ADAPTATIONS[c].rule}`);
	if (rules.length === 0) return "";
	return `## His learner profile — approved by him, apply every turn\n\nLearned from his past sessions; he approved each rule:\n\n${rules.join("\n")}`;
}

export function sanitizeProfile(raw: unknown): LearnerProfile {
	const out: LearnerProfile = { adaptations: {} };
	const a = (raw as { adaptations?: unknown } | null)?.adaptations;
	if (!a || typeof a !== "object") return out;
	for (const c of FRICTION_CATEGORIES) {
		const v = (a as Record<string, unknown>)[c] as { status?: unknown; decidedAt?: unknown; hitsAtDecision?: unknown } | undefined;
		if (v && (v.status === "on" || v.status === "off" || v.status === "rejected")) {
			out.adaptations[c] = {
				status: v.status,
				decidedAt: typeof v.decidedAt === "string" ? v.decidedAt : "",
				hitsAtDecision: typeof v.hitsAtDecision === "number" ? v.hitsAtDecision : 0,
			};
		}
	}
	return out;
}
