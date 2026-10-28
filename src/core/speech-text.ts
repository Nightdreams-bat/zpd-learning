/**
 * Read-aloud text preparation (fork: local Kokoro narrator). Pure: lesson
 * markdown in, plain spoken sentences out. A voice model reads symbols
 * literally ("dollar x caret two"), so this strips markdown, drops code, and
 * turns LaTeX into words ("x squared plus one") before anything is synthesized.
 */

const GREEK = [
	"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu",
	"nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];

const WORDS: Record<string, string> = {
	cdot: "times", times: "times", ast: "times", div: "divided by", pm: "plus or minus", mp: "minus or plus",
	le: "less than or equal to", leq: "less than or equal to", ge: "greater than or equal to",
	geq: "greater than or equal to", ne: "not equal to", neq: "not equal to", approx: "approximately",
	equiv: "is equivalent to", sim: "is similar to", propto: "is proportional to", in: "in", notin: "not in",
	ni: "contains", subset: "is a subset of", subseteq: "is a subset of or equal to", supset: "is a superset of",
	supseteq: "is a superset of or equal to", cup: "union", cap: "intersection", setminus: "minus",
	forall: "for all", exists: "there exists", nexists: "there does not exist", to: "goes to",
	rightarrow: "goes to", longrightarrow: "goes to", mapsto: "maps to", leftarrow: "comes from",
	Rightarrow: "implies", implies: "implies", Longrightarrow: "implies", Leftarrow: "is implied by",
	Leftrightarrow: "if and only if", iff: "if and only if", leftrightarrow: "if and only if",
	land: "and", wedge: "and", lor: "or", vee: "or", lnot: "not", neg: "not", infty: "infinity",
	partial: "partial", nabla: "nabla", ldots: "and so on", cdots: "and so on", dots: "and so on",
	vdots: "and so on", ddots: "and so on", emptyset: "the empty set", varnothing: "the empty set",
	mid: "divides", perp: "is perpendicular to", parallel: "is parallel to", angle: "angle",
	therefore: "therefore", because: "because", top: "true", bot: "false", hbar: "h bar",
	langle: "", rangle: "", lfloor: "floor of", rfloor: "", lceil: "ceiling of", rceil: "",
	log: "log", ln: "natural log", exp: "e to the", sin: "sine", cos: "cosine", tan: "tangent", sec: "secant",
	csc: "cosecant", cot: "cotangent", arcsin: "arc sine", arccos: "arc cosine", arctan: "arc tangent",
	sinh: "hyperbolic sine", cosh: "hyperbolic cosine", tanh: "hyperbolic tangent", max: "max", min: "min",
	sup: "supremum", inf: "infimum", det: "determinant", dim: "dimension", ker: "kernel", deg: "degree",
	gcd: "gcd", lcm: "lcm", arg: "arg", Pr: "probability", mod: "mod", bmod: "mod", pmod: "mod",
	prime: "prime", degree: "degrees", ell: "L", Re: "real part of", Im: "imaginary part of", star: "star",
	oplus: "direct sum", otimes: "tensor", circ: "composed with", bullet: "dot", dagger: "dagger",
};

/** Ambiguous when read as a word: a lone "a" is the article, so spell the letter. */
const LETTER_FIX: Record<string, string> = { a: "ay" };

const BIG_OPS = new Set(["sum", "prod", "int", "iint", "iiint", "oint", "lim", "limsup", "liminf", "bigcup", "bigcap"]);
const BIG_OP_NAME: Record<string, string> = {
	sum: "the sum", prod: "the product", int: "the integral", iint: "the double integral",
	iiint: "the triple integral", oint: "the contour integral", lim: "the limit", limsup: "the limit superior",
	liminf: "the limit inferior", bigcup: "the union", bigcap: "the intersection",
};
const STYLE_CMDS = new Set([
	"text", "textbf", "textit", "textrm", "textsf", "texttt", "mathrm", "mathbf", "mathit", "mathsf",
	"mathtt", "mathcal", "mathscr", "mathfrak", "mathbb", "boldsymbol", "bm", "operatorname", "mbox",
	"hbox", "emph", "displaystyle", "textstyle", "scriptstyle",
]);
const SPACE_CMDS = new Set([",", ";", ":", "!", " ", "quad", "qquad", "enspace", "thinspace", "medspace", "thickspace", "nobreakspace"]);
const SIZE_CMDS = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr"]);
const FUNCTIONS = new Set(Object.keys(WORDS).filter((k) => /^[a-zA-Z]{2,}$/.test(k)));

/** The index just past the group starting at s[i] ("{...}" with nesting, a
 *  command, or a single character), plus its inner text. */
function readGroup(s: string, i: number): { inner: string; end: number } {
	while (s[i] === " ") i++;
	if (i >= s.length) return { inner: "", end: i };
	if (s[i] === "{") {
		let depth = 0;
		for (let j = i; j < s.length; j++) {
			if (s[j] === "\\") { j++; continue; }
			if (s[j] === "{") depth++;
			else if (s[j] === "}" && --depth === 0) return { inner: s.slice(i + 1, j), end: j + 1 };
		}
		return { inner: s.slice(i + 1), end: s.length };
	}
	if (s[i] === "\\") {
		const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
		const len = m ? m[0].length : 1;
		return { inner: s.slice(i, i + len), end: i + len };
	}
	return { inner: s[i]!, end: i + 1 };
}

function spellVariables(letters: string): string {
	if (FUNCTIONS.has(letters)) return letters;
	return letters.split("").map((c) => LETTER_FIX[c] ?? c).join(" ");
}

/** Single characters and their spoken form. */
const SYMBOLS: Record<string, string> = {
	"=": "equals", "+": "plus", "<": "is less than", ">": "is greater than", "*": "times",
	"/": "divided by", "!": "factorial", "%": "percent", "'": "prime", "≤": "less than or equal to",
	"≥": "greater than or equal to", "≠": "not equal to", "≈": "approximately", "×": "times", "·": "times",
	"→": "goes to", "⇒": "implies", "⇔": "if and only if", "∞": "infinity", "∈": "in", "∑": "the sum of",
	"∫": "the integral of", "π": "pi", "−": "minus", "√": "the square root of", "|": "", "&": "",
	"(": ",", ")": ",", "[": ",", "]": ",", ",": ",", ".": ".", ";": ",", ":": ":",
};

/** LaTeX math to spoken English. Best effort: anything unknown is dropped
 *  quietly rather than read out as markup. */
export function latexToSpeech(tex: string): string {
	const out: string[] = [];
	const push = (w: string) => { if (w) out.push(w); };
	let i = 0;
	const s = tex.trim();
	const sub = (t: string) => latexToSpeech(t);

	/** Parse an optional _{..} / ^{..} pair (either order) after a big operator. */
	const limits = (from: number): { lower?: string; upper?: string; end: number } => {
		let end = from, lower: string | undefined, upper: string | undefined;
		for (let k = 0; k < 2; k++) {
			while (s[end] === " ") end++;
			if (s[end] === "_" && lower === undefined) { const g = readGroup(s, end + 1); lower = sub(g.inner); end = g.end; }
			else if (s[end] === "^" && upper === undefined) { const g = readGroup(s, end + 1); upper = sub(g.inner); end = g.end; }
			else break;
		}
		return { lower, upper, end };
	};

	while (i < s.length) {
		const c = s[i]!;
		if (c === "\\") {
			const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
			if (!m) { i++; continue; }
			const name = m[1]!;
			i += m[0].length;
			if (name === "frac" || name === "dfrac" || name === "tfrac") {
				const a = readGroup(s, i), b = readGroup(s, a.end);
				push(`${sub(a.inner)} over ${sub(b.inner)}`);
				i = b.end;
			} else if (name === "sqrt") {
				let root: string | undefined;
				if (s[i] === "[") { const close = s.indexOf("]", i); root = s.slice(i + 1, close); i = close + 1; }
				const g = readGroup(s, i);
				push(root ? `the ${sub(root)}th root of ${sub(g.inner)}` : `the square root of ${sub(g.inner)}`);
				i = g.end;
			} else if (name === "binom") {
				const a = readGroup(s, i), b = readGroup(s, a.end);
				push(`${sub(a.inner)} choose ${sub(b.inner)}`);
				i = b.end;
			} else if (BIG_OPS.has(name)) {
				const l = limits(i);
				i = l.end;
				if (name === "lim") push(`the limit${l.lower ? ` as ${l.lower}` : ""} of`);
				else push(`${BIG_OP_NAME[name]}${l.lower ? ` from ${l.lower}` : ""}${l.upper ? ` to ${l.upper}` : ""} of`);
			} else if (name === "overline" || name === "bar") {
				const g = readGroup(s, i); push(`${sub(g.inner)} bar`); i = g.end;
			} else if (name === "hat") {
				const g = readGroup(s, i); push(`${sub(g.inner)} hat`); i = g.end;
			} else if (name === "vec") {
				const g = readGroup(s, i); push(`vector ${sub(g.inner)}`); i = g.end;
			} else if (name === "dot") {
				const g = readGroup(s, i); push(`${sub(g.inner)} dot`); i = g.end;
			} else if (name === "tilde") {
				const g = readGroup(s, i); push(`${sub(g.inner)} tilde`); i = g.end;
			} else if (name === "mathbb" || name === "mathcal" || name === "mathscr" || name === "mathfrak") {
				const g = readGroup(s, i); push(g.inner.replace(/[^A-Za-z0-9]/g, "")); i = g.end;
			} else if (STYLE_CMDS.has(name)) {
				const g = readGroup(s, i);
				push(name.startsWith("text") || name === "mbox" || name === "hbox" ? g.inner : sub(g.inner));
				i = g.end;
			} else if (name === "begin" || name === "end") {
				i = readGroup(s, i).end;
			} else if (name === "\\" || name === "cr") {
				push(",");
			} else if (name === "%") {
				push("percent");
			} else if (name === "{" || name === "}" || name === "|") {
				// literal braces / norm bars: silent
			} else if (SPACE_CMDS.has(name) || SIZE_CMDS.has(name) || name === "label" || name === "tag") {
				if (name === "label" || name === "tag") i = readGroup(s, i).end;
			} else if (GREEK.includes(name.toLowerCase().replace(/^var/, ""))) {
				push(name.replace(/^var/, "").toLowerCase());
			} else if (name in WORDS) {
				push(WORDS[name]!);
			}
			continue;
		}
		if (c === "^") {
			const g = readGroup(s, i + 1);
			const t = sub(g.inner);
			push(t === "2" ? "squared" : t === "3" ? "cubed" : t === "prime" || t === "′" ? "prime" : `to the power of ${t}`);
			i = g.end;
			continue;
		}
		if (c === "_") {
			const g = readGroup(s, i + 1);
			push(`sub ${sub(g.inner)}`);
			i = g.end;
			continue;
		}
		if (c === "{" || c === "}") { i++; continue; }
		if (/[A-Za-z]/.test(c)) {
			const m = /^[A-Za-z]+/.exec(s.slice(i))![0];
			push(spellVariables(m));
			i += m.length;
			continue;
		}
		if (/[0-9]/.test(c)) {
			const m = /^[0-9]+(?:[.,][0-9]+)?/.exec(s.slice(i))![0];
			push(m);
			i += m.length;
			continue;
		}
		if (c === "-") {
			// Leading or post-operator minus is a sign ("negative"), otherwise subtraction.
			const prev = out[out.length - 1];
			const isSign = prev === undefined || /^(equals|plus|minus|times|,|is less than|is greater than)$/.test(prev) || prev.endsWith(" of");
			push(isSign ? "negative" : "minus");
		} else if (c in SYMBOLS) {
			push(SYMBOLS[c]!);
		}
		i++;
	}
	return out.join(" ").replace(/\s*,(\s*,)+/g, ",").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
}

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;

/** Lesson markdown to plain sentences ready to be spoken. */
export function markdownToSpeech(md: string): string {
	let t = md.replace(/\r\n?/g, "\n");
	// Fenced code: say that there is one instead of reading it out.
	t = t.replace(/```([a-zA-Z0-9_-]*)[^\n]*\n[\s\S]*?```/g, (_m, lang: string) =>
		`\n${lang === "mermaid" ? "A diagram is shown on screen." : "A code example is shown on screen."}\n`);
	t = t.replace(/~~~[\s\S]*?~~~/g, "\nA code example is shown on screen.\n");
	// Math, display first. Code fences are already gone, so no stray dollars from code.
	t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_m, x: string) => `\n${latexToSpeech(x)}.\n`);
	t = t.replace(/\\\[([\s\S]+?)\\\]/g, (_m, x: string) => `\n${latexToSpeech(x)}.\n`);
	t = t.replace(/\\\(([\s\S]+?)\\\)/g, (_m, x: string) => ` ${latexToSpeech(x)} `);
	t = t.replace(/(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\w$])/g, (_m, x: string) => ` ${latexToSpeech(x)} `);
	// Structure.
	t = t.replace(/<!--[\s\S]*?-->/g, " ");
	t = t.replace(/<[^>\n]+>/g, " ");
	t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? ` ${alt} ` : " "));
	t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	t = t.replace(/\bhttps?:\/\/\S+/g, "a link");
	t = t.replace(/^[ 	]{0,3}#{1,6}[ 	]+(.*?)[ 	]*#*[ 	]*$/gm, (_m, h: string) => `${h.replace(/[.:!?]$/, "")}.`);
	t = t.replace(/^[ 	]*>[ 	]?/gm, "");
	t = t.replace(/^[ 	]*[-*_]{3,}[ 	]*$/gm, "");
	t = t.replace(/^[ 	]*\|?[ 	]*:?-{2,}:?[ 	]*(\|[ 	]*:?-{2,}:?[ 	]*)*\|?[ 	]*$/gm, ""); // table rule rows
	t = t.replace(/^[ 	]*\|(.+)\|[ 	]*$/gm, (_m, row: string) => `${row.split("|").map((c) => c.trim()).filter(Boolean).join(", ")}.`);
	t = t.replace(/^[ 	]*(?:[-*+]|\d+[.)])[ 	]+(.*)$/gm, (_m, item: string) => (/[.!?:;]$/.test(item.trim()) ? item : `${item.trim()}.`));
	// Inline emphasis and code.
	t = t.replace(/`([^`\n]+)`/g, "$1");
	t = t.replace(/(\*\*|__)(.+?)\1/g, "$2");
	t = t.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1");
	t = t.replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, "$1");
	t = t.replace(/~~(.+?)~~/g, "$1");
	t = t.replace(EMOJI, "");
	t = t.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
	return t.trim();
}

const FIRST_CHUNK_MAX = 100;

/** Split spoken text into chunks a TTS call can handle quickly: sentence
 *  aligned, short first chunk so audio starts fast, none over `max` chars. */
export function chunkForSpeech(text: string, max = 240): string[] {
	const sentences: string[] = [];
	for (const para of text.split(/\n+/)) {
		const p = para.trim();
		if (!p) continue;
		for (const s of p.split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(\[])/)) if (s.trim()) sentences.push(s.trim());
	}
	const pieces: string[] = [];
	for (const s of sentences) {
		if (s.length <= max) { pieces.push(s); continue; }
		let cur = "";
		for (const part of s.split(/(?<=[,;:])\s+/)) {
			if (part.length > max) {
				if (cur) { pieces.push(cur); cur = ""; }
				let w = "";
				for (const word of part.split(/\s+/)) {
					if (w && (w + " " + word).length > max) { pieces.push(w); w = word; } else w = w ? `${w} ${word}` : word;
				}
				if (w) cur = w;
			} else if (cur && (cur + " " + part).length > max) { pieces.push(cur); cur = part; }
			else cur = cur ? `${cur} ${part}` : part;
		}
		if (cur) pieces.push(cur);
	}
	const chunks: string[] = [];
	let cur = "";
	for (const p of pieces) {
		const limit = chunks.length === 0 ? FIRST_CHUNK_MAX : max;
		if (cur && (cur + " " + p).length > limit) { chunks.push(cur); cur = p; }
		else cur = cur ? `${cur} ${p}` : p;
	}
	if (cur) chunks.push(cur);
	return chunks.filter((c) => /[\p{L}\p{N}]/u.test(c));
}
