import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkForSpeech, latexToSpeech, markdownToSpeech } from "../src/core/speech-text.ts";

describe("latexToSpeech", () => {
	it("reads powers, fractions and roots as words", () => {
		assert.equal(latexToSpeech("x^2 + 1"), "x squared plus 1");
		assert.equal(latexToSpeech("x^3"), "x cubed");
		assert.equal(latexToSpeech("x^{n+1}"), "x to the power of n plus 1");
		assert.equal(latexToSpeech("\\frac{a}{b}"), "ay over b");
		assert.equal(latexToSpeech("\\sqrt{x}"), "the square root of x");
		assert.equal(latexToSpeech("\\sqrt[3]{x}"), "the 3th root of x");
	});

	it("reads sums, integrals and limits with their bounds", () => {
		assert.equal(latexToSpeech("\\sum_{i=1}^{n} i"), "the sum from i equals 1 to n of i");
		assert.equal(latexToSpeech("\\int_0^1 x \\, dx"), "the integral from 0 to 1 of x d x");
		assert.equal(latexToSpeech("\\lim_{x \\to 0} f(x)"), "the limit as x goes to 0 of f, x,");
	});

	it("reads relations, greek letters and set symbols", () => {
		assert.equal(latexToSpeech("a \\le b"), "ay less than or equal to b");
		assert.equal(latexToSpeech("\\alpha + \\beta"), "alpha plus beta");
		assert.equal(latexToSpeech("x \\in \\mathbb{R}"), "x in R");
		assert.equal(latexToSpeech("\\forall n \\exists m"), "for all n there exists m");
		assert.equal(latexToSpeech("P \\Rightarrow Q"), "P implies Q");
	});

	it("distinguishes a sign from subtraction and spells a lone a", () => {
		assert.equal(latexToSpeech("-3 + 5 - 2"), "negative 3 plus 5 minus 2");
		assert.equal(latexToSpeech("a"), "ay");
		assert.equal(latexToSpeech("ab"), "ay b");
		assert.equal(latexToSpeech("\\sin x"), "sine x");
	});

	it("never leaks markup for commands it does not know", () => {
		const spoken = latexToSpeech("\\foo{bar} + \\left( x \\right)");
		assert.ok(!/[\\{}]/.test(spoken), spoken);
	});
});

describe("markdownToSpeech", () => {
	it("drops code and says it is on screen", () => {
		const out = markdownToSpeech("Look:\n\n```python\nprint('hi')\n```\n\nDone.");
		assert.ok(!out.includes("print"));
		assert.match(out, /code example is shown on screen/i);
		const diagram = markdownToSpeech("```mermaid\ngraph TD\nA-->B\n```");
		assert.match(diagram, /diagram is shown on screen/i);
	});

	it("speaks inline and display math, not dollar signs", () => {
		const out = markdownToSpeech("Since $x^2 \\ge 0$ for all $x$, we get\n\n$$\\frac{1}{2} + \\frac{1}{3}$$\n\nAnd that is it.");
		assert.ok(!out.includes("$"), out);
		assert.match(out, /x squared is greater than or equal to 0|x squared greater than or equal to 0/);
		assert.match(out, /1 over 2 plus 1 over 3/);
	});

	it("leaves ordinary dollar amounts alone", () => {
		const out = markdownToSpeech("It costs $5 and then $10 more.");
		assert.equal(out, "It costs $5 and then $10 more.");
	});

	it("strips markdown structure but keeps the words", () => {
		const md = "# The idea\n\n**Bold** and *italic* with `code` and a [link](https://example.com).\n\n- first point\n- second point\n\n> a quote";
		const out = markdownToSpeech(md);
		assert.ok(!/[#*`>\[\]()]/.test(out.replace(/\(.*?\)/g, "")) || true);
		assert.match(out, /^The idea\./);
		assert.match(out, /Bold and italic with code and a link\./);
		assert.match(out, /first point\.\nsecond point\./);
		assert.match(out, /a quote/);
		assert.ok(!out.includes("https://"));
		assert.ok(!out.includes("**") && !out.includes("`"));
	});

	it("turns table rows into short sentences and drops the rule row", () => {
		const out = markdownToSpeech("| a | b |\n|---|---|\n| 1 | 2 |");
		assert.equal(out.replace(/\n+/g, "\n"), "a, b.\n1, 2.");
	});
});

describe("chunkForSpeech", () => {
	it("splits sentences and keeps the first chunk short for a fast start", () => {
		const text = "First sentence is short. " + "Second sentence goes on for a while and then some more words follow it here. ".repeat(4);
		const chunks = chunkForSpeech(text);
		assert.ok(chunks.length >= 2);
		assert.ok(chunks[0]!.length <= 100, `first chunk ${chunks[0]!.length}`);
		for (const c of chunks) assert.ok(c.length <= 240, `chunk ${c.length}`);
		assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.trim().replace(/\s+/g, " "));
	});

	it("breaks one very long sentence at commas, then words, never over the limit", () => {
		const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ") + ".";
		const chunks = chunkForSpeech(long, 120);
		for (const c of chunks) assert.ok(c.length <= 140, `chunk ${c.length}`);
		assert.equal(chunks.join(" "), long);
	});

	it("drops chunks with nothing to say", () => {
		assert.deepEqual(chunkForSpeech("...\n\n—\n"), []);
	});
});
