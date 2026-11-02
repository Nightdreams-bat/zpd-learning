import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { serverExecute } from "../tool-execute.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import type { DemoResult } from "../../core/contracts.ts";
import { getHeadless, type DemoRunResult, type HeadlessApi } from "./headless.ts";
import { healToolRecord } from "../tools/heal.ts";
import { withMotionKit } from "../../core/motion-kit.ts";

/**
 * The demo-builder sub-agent (vision §2 interactive demos + §2.5 "sub-agents
 * verify; they never one-shot"): given a brief it writes a self-contained
 * single-file HTML/JS demo, TESTS IT HEADLESSLY (run_demo), and iterates
 * fix → re-run until clean — before anything reaches the lesson.
 *
 * Shape: a ToolLoopAgent with two executable tools (write_demo / run_demo) —
 * the engine is injectable (tests use a scripted faux engine) and the headless
 * API is injectable (tests use a fake; production uses the app's own
 * Chromium browser service, system Chrome as fallback).
 *
 * Failure semantics (decided in the W6 brief): `tested: true` means "the
 * verify loop ran"; on failure the result is { title, html: "", tested: true,
 * notes: "FAILED: <reason>" } — the card renders the failure note, no iframe.
 * The job wrapper treats html === "" as failure and marks the job error.
 */

export interface DemoBuilderInput {
	title: string;
	brief: string;
}

export interface DemoBuilderOptions {
	/** Test seam: scripted engine; production uses the demoBuilder role. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Max agent steps (each write/run/fix is one step). Default 12 ≈ 3 cycles —
	 *  the motion kit makes scenes short, so more cycles mostly burn tokens. */
	maxSteps?: number;
	/** Live activity-line callback (updates the job record). */
	onActivity?: (line: string) => void;
	/** Kills the run mid-model-call (2026-09 real-kill abort semantics). */
	abortSignal?: AbortSignal;
	/** Money channel: one call per agent step, folded into JobRecord.usage. */
	onUsage?: (usage: Usage) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

const INSTRUCTIONS = `You are a demo builder — a specialist sub-agent inside a learning application. You
receive a brief for ONE interactive teaching instrument and deliver a single self-contained HTML document
that runs it. You never see the lesson; the brief is everything you know.

Runtime contract (the document runs in a sandboxed iframe, sandbox="allow-scripts", opaque origin):
- Single file, no CDN imports. NO localStorage, sessionStorage, or document.cookie (they throw).
- The parent sizes the iframe to the document height automatically.

THE MOTION KIT — a global LH is ALREADY LOADED in every demo. It owns the player (dark 3Blue1Brown-style
stage, poster with a big play button, scrubbable timeline, captions as subtitles, predict pauses, speed,
loop, keyboard), the easing, the glow, the palette, and the free-play controls. You write ONLY the scene:
objects + a timeline. Never build your own player, buttons, or animation loop. Keep the scene short —
typically 40-120 lines. Write one <script> in <body>; nothing else is needed (no CSS).

Scene:  const s = LH.scene({ title: "Short title for the poster" });   // 720x380 stage, origin top-left
Objects (all return handles; o = options {color, fill, width, dash, glow, opacity, size, anchor}):
  s.axes({x:[min,max,step], y:[min,max,step], grid:true, labels:{x:"x", y:"f(x)"}})
     -> ax with ax.X(v), ax.Y(v), ax.P(x,y) -> [px,py], ax.plot(fn, {from, to, color, dash})
  s.line(x1,y1,x2,y2,o)  s.path(d,o)  s.circle(cx,cy,r,o)  s.rect(x,y,w,h,o)  s.polygon([[x,y],...],o)
  s.arrow(x1,y1,x2,y2,{color, curve: 0.25})   s.dot(x,y,{color, r})   s.group([objs])
  s.text("plain", x, y, o)   s.math("f(x) = x^2 + 1", x, y, o)  (math: ^ _ ^{..} _{..}, italic letters,
  upright sin/cos/log/lim; type Unicode for Greek and symbols: θ η Σ ∀ ∃ ∧ ∨ ¬ → ∈ ≤ √)
  Colors by name: blue teal green yellow gold red purple pink white grey dim faint grid (or any hex).
Timeline (runs in the order you write it; the player plays it):
  s.caption("html with <i>x</i> and <b>key</b>")   — subtitle from this point on
  s.play(anim, anim, ..., {dur: 1, lag: 0.1, ease: "smooth"|"out"|"back"|"linear"})  — anims together
  s.wait(0.8)    s.pause("Predict: where will x = 2 land?")   — stops and asks; learner continues
Animations:
  LH.create(o) draw strokes (groups/axes draw in staggered)   LH.write(text)   LH.fadeIn(o,[dx,dy])
  LH.fadeOut(o)   LH.grow(o) pop in   LH.shrink(o)   LH.move(o,dx,dy)   LH.moveTo(dot|text, x, y)
  LH.along(dot, p => [x,y], {trail: "yellow"})  move on any path, leaving a glowing trail
  LH.indicate(o) flash + pulse   LH.color(o,"red")   LH.dim(o, 0.25)   LH.show(o)   LH.scale(o, k)
  LH.count(textObj, from, to, v => v.toFixed(1))   LH.tween(p => {...})  custom; p goes 0..1 and the
  function must fully set what it touches from p alone (the timeline is scrubbable both ways).
Free play (live after the timeline ends; touching one jumps to the end state):
  s.slider({label, min, max, step, value, color, format: v => v.toFixed(2), onInput: v => {...}})
  s.switch({label: v => "p = " + (v ? "T" : "F"), value: true, onChange: v => {...}})
  const r = s.readout("text"); r.set("new text")
  In handlers, update elements directly: obj.el.setAttribute(...), dot.el.style.transform =
  "translate(" + x + "px," + y + "px)", textObj.setText("..."), path.el.setAttribute("d", ...).

Example (the whole demo):
<script>
const s = LH.scene({ title: "Where each input lands" });
const ax = s.axes({ x:[0,4,1], y:[0,9,1], grid:true, labels:{x:"x", y:"f(x)"} });
const f = x => 2*x + 1, line = ax.plot(f, { from:0, to:4 });
const eq = s.math("f(x) = 2x + 1", 250, 70, { color:"blue" }), dot = s.dot(...ax.P(0, f(0)));
s.caption("A function sends every input <i>x</i> to exactly one output.");
s.play(LH.create(ax), { dur:1.5 });  s.play(LH.create(line), LH.write(eq), { dur:1.2 });
s.play(LH.grow(dot), { dur:.6 });
s.caption("Watch <i>x</i> travel: the output climbs <b>2</b> for every step right.");
s.play(LH.along(dot, p => ax.P(3*p, f(3*p)), { trail:"yellow" }), { dur:2.5 });
s.pause("Where will <i>x</i> = 4 land?");
s.play(LH.along(dot, p => ax.P(3+p, f(3+p))), { dur:1 });  s.play(LH.indicate(dot));
s.caption("<i>f</i>(4) = <b>9</b>");  s.wait(1);
s.slider({ label:"x", min:0, max:4, value:4, onInput: v => { const [px,py] = ax.P(v, f(v));
  dot.el.style.transform = "translate(" + px + "px," + py + "px)"; } });
</script>

DIRECTION — 3Blue1Brown clarity:
- One idea. Every beat changes one thing; dim (LH.dim) what is not the focus.
- Build up from nothing: create the frame, then write the formula, then bring in the moving parts.
- Show the mechanism moving (along, count, trail) rather than captions describing it.
- Color = meaning and stays consistent: input blue, output yellow/gold, true/correct green, false/error
  red, a secondary quantity purple. Glow is on by default for plots and dots; don't add more effects.
- Captions: one short sentence each, at most ~6 in total. Put a s.pause wherever the brief marks PREDICT.
- Durations: 0.6-1.5 s per step, 2-3 s for a slow reveal; the whole timeline usually 10-30 s.
- Labels must never overlap lines or each other; keep everything inside the 720x380 stage with margins.
- Draw only what the brief specifies — never invent data. Correctness first: the picture must not lie.
- If the kit truly cannot express something, draw into s.svg directly inside LH.tween — still no player.

THE HOUSE RULE — never deliver untested:
1. Call write_demo with the complete HTML document.
2. Call run_demo with probe "LH.scenes[0].duration". It loads the file (kit included) in a headless
   browser, waits ~2s, and reports console errors, uncaught errors, failed requests, and the probe value
   (the timeline length in seconds — 0 or an error means the scene did not build).
3. If run_demo reports problems, FIX the document and call write_demo again, then run_demo again.
   Iterate until run_demo reports PASSED.
4. Only then finish. Your final message is 1-3 sentences of NOTES for the teacher (what the demo shows,
   its controls, what to try) — NEVER the HTML itself.

Never claim success you did not see: a PASSED run_demo is the only definition of done.`;

interface BuilderState {
	html: string | null;
	/** The html that the last run_demo tested (null = never tested). */
	testedHtml: string | null;
	lastResult: DemoRunResult | null;
}

const writeDemoInput = Type.Object({
	html: Type.String({ description: "The complete HTML document: <!doctype html>…</html>, all JS inline." }),
});

const runDemoInput = Type.Object({
	probe: Type.Optional(
		Type.String({
			description:
				"Optional JS expression evaluated in the page after settling, e.g. \"document.querySelectorAll('input').length\".",

		}),
	),
});

export function createDemoBuilderTools(
	state: BuilderState,
	headless: HeadlessApi,
	onActivity?: (line: string) => void,
): Record<string, AgentTool<any>> {
	return healToolRecord({
		write_demo: {
			name: "write_demo",
			label: "write_demo",
			description:
				"Write the complete self-contained HTML document for the demo (overwrites any previous version). " +
				"Always follow with run_demo to test it headlessly.",
			parameters: writeDemoInput,
			execute: serverExecute("write_demo", writeDemoInput, async ({ html }) => {
				if (!html || html.trim().length === 0) return "ERROR: empty document — write the full HTML.";
				state.html = html;
				onActivity?.(`write_demo: ${(html.length / 1024).toFixed(1)} KB`);
				return `Saved (${html.length} bytes). Now call run_demo to test it — never deliver untested.`;
			}),
		},
		run_demo: {
			name: "run_demo",
			label: "run_demo",
			description:
				"Headlessly execute the current demo in a browser and report console errors, uncaught errors, and failed requests. " +
				"Optionally pass a probe expression to assert on page state.",
			parameters: runDemoInput,
			execute: serverExecute("run_demo", runDemoInput, async ({ probe }) => {
				if (!state.html) return "ERROR: nothing to run — call write_demo first.";
				const reason = headless.unavailableReason();
				if (reason) return `HEADLESS UNAVAILABLE: ${reason}`;
				let result: DemoRunResult;
				try {
					result = await headless.runDemo(withMotionKit(state.html), probe ? { probe } : undefined);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					onActivity?.("run_demo: browser error");
					return `HEADLESS ERROR (retrying may help): ${msg}`;
				}
				state.testedHtml = state.html;
				state.lastResult = result;
				onActivity?.(
					result.ok ? "run_demo: clean" : `run_demo: ${summarizeCounts(result)}`,
				);
				return formatRunResult(result);
			}),
		},
	});
}

function summarizeCounts(result: DemoRunResult): string {
	const counts = [
		result.consoleErrors.length > 0 ? `${result.consoleErrors.length} console error${result.consoleErrors.length === 1 ? "" : "s"}` : null,
		result.pageErrors.length > 0 ? `${result.pageErrors.length} page error${result.pageErrors.length === 1 ? "" : "s"}` : null,
		result.failedRequests.length > 0 ? `${result.failedRequests.length} failed request${result.failedRequests.length === 1 ? "" : "s"}` : null,
	].filter(Boolean);
	return counts.length > 0 ? counts.join(", ") : "ok";
}

function formatRunResult(result: DemoRunResult): string {
	if (result.ok) {
		const probe =
			result.probeResult !== undefined
				? ` Probe result: ${JSON.stringify(result.probeResult) ?? "undefined"}.`
				: "";
		return `PASSED: no console errors, no uncaught errors, no failed requests.${probe} If you are satisfied, finish with your notes; otherwise keep improving and re-test.`;
	}
	const sections: string[] = [`FAILED: ${summarizeCounts(result)}.`];
	if (result.consoleErrors.length > 0)
		sections.push(`Console errors:\n${result.consoleErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.pageErrors.length > 0)
		sections.push(`Uncaught errors:\n${result.pageErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.failedRequests.length > 0)
		sections.push(`Failed requests:\n${result.failedRequests.slice(0, 10).map((r) => `- ${r}`).join("\n")}`);
	sections.push("Fix the document (write_demo) and re-test (run_demo).");
	return sections.join("\n");
}

/** Short summary of a run for failure notes. */
function failureSummary(result: DemoRunResult | null): string {
	if (!result) return "never tested";
	const details = [...result.consoleErrors, ...result.pageErrors, ...result.failedRequests].slice(0, 5);
	return details.length > 0 ? `${summarizeCounts(result)} — ${details.join(" | ")}` : summarizeCounts(result);
}

export async function runDemoBuilder(input: DemoBuilderInput, opts: DemoBuilderOptions = {}): Promise<DemoResult> {
	const headless = opts.headless ?? getHeadless();
	const title = input.title.trim() || "Interactive demo";
	const brief = input.brief.trim() || "(no brief)";
	const notes = (text: string) => (text.trim() ? text.trim() : undefined);

	const reason = headless.unavailableReason();
	if (reason) {
		return { title, html: "", tested: true, notes: `FAILED: ${reason}` };
	}

	const state: BuilderState = { html: null, testedHtml: null, lastResult: null };

	const prompt = [
		`Demo title: ${title}`,
		`Brief (all you know about the lesson — this comes from the teacher, verbatim):`,
		brief,
		"",
		"Build the demo, test it with run_demo, iterate until PASSED, then finish with your notes.",
	].join("\n");

	let finalText = "";
	try {
		const result = await runSubagent(Object.values(createDemoBuilderTools(state, headless, opts.onActivity)), {
			role: "demoBuilder",
			engine: opts.engine,
			systemPrompt: INSTRUCTIONS,
			prompt,
			maxTurns: opts.maxSteps ?? 12,
			abortSignal: opts.abortSignal,
			onUsage: (usage) => opts.onUsage?.(usage),
			onToolStart: (toolName) => opts.onActivity?.(toolName),
			chatId: opts.chatId,
		});
		finalText = result.text;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { title, html: "", tested: true, notes: `FAILED: the builder crashed — ${msg}` };
	}

	// The model produced nothing.
	if (!state.html) {
		return {
			title,
			html: "",
			tested: true,
			notes: `FAILED: the builder never wrote a demo.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`,
		};
	}

	// The verify gate: the delivered html must have a clean headless run —
	// even when the model claims success or forgets the final run_demo.
	if (state.testedHtml !== state.html || !state.lastResult?.ok) {
		opts.onActivity?.("final verification");
		let verify: DemoRunResult;
		try {
			verify = await headless.runDemo(state.html);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { title, html: "", tested: true, notes: `FAILED: final verification crashed — ${msg}` };
		}
		state.lastResult = verify;
		if (!verify.ok) {
			return {
				title,
				html: "",
				tested: true,
				notes: `FAILED: the demo never passed headless verification (${failureSummary(verify)}).`,
			};
		}
	}

	return { title, html: state.html, tested: true, notes: notes(finalText) };
}
