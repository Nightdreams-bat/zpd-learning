# ZPD Learning

An AI tutor that finds where your understanding ends and teaches from there, one reasoning step at
a time. The name comes from Vygotsky's zone of proximal development: the band between what you can
do alone and what you can do with help, which is where teaching works.

ZPD Learning is a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos
Blomqvist. The teaching agents, the knowledge graph and most of this app are his work, and the
fork stays under the same AGPL-3.0 license. The git history shows who wrote what.

![Teaching session](docs/assets/teaching-session.png)

## What I changed

- **Runs on a Claude subscription.** A `claude-cli` provider drives your installed
  [Claude Code](https://claude.com/claude-code) CLI (`claude -p`), so no API key is needed. Idle CLI
  processes stay warm, and each message sends the transcript as one block so the prompt cache serves
  the history. Code: `src/agent/claude-cli-*.ts`, tested against a scripted fake CLI
  (`tests/fixtures/fake-claude.mjs`).
- **Read-aloud narrator.** A local Kokoro voice reads lesson passages aloud (`src/server/tts.ts`).
- **Graphite Frost.** A glass theme that stays readable.
- **Sprint mode, in progress.** Shorter, click-first lessons with XP and a learner profile.
- **Claude Code skills** in [`claude-code/`](claude-code): `teach`, `tutor`, `tutor-setup`, `level-up`
  and `visualize` bring the same method into Claude Code, with an Obsidian vault as the learner
  model. They have their own [credits](claude-code/CREDITS.md).
- Test runs no longer write into the real data folder, and in-app updates are off by default so
  they can't replace this fork with upstream builds.

The subscription provider relies on the Claude Code CLI's headless mode, so Anthropic's terms for
subscription use apply. It is meant for personal use.

## Run it

Windows: `start-learnharness.cmd`. Elsewhere: `npm install && npm run build && npm start`.

Log in to Claude Code once, then pick *Claude Opus/Sonnet/Haiku (subscription)* under
Settings → Models. The other providers (OpenAI, the Anthropic API, Google, DeepSeek, OpenRouter and
more) still work with their own keys.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md) and [architecture](docs/architecture.md).

## How it works

This part is LearnHarness's design, unchanged in the fork.

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words,
so the agent gets a detailed picture rather than a record of right and wrong answers.

What you are taught accumulates as propositions and reasoning chains in a knowledge graph, with
links back to the sessions they came from. Later sessions read the graph instead of starting from
scratch.

![Knowledge graph](docs/assets/knowledge-graph.png)

## Your data

Chats, the graph, settings and keys live on your machine as plain files. Models run through the
providers you configure, so requests do leave your machine; local storage does not mean offline.
System prompts are visible and editable.

## License

[AGPL-3.0](LICENSE), the same as LearnHarness. The original code is copyright Amos Blomqvist and
the LearnHarness contributors; my changes are released under the same license. The skills in
`claude-code/` carry their own licenses, listed in [its credits](claude-code/CREDITS.md).
