/**
 * The learner-profile file (fork, Sprint phase 4): his approve/reject/on/off
 * decisions only — evidence is re-derived from the session records.
 * data/learner-profile.json, written atomically.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { sanitizeProfile, type LearnerProfile } from "../core/learner-profile.ts";

const FILE = path.join(PATHS.data, "learner-profile.json");

export function readLearnerProfile(): LearnerProfile {
	try {
		return sanitizeProfile(JSON.parse(fs.readFileSync(FILE, "utf-8")));
	} catch {
		return { adaptations: {} };
	}
}

export function writeLearnerProfile(profile: LearnerProfile): void {
	fs.mkdirSync(PATHS.data, { recursive: true });
	const tmp = `${FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
	fs.renameSync(tmp, FILE);
}
