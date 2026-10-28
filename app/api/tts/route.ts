/**
 * POST { text, voice?, speed? } → audio/wav. Read-aloud narrator (fork):
 * the client splits a lesson into sentence-sized chunks and requests them one
 * by one, so playback starts after the first chunk. See src/server/tts.ts.
 */
import { TTS_DEFAULT_VOICE, TTS_MAX_CHARS, isTtsVoice, synthesizeSpeech } from "@/src/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
	let body: { text?: unknown; voice?: unknown; speed?: unknown };
	try {
		body = await req.json();
	} catch {
		return Response.json({ message: "Body must be JSON." }, { status: 400 });
	}
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text || text.length > TTS_MAX_CHARS) {
		return Response.json({ message: `text must be 1–${TTS_MAX_CHARS} characters.` }, { status: 400 });
	}
	const voice = typeof body.voice === "string" ? body.voice : TTS_DEFAULT_VOICE;
	if (!isTtsVoice(voice)) return Response.json({ message: "Unknown voice." }, { status: 400 });
	const speed = typeof body.speed === "number" && body.speed >= 0.6 && body.speed <= 1.6 ? body.speed : 1;

	try {
		const wav = await synthesizeSpeech(text, voice, speed);
		return new Response(new Uint8Array(wav), {
			headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
		});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return Response.json(
			{ message: `The narrator could not start (${detail.slice(0, 200)}). The first use downloads a ~330 MB voice model, so it needs internet once.` },
			{ status: 503 },
		);
	}
}
