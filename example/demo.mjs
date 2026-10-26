import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init, start, run, check, accept, integrate, inspect, git } from './work-loop.mjs';

const root = mkdtempSync(join(tmpdir(), 'work-loop-example-'));
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const say = (message) => console.log(message);
const refuse = (action, pattern) => {
  assert.throws(action, (error) => {
    assert.match(error.message, pattern);
    say(`   Refused: ${error.message}`);
    return true;
  });
};

say(`Evidence directory (kept for inspection): ${root}`);
say('1. Create a contract: calculate 2 + 3 and explain the answer.');
init(root);
say(`   Contract: ${join(root, 'contract.json')}`);

say('2. Isolate the wrong worker at a recorded base; check its real output.');
start(root, 'wrong', 'wrong');
await run(root, 'wrong');
const wrong = check(root, 'wrong');
assert.equal(wrong.verdict, 'fail');
say(`   Check: ${wrong.verdict}; exit codes: ${wrong.criteria.map((c) => c.exitCode).join(', ')}`);
refuse(() => accept(root, 'wrong', 'Reviewer'), /pass/);

say('3. Reject a worker that asks to write its own decision.');
start(root, 'overreach', 'decide');
await assert.rejects(run(root, 'overreach'), (error) => {
  say(`   Refused: ${error.message}`);
  return /cannot decide/.test(error.message);
});
assert.equal(inspect(root, 'overreach').decision, null);

say('4. A check before the work runs is not-run, never pass.');
start(root, 'good');
assert.equal(check(root, 'good').verdict, 'not-run');
say('   Check: not-run; no completed criterion exit codes.');
await run(root, 'good');
const receipt = check(root, 'good');
assert.equal(receipt.verdict, 'pass');
say(`5. Bind a passing receipt to contract ${receipt.contractHash.slice(0, 12)} and tree ${receipt.resultTreeHash.slice(0, 12)}.`);

say('6. Refuse acceptance after the result changes.');
const result = join(inspect(root, 'good').copy, 'result.json');
const original = readFileSync(result);
writeFileSync(result, '{"total":999}\n');
refuse(() => accept(root, 'good', 'Reviewer'), /tree.*changed/);
writeFileSync(result, original);
check(root, 'good');
const decision = accept(root, 'good', 'Reviewer');
say(`7. Accept explicitly: ${decision.who}, receipt ${decision.receipt.id}, ${decision.when}.`);

say('8. Another actor moves main; integration demands a re-check.');
const movement = spawnSync(process.execPath, [cli, 'advance-target', root], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(movement.status, 0, movement.stderr);
refuse(() => integrate(root, 'good'), /Target moved.*re-check/);

say('9. Start at the new base, kill the process after its first saved step.');
start(root, 'resumed');
const child = fork(cli, ['run', root, 'resumed', '--pause-after', 'calculate'], {
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
child.stdout.on('data', (chunk) => process.stdout.write(`   ${chunk}`));
let errors = '';
child.stderr.on('data', (chunk) => errors += chunk);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`Checkpoint not reached: ${errors}`));
  }, 15000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('message', ({ step }) => { if (step === 'calculate') child.kill(); });
  child.once('exit', (code) => {
    clearTimeout(timer);
    code === 0 ? reject(new Error('Expected an interrupted process')) : resolve();
  });
});
assert.deepEqual(inspect(root, 'resumed').completed.map((c) => c.step), ['calculate']);
const resumedSteps = [];
await run(root, 'resumed', { onStep: (step) => resumedSteps.push(step) });
assert.deepEqual(resumedSteps, ['explain']);
say('10. Resume from the journal: only explain runs; calculate is not repeated.');
assert.equal(check(root, 'resumed').verdict, 'pass');
accept(root, 'resumed', 'Reviewer');
const integrated = integrate(root, 'resumed');
assert.equal(git(join(root, 'target.git'), ['show', 'main:result.json']), '{"total":5}');
say(`11. Re-check, accept, integrate: main now points to ${integrated}.`);
say(`    Result: ${git(join(root, 'target.git'), ['show', 'main:result.json'])}`);
say('All expected refusals and the final integration were observed. No network used.');
