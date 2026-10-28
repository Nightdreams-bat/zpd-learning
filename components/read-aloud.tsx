"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { chunkForSpeech, markdownToSpeech } from "@/src/core";
import { BrailleSpinner } from "@/components/braille-spinner";

/** The narrator voice. Kokoro "onyx": American male (owner's pick). */
const READ_ALOUD_VOICE = "am_onyx";
const PREFETCH_AHEAD = 2;

type Status = "idle" | "loading" | "playing" | "paused" | "error";

interface Run {
	aborted: boolean;
	audio: HTMLAudioElement;
	urls: Map<number, Promise<string>>;
}

/** Only one passage is read at a time: starting a second stops the first. */
let activeStop: (() => void) | null = null;

async function fetchChunk(text: string, signal: AbortSignal): Promise<string> {
	const res = await fetch("/api/tts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, voice: READ_ALOUD_VOICE }),
		signal,
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(body?.message ?? `Narrator failed (${res.status})`);
	}
	return URL.createObjectURL(await res.blob());
}

/** Read-aloud state for one passage of lesson markdown. Chunks are fetched a
 *  couple ahead of the one playing, so audio starts after the first sentence
 *  and keeps flowing while the server synthesizes the rest. */
export function useReadAloud(markdown: string) {
	const [status, setStatus] = useState<Status>("idle");
	const [error, setError] = useState<string | null>(null);
	const run = useRef<Run | null>(null);
	const abort = useRef<AbortController | null>(null);

	const stop = useCallback(() => {
		const r = run.current;
		run.current = null;
		abort.current?.abort();
		abort.current = null;
		if (r) {
			r.aborted = true;
			r.audio.pause();
			r.audio.removeAttribute("src");
			for (const p of r.urls.values()) void p.then((u) => URL.revokeObjectURL(u), () => {});
		}
		if (activeStop === stop) activeStop = null;
		setStatus("idle");
	}, []);

	useEffect(() => stop, [stop]);

	const start = useCallback(async () => {
		activeStop?.();
		const chunks = chunkForSpeech(markdownToSpeech(markdown));
		if (chunks.length === 0) return;
		setError(null);
		setStatus("loading");
		const ctl = new AbortController();
		const r: Run = { aborted: false, audio: new Audio(), urls: new Map() };
		run.current = r;
		abort.current = ctl;
		activeStop = stop;

		const get = (i: number): Promise<string> | undefined => {
			if (i >= chunks.length) return undefined;
			let p = r.urls.get(i);
			if (!p) {
				p = fetchChunk(chunks[i]!, ctl.signal);
				p.catch(() => {}); // surfaced where it is awaited
				r.urls.set(i, p);
			}
			return p;
		};
		try {
			for (let i = 0; i < chunks.length && !r.aborted; i++) {
				const url = await get(i)!;
				for (let k = 1; k <= PREFETCH_AHEAD; k++) get(i + k);
				if (r.aborted) return;
				r.audio.src = url;
				const ended = new Promise<void>((resolve, reject) => {
					r.audio.onended = () => resolve();
					r.audio.onerror = () => reject(new Error("Audio playback failed."));
				});
				await r.audio.play();
				if (r.aborted) return;
				setStatus("playing");
				await ended;
				URL.revokeObjectURL(url);
			}
			if (!r.aborted) stop();
		} catch (err) {
			if (r.aborted) return;
			setError(err instanceof Error ? err.message : String(err));
			stop();
			setStatus("error");
		}
	}, [markdown, stop]);

	const toggle = useCallback(() => {
		const r = run.current;
		if (!r || status === "idle" || status === "error") { void start(); return; }
		if (status === "playing") { r.audio.pause(); setStatus("paused"); return; }
		if (status === "paused") { void r.audio.play(); setStatus("playing"); }
	}, [start, status]);

	return { status, error, toggle, stop };
}

const BUTTON =
	"grid size-7 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-all duration-200 ease-out hover:scale-110 hover:border-amber-400/60 hover:text-amber-500 focus-visible:opacity-100";

/** A small round control beside a lesson passage: read it aloud with the local
 *  narrator. Pairs with the passage's `group/step relative` wrapper. */
export function ReadAloudButton({ markdown }: { markdown: string }) {
	const { status, error, toggle, stop } = useReadAloud(markdown);
	const active = status !== "idle";
	const label =
		status === "playing" ? "Pause reading" : status === "paused" ? "Resume reading" : status === "loading" ? "Preparing the narrator" : "Read this aloud";
	return (
		<div className="absolute -right-9 top-[2.25rem] flex flex-col items-center gap-1.5">
			<button
				type="button"
				data-testid="read-aloud"
				aria-label={label}
				title={error ?? label}
				onClick={toggle}
				className={`${BUTTON} ${active || error ? "opacity-100 text-amber-500" : "opacity-0 group-hover/step:opacity-100"}`}
			>
				{status === "loading" ? (
					<BrailleSpinner label="Preparing the narrator" />
				) : status === "playing" ? (
					<PauseIcon className="size-3.5" />
				) : status === "paused" ? (
					<PlayIcon className="size-3.5" />
				) : (
					<Volume2Icon className="size-3.5" />
				)}
			</button>
			{active ? (
				<button type="button" data-testid="read-aloud-stop" aria-label="Stop reading" title="Stop reading" onClick={stop} className={`${BUTTON} opacity-100`}>
					<SquareIcon className="size-3" />
				</button>
			) : null}
			{error ? (
				<span role="alert" className="absolute right-9 top-0 w-64 rounded-md border bg-card p-2 text-xs text-destructive shadow-sm">
					{error}
				</span>
			) : null}
		</div>
	);
}
