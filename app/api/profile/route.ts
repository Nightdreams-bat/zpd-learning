import { decideAdaptation, learnerProfileState } from "@/src/server";

/** Auto-calibration (fork, Sprint phase 4): the adaptations with their
 *  evidence, and his decisions on them. */
export async function GET() {
	return Response.json({ adaptations: learnerProfileState() });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { category?: unknown; action?: unknown };
	const result = decideAdaptation(String(body.category ?? ""), String(body.action ?? ""));
	if (!result) return Response.json({ error: "Unknown category or action" }, { status: 400 });
	return Response.json({ adaptations: result });
}
