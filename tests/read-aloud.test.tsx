/** Read-aloud button with a fake Audio element and fake /api/tts: no model, network or speakers. */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ReadAloudButton } from "../components/read-aloud.tsx";
import { chunkForSpeech, markdownToSpeech } from "../src/core/speech-text.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document });

const sentence = (n: number) => `Sentence number ${n} of this lesson goes on for a little while so it takes room.`;
const MARKDOWN = `**Lesson.** ${[1, 2, 3, 4, 5, 6].map(sentence).join(" ")}`;
const CHUNKS = chunkForSpeech(markdownToSpeech(MARKDOWN));

class FakeAudio {
	static all: FakeAudio[] = [];
	src = "";
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	paused = true;
	played: string[] = [];
	constructor() { FakeAudio.all.push(this); }
	async play() { this.paused = false; this.played.push(this.src); }
	pause() { this.paused = true; }
	removeAttribute() { this.src = ""; }
	end() { this.onended?.(); }
}

const realFetch = globalThis.fetch;
const roots: { root: Root; host: HTMLElement }[] = [];
let requests: { text: string; voice: string; aborted: boolean }[] = [];
let failWith: { status: number; message: string } | null = null;

function install() {
	FakeAudio.all = [];
	requests = [];
	failWith = null;
	Object.assign(globalThis, { Audio: FakeAudio });
	(URL as unknown as Record<string, unknown>).createObjectURL = () => `blob:fake-${requests.length}-${Math.random()}`;
	(URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
	globalThis.fetch = (async (_url: string, init: { body: string; signal: AbortSignal }) => {
		const body = JSON.parse(init.body) as { text: string; voice: string };
		const req = { text: body.text, voice: body.voice, aborted: false };
		requests.push(req);
		init.signal.addEventListener("abort", () => { req.aborted = true; });
		if (failWith) {
			return { ok: false, status: failWith.status, json: async () => ({ message: failWith!.message }) };
		}
		return { ok: true, status: 200, blob: async () => new Blob(["wav"]) };
	}) as unknown as typeof fetch;
}

async function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	roots.push({ root, host });
	await act(async () => { root.render(<div className="group/step relative"><ReadAloudButton markdown={MARKDOWN} /></div>); });
	return host;
}
const q = (host: ParentNode, id: string) => host.querySelector<HTMLElement>(`[data-testid='${id}']`);
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const click = async (el: HTMLElement | null) => { await act(async () => { el!.dispatchEvent(new dom.window.Event("click", { bubbles: true })); }); await flush(); };

afterEach(async () => {
	for (const { root, host } of roots.splice(0)) { await act(async () => root.unmount()); host.remove(); }
	globalThis.fetch = realFetch;
});

describe("ReadAloudButton", () => {
	it("splits the lesson into several chunks (fixture sanity)", () => {
		assert.ok(CHUNKS.length >= 3, `got ${CHUNKS.length} chunks`);
		assert.ok(!CHUNKS.join(" ").includes("**"), "markdown is stripped before speaking");
	});

	it("starts with the first chunk in the onyx voice and prefetches two ahead", async () => {
		install();
		const host = await mount();
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Read this aloud");
		assert.equal(q(host, "read-aloud-stop"), null);
		await click(q(host, "read-aloud"));
		assert.equal(requests[0]!.text, CHUNKS[0]);
		assert.equal(requests[0]!.voice, "am_onyx");
		assert.deepEqual(requests.map((r) => r.text), CHUNKS.slice(0, 3), "first chunk plus two prefetched");
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Pause reading");
		assert.ok(q(host, "read-aloud-stop"));
		assert.equal(FakeAudio.all[0]!.played.length, 1);
	});

	it("pauses, resumes, plays every chunk in order and returns to idle", async () => {
		install();
		const host = await mount();
		await click(q(host, "read-aloud"));
		await click(q(host, "read-aloud"));
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Resume reading");
		assert.equal(FakeAudio.all[0]!.paused, true);
		await click(q(host, "read-aloud"));
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Pause reading");
		assert.equal(FakeAudio.all[0]!.paused, false);
		for (let i = 0; i < CHUNKS.length; i++) {
			await act(async () => { FakeAudio.all[0]!.end(); });
			await flush();
		}
		assert.equal(new Set(FakeAudio.all[0]!.played).size, CHUNKS.length, "every chunk played once (the resume replays the current one)");
		assert.equal(FakeAudio.all[0]!.played.length, CHUNKS.length + 1, "plus exactly one resume");
		assert.equal(requests.length, CHUNKS.length, "every chunk fetched exactly once");
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Read this aloud");
		assert.equal(q(host, "read-aloud-stop"), null);
	});

	it("stop cancels the in-flight requests and goes idle", async () => {
		install();
		const host = await mount();
		await click(q(host, "read-aloud"));
		await click(q(host, "read-aloud-stop"));
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Read this aloud");
		assert.ok(requests.every((r) => r.aborted), "all pending requests aborted");
		assert.equal(FakeAudio.all[0]!.paused, true);
	});

	it("shows the server's message when the narrator cannot start", async () => {
		install();
		failWith = { status: 503, message: "The narrator could not start (offline)." };
		const host = await mount();
		await click(q(host, "read-aloud"));
		assert.match(host.textContent ?? "", /narrator could not start \(offline\)/);
		assert.equal(q(host, "read-aloud")!.getAttribute("aria-label"), "Read this aloud");
		assert.equal(FakeAudio.all[0]?.played.length ?? 0, 0);
	});

	it("starting a second passage stops the first", async () => {
		install();
		const a = await mount();
		const b = await mount();
		await click(q(a, "read-aloud"));
		assert.equal(q(a, "read-aloud")!.getAttribute("aria-label"), "Pause reading");
		await click(q(b, "read-aloud"));
		assert.equal(q(a, "read-aloud")!.getAttribute("aria-label"), "Read this aloud");
		assert.equal(q(b, "read-aloud")!.getAttribute("aria-label"), "Pause reading");
	});
});
