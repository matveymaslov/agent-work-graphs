# Accept work by evidence

A small, offline example of a work loop: contract → isolated attempt → check →
bound receipt → explicit acceptance → integration. A journal makes interrupted
work resumable. The task is intentionally ordinary: add `2 + 3` and explain the
answer. The wrong worker returns `6`.

Requires Node.js 22 or newer and Git 2.28 or newer on `PATH`. No packages,
installation, credentials, model calls, or network access. This folder can be
copied into its own repository and used independently. Licensed under MIT.

## Run the story

From this folder, in PowerShell, Command Prompt, or a Linux shell:

```text
node demo.mjs
node --test test/work-loop-example.test.mjs
```

The demo creates a directory under the operating system's temporary directory,
prints its path, and **keeps it for inspection**. Tests also keep their temporary
repositories. Nothing operates on the repository containing this example. A
working, writable system temporary directory is required.

The demo asserts every expected refusal, kills a real child process after a
saved checkpoint, resumes it, and verifies the integrated result. Unexpected
behavior exits nonzero. Expected output includes:

```text
Check: fail; exit codes: 1, 1
Refused: Only a pass receipt can be accepted
Check: not-run; no completed criterion exit codes.
Refused: The result tree has changed; re-check
Refused: Target moved since check; start a fresh attempt and re-check
Resume from the journal: only explain runs; calculate is not repeated.
Result: {"total":5}
```

## Walk through the commands

Use a new, empty directory for the run, here `./example-run`. Run each command on
its own; they are not shell pipelines. Continue after the refusals marked below.

```text
node cli.mjs init ./example-run
node cli.mjs start ./example-run wrong wrong
node cli.mjs run ./example-run wrong
node cli.mjs check ./example-run wrong
node cli.mjs accept ./example-run wrong Reviewer
```

`check` returns **1** (`fail`); `accept` refuses and creates no decision. Start a
correct attempt and try checking it before the worker has run:

```text
node cli.mjs start ./example-run good good
node cli.mjs check ./example-run good
node cli.mjs run ./example-run good
node cli.mjs check ./example-run good
node cli.mjs inspect ./example-run good
```

The first check returns **2** (`not-run`), the second **0** (`pass`). `inspect`
prints paths to the worktree, current receipt, and decision, if any. A pass is
evidence; there is still no decision.

To see the stale-result guard, edit `example-run/copies/attempt-good/result.json`
to contain `{"total":99}`, then run:

```text
node cli.mjs accept ./example-run good Reviewer
```

It refuses because the result tree changed. Restore `{"total":5}`, run `check`
again, and explicitly accept. Advance the target to demonstrate a separate
integration guard:

```text
node cli.mjs check ./example-run good
node cli.mjs accept ./example-run good Reviewer
node cli.mjs advance-target ./example-run
node cli.mjs integrate ./example-run good
```

Integration refuses with a request to re-check. `advance-target` is a teaching
aid: it creates an empty commit on the target, representing another actor. Even
the same tree at a different commit invalidates the old integration basis.
There is no automatic rebase: use a fresh attempt from the new target and check
that attempt. Use that fresh attempt to try a real interruption:

```text
node cli.mjs start ./example-run resumed good
node cli.mjs run ./example-run resumed --pause-after calculate
```

After `Checkpoint saved`, press **Ctrl+C**. Then:

```text
node cli.mjs inspect ./example-run resumed
node cli.mjs run ./example-run resumed
node cli.mjs check ./example-run resumed
node cli.mjs accept ./example-run resumed Reviewer
node cli.mjs integrate ./example-run resumed
git --git-dir=./example-run/target.git show main:result.json
```

Only `explain` runs on resume. The final command prints `{"total":5}`. To try
worker overreach separately:

```text
node cli.mjs start ./example-run overreach decide
node cli.mjs run ./example-run overreach
```

The worker requests a decision; the controller rejects the request. Only the
`accept` command can create a decision.

## What the evidence binds

| File | Contents |
| --- | --- |
| `contract.json` | `id`, `revision`, criteria with an `id` and an argv-array `command` |
| `control/attempt-ID/attempt.json` | `id`, `baseCommit`, absolute `copy`, `state`, completed step hashes, current evidence pointers |
| `control/attempt-ID/receipt-UUID.json` | Contract SHA-256, Git `resultTreeHash`, target commit, per-criterion command, exit code and output, `pass`/`fail`/`not-run` |
| `control/attempt-ID/decision-UUID.json` | `who`, receipt ID and SHA-256, `when` |
| `copies/attempt-ID/` | Detached Git worktree created from the recorded base |
| `target.git/` | Bare repository; `main` is the integration target |

Commands run **in the attempt worktree** with `shell: false`. `node` resolves to
the current Node executable. Other commands must be executables, not `.cmd`
scripts or shell builtins. Arguments containing spaces or shell metacharacters
stay literal. The verifier is outside the worktree, so editing a result cannot
edit the example's checking code. Contract commands and the verifier are trusted.

Each criterion has a ten-second limit and one MiB of captured output. Failure to
start or finish gives a null exit code and cannot produce a pass. Empty criteria
and unfinished work are `not-run`. A nonzero exit is `fail`; all criteria must
finish at zero for `pass`. Result or contract changes during checking force
`fail` even if every command returned zero. These are arbitrary command checks,
not a claim that a test runner executed a nonzero number of tests.

A check invalidates previous acceptance before executing anything, and saves a
preliminary `not-run` receipt before commands run. The final receipt is a new
file. An interrupted check cannot preserve the previous passing decision.

The tree snapshot uses a separate Git index and includes ignored and untracked
files. It leaves the attempt's HEAD and normal index alone. Git attributes in
the generated repository disable line-ending conversion, so the receipt binds
the exact file bytes. The explanation verifier accepts LF and CRLF; changing
between them after a check still requires a new check. Source paths use Node
path utilities; no POSIX shell syntax is required by the example.

`accept` revalidates receipt, contract, and current result hashes, then records
the named reviewer and time. `integrate` repeats those checks, verifies the
decision, and advances `main` with Git's compare-and-swap `update-ref`. A target
move after the check, including one between comparison and update, is refused.
The integrated commit has the checked tree and recorded base as its parent.

Worker output and the completion journal are separate writes. A completed,
recorded step is never repeated, and changed checkpoint output is refused. A
kill between writing an output and recording completion can repeat that
**unrecorded**, deterministic write. This is resumable work, not an exactly-once
transaction for arbitrary side effects.

## Deliberately left out

- **No sandbox.** Workers are deterministic scripts that emit write requests.
  The protocol permits only the two result files and has no decision operation.
  It cannot contain malicious JavaScript running as your OS user. Such code
  could bypass the protocol, write control files, or invoke the CLI itself.
- **No real model**, prompts, API keys, orchestration service, or network calls.
- **No memory or lessons step.** The completion journal is only execution state.
- No authentication: `who` is a label supplied by the reviewer, not a signature.
  Hashes detect changed evidence relative to trusted control files; they do not
  defend against somebody rewriting both the evidence and its stored hash.
- No concurrent controllers, automatic rebasing, conflict resolution, general
  job scheduling, deployment, remote Git hosting, or production durability.
  Rename protects JSON from process interruption; no power-loss guarantee is
  made. Runtime paths are absolute, so keep a run in place while inspecting it.

The tests exercise real Git worktrees, command failures, missing commands,
stale bytes, contract/receipt changes, target movement, a killed process, CRLF,
Unicode paths with spaces, and literal argv. They are ordinary `node:test`
tests, runnable independently of any enclosing repository's test suite.
