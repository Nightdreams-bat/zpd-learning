import { projectView, sessionXpEvents, sumXp } from "@/src/core";
import { getChat, listChats } from "@/src/server";

/** Lifetime XP across every session (fork, Sprint game layer). Derived
 *  from the records on each call — nothing is stored. `exclude` drops the
 *  open session so the client can add its own live count on top. */
export async function GET(req: Request) {
	const exclude = new URL(req.url).searchParams.get("exclude");
	let total = 0;
	let bosses = 0;
	for (const summary of listChats()) {
		if (summary.id === exclude) continue;
		const record = getChat(summary.id);
		if (!record) continue;
		try {
			const events = sessionXpEvents(projectView(record.messages));
			total += sumXp(events);
			bosses += events.filter((e) => e.kind === "boss").length;
		} catch {
			// A record the projection can't read earns nothing; never fail the HUD.
		}
	}
	return Response.json({ total, bosses });
}
