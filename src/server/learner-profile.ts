/**
 * Auto-calibration server seam (fork, Sprint phase 4): gathers friction
 * evidence across every session and applies his decisions.
 */
import {
	FRICTION_CATEGORIES,
	frictionHits,
	profilePromptSegment,
	profileView,
	projectView,
	type AdaptationView,
	type FrictionCategory,
	type FrictionHit,
} from "../core/index.ts";
import { readLearnerProfile, writeLearnerProfile } from "../store/learner-profile.ts";
import { stores } from "./stores.ts";

function allFrictionHits(): FrictionHit[] {
	const hits: FrictionHit[] = [];
	for (const summary of stores.chatStore.listChats()) {
		const record = stores.chatStore.getChat(summary.id);
		if (!record || record.kind === "practice") continue;
		try {
			hits.push(...frictionHits(record.id, record.title, projectView(record.messages)));
		} catch {
			// unreadable record: no evidence from it
		}
	}
	return hits;
}

export function learnerProfileState(): AdaptationView[] {
	return profileView(readLearnerProfile(), allFrictionHits());
}

export type ProfileAction = "approve" | "reject" | "on" | "off";

export function decideAdaptation(category: string, action: string): AdaptationView[] | null {
	if (!(FRICTION_CATEGORIES as readonly string[]).includes(category)) return null;
	if (action !== "approve" && action !== "reject" && action !== "on" && action !== "off") return null;
	const profile = readLearnerProfile();
	const hits = allFrictionHits();
	const count = hits.filter((h) => h.category === category).length;
	profile.adaptations[category as FrictionCategory] = {
		status: action === "approve" ? "on" : action === "reject" ? "rejected" : action,
		decidedAt: new Date().toISOString(),
		hitsAtDecision: count,
	};
	writeLearnerProfile(profile);
	return profileView(profile, hits);
}

/** The approved rules as a prompt segment ("" when none are on). */
export function learnerProfilePrompt(): string {
	return profilePromptSegment(readLearnerProfile());
}
