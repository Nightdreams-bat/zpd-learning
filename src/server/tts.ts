/**
 * Read-aloud narrator (fork): local Kokoro-82M text-to-speech. Runs in this
 * server process on the CPU (no GPU, no API key, nothing leaves the machine).
 * The model (~330 MB, fp32: on this class of CPU it runs ~3x real time, the
 * int8 build only ~1.2x) downloads from Hugging Face on first use into
 * <data>/tts/model; every synthesized chunk is cached as a small 16-bit WAV in
 * <data>/tts/audio keyed by voice + speed + text, so replays are instant.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

export const TTS_DEFAULT_VOICE = "am_onyx";
export const TTS_MAX_CHARS = 1000;
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SAMPLE_RATE = 24000;
const CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;

const AUDIO_DIR = path.join(PATHS.data, "tts", "audio");
const MODEL_DIR = path.join(PATHS.data, "tts", "model");

export function isTtsVoice(id: string): boolean {
	return /^[ab][fm]_[a-z]+$/.test(id);
}

type Engine = {
	generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

let engine: Promise<Engine> | null = null;
// One synthesis at a time: the ONNX session is not re-entrant and the CPU is the bottleneck anyway.
let queue: Promise<unknown> = Promise.resolve();
let writesSincePrune = 0;

function loadEngine(): Promise<Engine> {
	engine ??= (async () => {
		const [{ KokoroTTS }, { env }] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
		env.cacheDir = MODEL_DIR;
		return (await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "fp32", device: "cpu" })) as unknown as Engine;
	})().catch((err) => {
		engine = null; // a failed first download must be retryable
		throw err;
	});
	return engine;
}

/** 16-bit mono PCM WAV: half the size of the model's float output, no audible loss. */
function encodeWav(samples: Float32Array, rate: number): Buffer {
	const data = Buffer.alloc(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		const v = Math.max(-1, Math.min(1, samples[i]!));
		data.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
	}
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

function pruneCache(): void {
	try {
		const files = fs.readdirSync(AUDIO_DIR).map((name) => {
			const file = path.join(AUDIO_DIR, name);
			const st = fs.statSync(file);
			return { file, size: st.size, mtime: st.mtimeMs };
		});
		let total = files.reduce((n, f) => n + f.size, 0);
		for (const f of files.sort((a, b) => a.mtime - b.mtime)) {
			if (total <= CACHE_LIMIT_BYTES) break;
			fs.rmSync(f.file, { force: true });
			total -= f.size;
		}
	} catch {
		// best effort: a cache that cannot be pruned is still a working cache
	}
}

/** Synthesize one chunk of text to a WAV. Throws if the model cannot be loaded. */
export async function synthesizeSpeech(text: string, voice = TTS_DEFAULT_VOICE, speed = 1): Promise<Buffer> {
	const key = crypto.createHash("sha1").update(`${voice}\n${speed}\n${text}`).digest("hex");
	const cached = path.join(AUDIO_DIR, `${key}.wav`);
	try {
		const hit = fs.readFileSync(cached);
		const now = new Date();
		fs.utimesSync(cached, now, now); // recency for pruning
		return hit;
	} catch {
		// miss
	}
	const run = queue.then(async () => {
		const tts = await loadEngine();
		const audio = await tts.generate(text, { voice, speed });
		const wav = encodeWav(audio.audio, audio.sampling_rate || SAMPLE_RATE);
		fs.mkdirSync(AUDIO_DIR, { recursive: true });
		const tmp = `${cached}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, wav);
		fs.renameSync(tmp, cached);
		if (++writesSincePrune >= 50) { writesSincePrune = 0; pruneCache(); }
		return wav;
	});
	queue = run.catch(() => undefined);
	return run;
}
