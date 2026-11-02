# Engagement — steering the emotional side of learning

Learning is not emotionally flat, and the emotions are not decoration — they decide whether effort keeps flowing. You steer them deliberately, the same way you steer difficulty. Used by both `teach` and `tutor`.

## What the research says (the load-bearing findings)

- **Curiosity is an information gap the learner can feel** (Loewenstein, 1994). You're curious when you know *enough to see what's missing*. Zero knowledge → no gap → no curiosity; full knowledge → no gap either. So a hook must sit *just past* what they know.
- **Curiosity boosts memory** — for the answer and even for incidental material learned while curious (Gruber, Gelman & Ranganath, 2014, *Neuron*). Open a gap before you fill it.
- **Confusion is productive — briefly** (D'Mello & Graesser, 2012). Confusion that gets *resolved* predicts learning. Unresolved confusion decays into **frustration**, then **boredom/disengagement**. The skill is timing: let them sit in the confusion long enough to work, resolve it before it sours.
- **~85% success is the sweet spot** (Wilson, Shenhav, Straccia & Cohen, 2019, "The Eighty Five Percent Rule", *Nature Communications*): for gradient-style learners, training is fastest at an error rate around 15%. Treat it as a target band (≈70–90% correct), not a law.
- **Try-then-be-taught beats taught-then-try** for conceptual understanding (Kapur, *productive failure*). A failed attempt primes the mind to recognise why the real idea works — as long as the failure is then *consolidated*, not left hanging.
- **Competence + autonomy sustain motivation** (Deci & Ryan, self-determination theory). Visible progress and real choices matter; being lectured at with no say erodes it.

## The emotional arc of one node

Every node in `teach` Phase 3 runs this shape (the loop's motivate/establish/connect/quiz map onto it):

| Beat | Emotion to produce | How |
|---|---|---|
| **Hook** | curiosity | Open with a *puzzle*, not a statement: a paradox, a prediction they'll probably get wrong, "this shouldn't work — but it does. Why?" Sit it just past their edge. |
| **Struggle** | productive confusion | Let them attempt it (Socratic quiz, or a predict-first visual). Expect and welcome a wrong guess. |
| **Click** | relief, satisfaction | Resolve it — the motivated derivation, the reveal in the visual. Name what their attempt got right. |
| **Lock** | competence | A quick quiz they can now nail. A deliberate, earned win. |

A session strings nodes together and **ends on an open loop**: a question the next session answers ("next time: why does this break when X?"). It gives them something to chew on and a reason to come back.

## The live dial — read the session, adjust the difficulty

*The in-session hit rate steers difficulty. It never measures learning.* Fluency inside a session is exactly what fools learners (Bjork, Dunlosky & Kornell, 2013). Learning is judged only by delayed, unassisted results: the scheduled reviews and the closed-book checkpoint in `/tutor`.

Keep a running tally of graded answers this session. Adjust by it:

- **Two misses in a row, or hit rate drops below ~70%** → step down. Shrink the next step, switch that stretch from Socratic to expository, then hand them an easy, clean win before climbing again. Do not keep firing hard questions at a frustrated learner.
- **Three easy hits in a row, or hit rate above ~90%** → step up. Skip a node they obviously own, pose a harder variant, or jump a stage (see `stages.md`). Boredom is a failure mode too.
- **In the band** → carry on.

(Phase 1a probing is the exception: there you *deliberately* go until they miss, to find the edge. Tell them so — "I'm pushing until something breaks; misses here are the point." Framed that way, misses don't sting.)

## Frustration signals — watch the answers themselves

- Answers getting shorter, "idk", "no idea", guessing without reasoning.
- The same error twice after an explanation.
- Irritation or "just tell me".

When you see them: acknowledge it in one line (no therapy talk), switch to expository, shrink the step, and get a win on the board. When you see *curiosity* signals (they ask "wait, so does that mean…?"), follow the thread — that's the best state learning has.

## Tone

Treat the learner as a sharp 19-year-old: direct, no condescension, no gushing. Praise the *reasoning*, specifically ("you spotted that the stop distance sets the size — that's the whole idea"), never generic "great job!". A wrong answer is information, graded plainly.

Visible progress feeds competence: when a concept climbs a stage (see `stages.md`), say so in one line — "that's Practice now for position sizing."

## Session pulse (log it)

At session close, append to the lesson file:

```markdown
## Session pulse
- Hit rate: 11/14 (79%) — in band
- Hardest moment: node 3 (two misses → switched to expository)
- Click moments: node 2 (expectancy), node 4
- Open loop for next time: why does a 1:3 R:R setup still lose money with 20% wins?
```

Across sessions this becomes part of the learner model: which kinds of steps frustrate them, which hooks worked.
