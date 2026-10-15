# Work graphs: how to make AI agents autonomous without losing control

**English** · [Русский](README.ru.md)

*Six weeks of building, with the pain, the numbers and what we removed in the end. Not a recipe of our code — the road anyone who builds this seriously will have to walk. Written from building SMA, a personal orchestrator for AI agents (closed source; only the ideas are here).*

> **Check your own graph in 3 minutes:** `node assess/assess.mjs` — 20 questions, a maturity level and a list of holes. Zero dependencies, Node 18+.

---

## 0. First, honestly — what it cost

We thought graphs were a three-week job. Here is how it went:

| | Plan | Fact |
|---|---|---|
| Time | 17 days | **41 days** — 2.4× longer, and closing is still going on |
| Scope | 92 plans in 7 parts | 193 items that had to be *proven*; 15 gaps found only *after* the first acceptance |
| Code builds ("trains") | — | **46 trains in 20 days**, 32 of them in six days straight. Only 6 landed on the main branch; the other 40 were builds for verification runs |
| Commits | — | over 5,000 across two repositories |
| Support tooling | 0 planned | **225 scripts** born along the way: run chains, watchers, judges, landings |
| Full test suite | — | ~14,000 tests, 2.5–3 hours on one machine, per run |
| A live run with a real agent | — | 1 to 6 hours per round |

The most important line in that table: **we wrote the code almost on schedule.** Half the plans were done in five days. Writing was not the expensive part — **proving that it works** was. Every remaining week went there.

If you are reading this thinking "we have a graph, built it in two days" — read on to the section about primitive graphs.

---

## 0.1. Why this matters more than it seems

Most people think about AI agents as a model question: which one is smarter, cheaper, faster at writing code. That was last year's question. The question that will decide who wins from agents and who drowns in them is: **can you trust the result when you were not watching?**

### The bottleneck moved
The old bottleneck was *doing*: writing code, gathering data, drafting documents. Agents removed it — they produce more than you can read.

The new bottleneck is **verifying**. You still have eight to ten hours of attention a day. If you check every piece of agent work yourself, your output is capped by your own reading speed — ten agents do not give you ten times more, they give you as much as you can check. Plus fatigue.

A work graph is a **multiplier of your ability to verify**. It takes everything that can be proven by a machine and brings you only what truly needs your decision. Without a graph you don't have ten workers — you have ten interns, each needing someone to follow them around.

### One silent error costs more than ten successes
Trust is asymmetric. Ten correctly done tasks do not build trust. **One** task that was "done, tests green" and quietly broke something next to it destroys it completely. After that you go back to checking every step, and autonomy is dead.

So what matters is not the agent's average accuracy but **the guarantee that an error never passes silently**. An agent that is wrong 20% of the time but always loudly is more useful than one that is wrong 2% of the time but quietly. A graph turns quiet errors into loud ones.

### Errors compound — and so do lessons
An agent builds the next piece of work on the result of the previous one. If the previous one was unverified, the error does not just stay — it becomes the foundation. A month later you find a three-week-old break with twenty pieces of work resting on it.

It works the other way too. A graph with a mandatory lessons stage turns every failure into a mechanism that will not let it through again. After six weeks we had fifteen classes of failure and a mechanism for most of them. Each next phase goes faster than the previous one — not because the model got better, but because **the road got smarter**.

### The smarter the model, the more dangerous it is to have no graph
This is the most counterintuitive part. It seems: models get better, so less control is needed. It is the opposite. A weak model fails obviously. A strong model fails **convincingly**: neat code, a plausible report, green tests it wrote itself around its own mistake. The better the model, the smaller the chance you notice the problem by eye — and the more it matters that the road notices it.

### Rollback is freedom
Without guaranteed rollback every autonomous job is a bet. With rollback it is an experiment. People whose agents work in a shared copy with no trace of "what to roll back to" trust them only with small things — and they are right to. Being able to undo everything in one action is what lets you hand an agent a big task.

---

## 0.2. A month without a graph — how it usually goes

Week 1. Delight: the agent did in a day what would have taken a week. You give it more.

Week 2. There are three agents now. You stop reading every change — no time. They set "done" themselves. A couple of small things break; you fix them by hand.

Week 3. Something stopped working and nobody knows when. The history has hundreds of changes, half of them "fixed tests". You cannot roll back: too much has grown on top. You spend two days on archaeology.

Week 4. You are checking everything yourself again. Agents are now autocomplete. The verdict: "autonomous agents aren't ready yet."

The agents were ready. What was missing was a road on which their work can be accepted.

---

## 1. The problem graphs solve

Anyone can start an AI agent that writes code or drafts documents. The hard part is **stepping away from the screen**.

While you are there, the agent is useful. Once you leave:

1. **"Done" stops meaning done.** The agent honestly writes "done, tests green". Later it turns out the tests checked the wrong thing, the function is written but never called, and the changes are in the wrong place.
2. **Control is either lost or never handed over.** Check every step — no autonomy. Check nothing — in a week the project holds things nobody can explain or roll back.
3. **Work does not add up.** Ten good sessions do not become a system. Lessons are lost, mistakes repeat.

Autonomy is not "the agent works without a human". It is **the human spends attention only where it is truly needed, and everything else is proven without them.**

---

## 2. What a work graph is

A work graph is **a predefined path** that every unit of work goes through: stages and transitions between them.

The core rule: **moving to the next stage requires proof.** Not the agent's words, but a checkable trace: what was done, how it was checked, where the result is, what known state to roll back to.

At any moment a graph answers four questions:
- **Where is the work now?** Stage, who holds it, how long it has waited.
- **What is proven?** Which stages are passed and what confirms it.
- **Who decides next?** A machine (a check) or a human (taste, money, risk).
- **How do we go back?** To which known state to roll back.

### Three scales
- **Task** — one unit of work: contract → clarification → drawing → execution in an isolated copy → independent verification → candidate → human acceptance → landing.
- **Batch** — many tasks with one goal: waves by dependency, a shared budget; the human releases a wave and accepts the batch with one decision.
- **Phase** — a large stage: discussion → plan → design → execution in batches → verification → **lessons**. A phase is not closed until what it taught has been turned into a mechanism.

---

## 3. Why a primitive graph is more dangerous than none

Many people "have graphs" now. Usually it looks like this: a task has a `status` field with "in progress / in review / done", the agent sets it itself, sometimes there is an "approve" button.

That is scarier than no graph at all. Without a graph you at least know you control nothing. With a primitive graph you **think** you are in control.

What such a graph usually lacks — and each of these holes cost us days:

| Usually | What is actually needed | What happened to us before we had it |
|---|---|---|
| The agent sets "done" itself | "Done" is set by an independent check against the contract | A verification barrier was written, tested, green — and **never executed once**: it sat on one door while work was delivered through another |
| "Done" = tests green | Done = the path walked live from request to acceptance | A test double had a method the real library does not have. **2,971 tests green — the product did not work** |
| Status is a database field | Status is derived from an event log | The window showed "queue empty, worker idle" while three processes were burning the subscription in parallel |
| An agent's question is a chat message | A question is a state of the work waiting for an answer | The agent asked a question, the system took the question for a delivery and closed the work empty. **Three times in a row** |
| Pause is a flag | Pause is a boundary that survives a restart | Every "pause" during one stage burned one attempt from the limit until the work closed as "environment unavailable" |
| The agent works where you work | Its own copy, its own branch, ideally its own OS user | An agent running as the owner can read the key that accepts work — that is, **accept its own work** |
| Spend is whatever the agent reported | Unknown spend is not zero — it is an honest "not measured" | The verification reserve was never reconciled with what was spent; the cost of delivered work was unknown for weeks |

A primitive graph looks great in a demo. It breaks exactly at the moment you stop watching — which is the very moment it was built for.

### Check your graph: 20 questions
Answer honestly. Every "no" is a place where work can pass silently. (Or run `node assess/assess.mjs`.)

**Contract and acceptance**
1. Is "done" written down before the work starts — as a list of checkable items?
2. Is "done" set by someone other than the agent who did the work?
3. Does the human see the contract, the evidence and the risks in one place at acceptance?
4. Can every piece of evidence be re-run with one command?

**Isolation and rollback**
5. Does every attempt work in its own copy, from a known state?
6. Are the base and the list of changes in the log — including failed attempts?
7. Can any piece of work be rolled back in one action?
8. Can the agent's process read the key that accepts work? (The right answer is no.)
9. Can the agent write anything that a human or the system will later execute on their own behalf? (The right answer is no.)

**Honest signals**
10. Does the screen show what is in the log, rather than a `status` field?
11. Have you checked that your check can go red — that it catches something deliberately broken?
12. Is there a test that proves the connection between parts, not each part alone?
13. Are your test doubles checked against recordings of what the real thing does?
14. Does the system tell "the agent asked a question" apart from "the agent delivered"?
15. What does the system do with unmeasured spend — count it as zero, or say "not measured"?

**Control**
16. Do pause, stop and correction work at task, batch and phase level — and survive a restart?
17. Does the system wake you when work stalls — or do you find out in the morning?
18. Can an agent postpone a finding "for later" without your word?
19. Does every failure found become a check that prevents it from happening again?
20. Has the whole path — request to acceptance — been walked live several times in a row without a slip?

Fewer than ten "yes" — you have a list of statuses, not a graph. Fewer than fifteen — you have a graph, but it does not yet hold the work without you.

### The maturity ladder
- **Level 0. Chat.** The agent does, you read everything. No autonomy, but no illusions either.
- **Level 1. Statuses.** "In progress / done", set by the agent. The most dangerous level: the illusion of control.
- **Level 2. Gates.** Human acceptance and tests as a condition. Errors get caught, but dead wires and fakes slip through.
- **Level 3. Evidence.** Every "done" carries a receipt, the doer is not the checker, work is isolated and reversible. Here you can leave for the night.
- **Level 4. Three scales.** Task, batch and phase with their own gates, shared budget, pause and stop at every level.
- **Level 5. Self-learning.** Every failure becomes a mechanism, red turns into a task by itself and goes down the same road. The system improves itself and you accept the reports.

Most off-the-shelf solutions today are at level 1, sometimes 2. We spent six weeks going from 2 to 4 and are just starting 5.

---

## 4. Fifteen classes of pain

After the phase we took every wall apart and grouped them. Almost no wall was unique — each was another instance of one of fifteen classes. Here they are, with the cost and what helped in the end.

**1. Computed, but not connected.** The most expensive class. Every part is written, tested and green, but the parts are not connected. Permissions computed, hashed, written to the log — and never passed to the process, so the agent physically could not change a single file. A counter counts — nobody reads it. A whole part of the phase (13 plans for designer training) was built and never wired in — it had to be moved out of the phase.
*What helped:* for every connection a test of **the wire itself** ("the value reaches whoever uses it"), and an end-to-end run of the whole route. A unit test that calls a function directly never sees the wire.

**2. Judged by a vocabulary nobody told the judged.** A check rejects work by a rule the agent was never given. The agent honestly does "the wrong thing" again and again. Nine walls in a day and a half; the rule lived in a file the model might never open. Agents spent dozens of turns on refusals nobody had warned them about.
*What helped:* gates are pure functions. They can be asked **offline in milliseconds**: build the input strictly from what the agent was given and run it through the real validator. We spent a week waiting for multi-hour live runs to answer what can be checked instantly.

**3. The live run as a debugger.** A live round costs hours and returns **one** cause. "Fix one thing — run for an hour", in a loop. Once only two of nine suites ran because the engine stopped at the first failure. Five walls in a row on one path, an hour each.
*What helped:* first an offline rehearsal of the whole route in code, then a fast contract check of the suspicious spot, and only then a live run — **as proof, not as bug hunting**. And a rule: after every wall you search for its whole class, not the single instance.

**4. The double behaves differently from the real thing.** Test fakes of agents and libraries are written from our idea of the real thing. One wall surfaced only on the seventh run: the double lacked a role the real one had.
*What helped:* doubles are checked against **recordings** of the real thing, not against memory of it.

**5. One machine for everything → false reds.** Under load tests fail with timeouts and pass alone. Three suites in parallel — 6 to 14 false reds. A neighbouring window with compilers killed the test database twice. An OS update rebooted the machine at night and killed a run. A full 14,000-test suite once gave 7 reds — all of them load, not one real.
*What helped:* heavy runs strictly one at a time, under a lock; a red is **first run alone**, and only then judged "load or real"; part of the work moved to a separate server.

**6. Subscriptions, limits, logins.** A session limit cut a swarm of seven agents at once. The weekly subscription limit stopped runs in the middle of a round. For two days there was no subscription at all. A login copied to the server burned the laptop's token refresh chain.
*What helped:* a gate "is the rest of the week enough" before every step; a spend ceiling; a separate login on every machine.

**7. The environment changes by itself.** The agent's tool updated itself in the middle of the night — the round stood without a worker. Resuming a session reused old instructions, and the human's words to returned work never arrived.
*What helped:* a round does not start on an environment that differs from the checked one; auto-updates off where runs happen.

**8. Agents damage shared things.** Removing a working copy went through a link and gutted the shared package store — twice, the second time mid-run, although the lesson was written down. Editing an environment variable in one line wrote an empty PATH.
*What helped:* dangerous actions are closed by **hooks**, not by requests in instructions.

**9. Work stalls and nobody wakes up.** A run finished at 4 am, noticed at 1:45 pm. A safety check refused one step — and everything stood for 8 hours because the refusal looked like ordinary waiting. A watcher fired on its own message and killed what it was watching.
*What helped:* every long job has an alarm from the moment it starts; a refusal is a loud signal of its own, not silence.

**10. "Green" that is not green.** The full suite showed "13,384 passed, 0 failed" — and exited with an error, because the failure was outside the tests and the report did not print it. The release judge read the wrong signal for eight days. "Proven" rested on a run 58 commits behind.
*What helped:* decisions are made on several channels; a "proven" receipt stores which exact code it was proven on.

**11. The definition of "done" floated.** The handover criterion changed three times. Once an agent "for clarity" narrowed the owner's words to four items the owner never said. The phase was accepted before checking it against the plan — the check later found 15 gaps, which cost four more builds and nine days.
*What helped:* the criterion is written **in the owner's own words** in one file that the gates read; narrowing only with a quoted line.

**12. Findings went to the backlog and came back as gaps.** "We'll fix it later" became gaps a month later. An agent set deadlines for deferrals the owner never approved.
*What helped:* a finding is fixed now, with a test; a deferral without the owner's word and date **keeps the checks red** — a mechanism, not a request.

**13. The phase was too big.** Ninety-two plans in one phase. One plan went through six review rounds in 7 hours while 75 others waited. Seams between parallel plans cost ten hours of untangling.
*What helped:* no more than 20 plans per part, no more than two review rounds, then land.

**14. Lessons did not reach the doer.** Lessons were written, but we never measured whether they reached the agent. The measurement: one path — 0 of 35, another — 1 of 20. The lesson about the dangerous removal was in a note and in the instructions — and still repeated.
*What helped:* measure memory delivery **per path**, and turn lessons into mechanisms.

**15. Landing.** The run was green, but the main branch had moved on meanwhile. The UI was not built in the copy — 49 of 52 reds were only that. Five full-suite runs for one build.
*What helped:* landing is one command that syncs branches, builds everything, runs, checks and only then merges.

---

## 5. Insights we did not expect

**Tests that test the test.** Our most frequent failure was not "the code broke" but "the check was built so it could not catch the break". A regression check green by construction. A report that does not print errors outside tests. If you have not checked that your check can go red, you do not have a check.

**Timing races where you don't expect them.** An agent's question is recorded before its words — a hundred milliseconds apart. The screen looked exactly into that gap and showed a question with no words. The test passed on some runs and failed on others. You don't find these by reading code — only with a probe that polls the state rapidly.

**A UI trifle can kill a whole scenario.** An invisible label for screen readers escaped the window's frame, the page grew a hundred pixels taller than the screen, the test's screenshot resized the window, the window switched to the narrow layout and back — and the open card was lost. Three layers of causes for one button the test "can't find".

**The agent tries very hard to be useful — and that is dangerous.** A broad instruction "remove dead code" was carried out conscientiously: 12,000 lines deleted, including modules planned to be connected next. The instruction said "unclear — delete". Agent instructions must be narrow, checkable and come **with a "do not touch" list**.

**Security breaks where it looks harmless.** When we gave the agent's separate user rights "only to the folders it needs", an automated security review found holes twice. Write access to the version control system's internal folder lets you plant code that runs as the owner on their next ordinary command. Isolating an agent is not "a separate user" — it is **a separate user who cannot write anything someone else will later execute**.

**A rule in text does not work.** We wrote dozens of rules. Every rule that stayed text-only was eventually broken — by us and by agents. Only what checks itself works: a test, a hook, a gate. As the owner put it: "for every requirement — a mechanism".

**The live run teaches fastest — and costs the most.** Every run with a real agent found something none of the 14,000 tests saw. But paying hours per finding is a bad deal. The balance: an offline rehearsal of the whole route before every live run, and the live run as the exam.

**"Almost works" is the most expensive state.** A system that works 90% of the time needs as much attention as a broken one — but it convinces you to walk away. We once handed a window over while three criteria were still open. The very first real task exposed a loop where the daemon considered a live attempt dead and started a new one every two minutes.

---

## 6. The laws that remained

Each was born from a failure above.

1. **Evidence instead of words.** Every "done" carries a receipt: a command you can run again.
2. **Computed is not connected.** For every connection, a wire test and an end-to-end run.
3. **Nothing unrun is handed over.** It works when the path has been walked live, whole, and more than once.
4. **All work is reversible.** Its own copy from a known base; the base and the change list in the log, failures included.
5. **Unknown is not zero.** What is not measured is called that.
6. **An agent never approves itself** — neither logically nor technically.
7. **A double is never smarter than the real thing.**
8. **A lesson is a mechanism, not text.**
9. **A finding is fixed now.**
10. **The human sees the truth:** every number on screen expands down to its receipt.

---

## 7. Where a human is needed, and where not

**A human — where the decision is about values:** what counts as a result, direction and taste, money, irreversible actions, final acceptance.

**A machine — where it can be checked:** tests, conformance to the contract, copy boundaries, budget.

If a human is asked to confirm what could have been measured, they stop reading — and the gates become a formality.

The human always has three buttons at every level — task, batch, phase: **pause** (at a safe boundary), **stop** (with rollback of the unfinished), **correction** (a word to running work). All three survive a system restart.

---

## 8. How to build it yourself

This is not a two-day job. You can grasp the idea in an evening; a graph that holds work without you is built over weeks. Here is the order we would choose starting over.

1. **"Done" — verbatim, on day one.** Write down what "the graphs work" means, in the words of whoever will accept it. Track against the plan from day one, not after acceptance.
2. **One graph — the task — by hand.** Take one task through every stage manually, writing down the evidence of each stage. Then automate.
3. **The log before the screen.** Every event with its base and trace. The screen, the budget and rollbacks read the log.
4. **Isolation before autonomy.** A copy per attempt, a branch per attempt, a separate user with no access to acceptance keys and no right to write what others execute.
5. **Stages one at a time, each closed by a live run of the whole path.**
6. **A test stand and rehearsals.** A test database and a cheap agent double for rehearsals; an offline route audit before every live run.
7. **Batches and phases on top of the task**, once the task has gone live several times in a row without a slip.
8. **Classes of failure from day one.** Each class gets a mechanism.
9. **An attention budget for proof.** Plan two to three times more time for proving than for building. That is not caution — it is our actual ratio.

---

## 9. Why everyone should do this

**Because otherwise AI stays a tool, not a worker.** The difference is not the model; it is the graph around it.

**Because it scales you.** You move from "I write prompts and check every step" to "I set contracts, decide the disputed, accept results".

**Because models change and the graph stays.** A new model plugs into the same road with the same evidence.

**Because only then does work add up.** The lessons stage turns every error into a mechanism. A system that learns from its failures breaks less over time — that is the road to self-improvement, where red turns into a task by itself.

**Because calm is a feature.** Going to sleep knowing that the morning brings an accepted result, a clear question or a reversible failure is the condition under which you will trust agents with anything important at all.

---

## 10. The short formula

> **Autonomy = a graph of stages + evidence at every transition + a human only where values decide + a lesson as a mechanism.**

The model does the work. The graph makes that work trustworthy without you.

In the coming years everyone who works with their head will have agents. The difference between people will not be which model they have — models are equally available to all. The difference will be **who can let agents work and sleep soundly, and who stays a reviewer of other people's drafts**. The first get a team working around the clock. The second get one more queue of unread things.

Building such a road is not two days but six weeks of walls. We walked them and wrote down where they stand. Start with one task graph, make it honest — and only then let the agents go further.

---

*Text: [CC BY 4.0](LICENSE). The self-check script: MIT. If this helped, a ⭐ helps others find it.*
