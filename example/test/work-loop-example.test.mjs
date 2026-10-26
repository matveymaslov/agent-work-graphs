import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  symlinkSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  init, start, run, check, accept, integrate, inspect, git, applyWorkerAction,
} from '../work-loop.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = (linked = false) => {
  let root = mkdtempSync(join(tmpdir(), 'work loop ü '));
  if (linked) {
    const directory = join(root, 'long directory ü with spaces');
    mkdirSync(directory);
    root = join(root, 'linked directory');
    symlinkSync(directory, root, process.platform === 'win32' ? 'junction' : 'dir');
  }
  init(root);
  return root;
};
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const changeContract = (root, update) => {
  const path = join(root, 'contract.json');
  const contract = json(path);
  update(contract);
  writeFileSync(path, JSON.stringify(contract, null, 2) + '\n');
};
const ready = async (root, id = 'good', worker = 'good') => {
  start(root, id, worker);
  await run(root, id);
  return inspect(root, id);
};

for (const linked of [false, true]) {
  test(`attempt has its own real worktree at the recorded base (${linked ? 'linked' : 'direct'} path)`, async () => {
    const root = fixture(linked);
    const attempt = start(root, 'isolated', 'good');
    assert.equal(git(attempt.copy, ['rev-parse', 'HEAD']), attempt.baseCommit);
    assert.equal(git(join(root, 'target.git'), ['rev-parse', 'main']), attempt.baseCommit);
    // Git can expand Windows short names and resolve directory links differently.
    assert.equal(realpathSync.native(git(attempt.copy, ['rev-parse', '--show-toplevel'])),
      realpathSync.native(attempt.copy));
    assert.match(readFileSync(join(attempt.copy, '.git'), 'utf8'), /^gitdir: /);
    await run(root, attempt.id);
    assert.equal(json(join(attempt.copy, 'result.json')).total, 5);
    assert.equal(git(join(root, 'target.git'), ['rev-parse', 'main']), attempt.baseCommit);
    assert.throws(() => git(join(root, 'target.git'), ['show', 'main:result.json']));
  });
}

test('contract commands execute in the copy and record their real exit codes', async () => {
  const root = fixture();
  await ready(root);
  changeContract(root, (c) => c.criteria.push({
    id: 'deliberate-failure', command: ['node', '-e', 'process.exit(7)'],
  }));
  const receipt = check(root, 'good');
  assert.deepEqual(receipt.criteria.map((c) => c.exitCode), [0, 0, 7]);
  assert.equal(receipt.verdict, 'fail');
  assert.throws(() => accept(root, 'good', 'Reviewer'), /pass/);
});

test('wrong scripted result is refused by the check, before acceptance', async () => {
  const root = fixture();
  await ready(root, 'wrong', 'wrong');
  const receipt = check(root, 'wrong');
  assert.equal(receipt.verdict, 'fail');
  assert.deepEqual(receipt.criteria.map((c) => c.exitCode), [1, 1]);
  assert.throws(() => accept(root, 'wrong', 'Reviewer'), /pass/);
  assert.equal(inspect(root, 'wrong').decision, null);
});

test('worker decision requests and control-file writes are rejected', async () => {
  const root = fixture();
  const attempt = start(root, 'overreach', 'decide');
  await assert.rejects(run(root, 'overreach'), /Worker may only write result files/);
  for (const file of ['../decision.json', 'decision.json', '.git', '..\\decision.json']) {
    assert.throws(() => applyWorkerAction(attempt.copy, {
      operation: 'write', file, content: '{}',
    }), /Worker may only write result files/);
  }
  assert.equal(inspect(root, 'overreach').decision, null);
  assert.equal(existsSync(join(attempt.copy, 'decision.json')), false);
  assert.throws(() => accept(root, 'overreach', 'Reviewer'), /receipt/);
});

test('unstarted work, missing executables and empty criteria never pass', async () => {
  const root = fixture();
  start(root, 'good', 'good');
  let receipt = check(root, 'good');
  assert.equal(receipt.verdict, 'not-run');
  assert.ok(receipt.criteria.every((c) => c.exitCode === null));
  await run(root, 'good');
  changeContract(root, (c) => c.criteria = [{
    id: 'missing', command: [join(root, 'no-such-executable')],
  }]);
  receipt = check(root, 'good');
  assert.equal(receipt.verdict, 'not-run');
  assert.equal(receipt.criteria[0].exitCode, null);
  assert.match(receipt.criteria[0].reason, /ENOENT/);
  assert.throws(() => accept(root, 'good', 'Reviewer'), /pass/);
  changeContract(root, (c) => c.criteria = []);
  assert.equal(check(root, 'good').verdict, 'not-run');
});

test('a failed command replaces an earlier pass and invalidates its decision', async () => {
  const root = fixture();
  await ready(root);
  check(root, 'good');
  accept(root, 'good', 'Reviewer');
  changeContract(root, (c) => c.criteria[0].command = ['node', '-e', 'process.exit(9)']);
  assert.equal(check(root, 'good').verdict, 'fail');
  assert.equal(inspect(root, 'good').decision, null);
  assert.throws(() => integrate(root, 'good'), /accept/);
});

test('receipt binds contract, tree, commands, and acceptance identity', async () => {
  const root = fixture();
  await ready(root);
  const receipt = check(root, 'good');
  assert.equal(receipt.verdict, 'pass');
  assert.match(receipt.contractHash, /^[0-9a-f]{64}$/);
  assert.equal(receipt.resultTreeHash,
    git(join(root, 'target.git'), ['rev-parse', `${receipt.resultCommit}^{tree}`]));
  assert.equal(inspect(root, 'good').decision, null);
  const decision = accept(root, 'good', 'Reviewer');
  assert.equal(decision.who, 'Reviewer');
  assert.equal(decision.receipt.id, receipt.id);
  assert.match(decision.receipt.hash, /^[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(Date.parse(decision.when)));
  assert.deepEqual(json(inspect(root, 'good').decision.path), decision);
});

test('accept refuses a stale result, including an ignored untracked file', async () => {
  const root = fixture();
  const attempt = await ready(root);
  check(root, 'good');
  writeFileSync(join(attempt.copy, 'result.json'), '{"total":99}\n');
  assert.throws(() => accept(root, 'good', 'Reviewer'), /tree.*changed/);
  writeFileSync(join(attempt.copy, 'result.json'), '{"total":5}\n');
  check(root, 'good');
  mkdirSync(join(root, 'target.git', 'info'), { recursive: true });
  writeFileSync(join(root, 'target.git', 'info', 'exclude'), 'ignored.txt\n');
  writeFileSync(join(attempt.copy, 'ignored.txt'), 'unchecked\n');
  assert.throws(() => accept(root, 'good', 'Reviewer'), /tree.*changed/);
});

test('changed contract and tampered receipts cannot reuse a pass', async () => {
  const root = fixture();
  await ready(root);
  check(root, 'good');
  changeContract(root, (c) => c.revision++);
  assert.throws(() => accept(root, 'good', 'Reviewer'), /contract.*changed/);
  check(root, 'good');
  const receiptPath = inspect(root, 'good').receipt.path;
  const receipt = json(receiptPath);
  receipt.criteria[0].exitCode = 13;
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => accept(root, 'good', 'Reviewer'), /receipt.*changed/);
});

test('checker mutation cannot produce a pass for different bytes', async () => {
  const root = fixture();
  await ready(root);
  changeContract(root, (c) => c.criteria.push({
    id: 'mutating-check', command: ['node', '-e',
      "require('node:fs').writeFileSync('result.json', '{\"total\":100}\\n')"],
  }));
  const receipt = check(root, 'good');
  assert.ok(receipt.criteria.every((c) => c.exitCode === 0));
  assert.equal(receipt.verdict, 'fail');
  assert.match(receipt.reason, /changed during check/);
  assert.throws(() => accept(root, 'good', 'Reviewer'), /pass/);
});

test('integration requires acceptance and revalidates the current result', async () => {
  const root = fixture();
  const attempt = await ready(root);
  check(root, 'good');
  assert.throws(() => integrate(root, 'good'), /accept/);
  accept(root, 'good', 'Reviewer');
  writeFileSync(join(attempt.copy, 'explanation.txt'), 'changed after acceptance\n');
  assert.throws(() => integrate(root, 'good'), /tree.*changed/);
  assert.equal(git(join(root, 'target.git'), ['rev-parse', 'main']), attempt.baseCommit);
});

test('moved target refuses integration and a fresh attempt can re-check', async () => {
  const root = fixture();
  await ready(root);
  check(root, 'good');
  accept(root, 'good', 'Reviewer');
  const repo = join(root, 'target.git');
  const base = git(repo, ['rev-parse', 'main']);
  const next = git(repo, ['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'Another change']);
  git(repo, ['update-ref', 'refs/heads/main', next, base]);
  assert.throws(() => integrate(root, 'good'), /Target moved.*re-check/);
  assert.equal(git(repo, ['rev-parse', 'main']), next);
  assert.equal(check(root, 'good').verdict, 'not-run');
  await ready(root, 'fresh');
  check(root, 'fresh');
  accept(root, 'fresh', 'Reviewer');
  const commit = integrate(root, 'fresh');
  assert.equal(git(repo, ['rev-parse', 'main']), commit);
  assert.equal(git(repo, ['show', 'main:result.json']), '{"total":5}');
  assert.equal(git(repo, ['rev-parse', `${commit}^`]), next);
});

test('a process killed after the first checkpoint resumes without repeating it', async () => {
  const root = fixture();
  const attempt = start(root, 'resume', 'good');
  const child = fork(cli, ['run', root, 'resume', '--pause-after', 'calculate'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stderr.on('data', (chunk) => output += chunk);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('No checkpoint: ' + output)); }, 15000);
    child.once('error', reject);
    child.on('message', (message) => {
      if (message.step === 'calculate') child.kill();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? reject(new Error('Expected an interrupted process')) : resolve();
    });
  });
  const interrupted = inspect(root, 'resume');
  assert.equal(interrupted.state, 'working');
  assert.deepEqual(interrupted.completed.map((step) => step.step), ['calculate']);
  const before = statSync(join(attempt.copy, 'result.json')).mtimeMs;
  const steps = [];
  await run(root, 'resume', { onStep: (step) => steps.push(step) });
  assert.deepEqual(steps, ['explain']);
  assert.equal(statSync(join(attempt.copy, 'result.json')).mtimeMs, before);
  assert.deepEqual(inspect(root, 'resume').completed[0], interrupted.completed[0]);
  assert.equal(check(root, 'resume').verdict, 'pass');
  await run(root, 'resume', { onStep: () => assert.fail('Finished step repeated') });
});

test('resume refuses altered checkpoint output', async () => {
  const root = fixture();
  const attempt = start(root, 'resume', 'good');
  await assert.rejects(run(root, 'resume', { onStep: () => { throw new Error('stop'); } }), /stop/);
  writeFileSync(join(attempt.copy, 'result.json'), '{"total":999}\n');
  await assert.rejects(run(root, 'resume'), /Completed step.*changed/);
});

test('paths with spaces, CRLF, and shell metacharacters are handled literally', async () => {
  const root = fixture();
  const attempt = await ready(root);
  git(attempt.copy, ['config', 'core.autocrlf', 'true']);
  writeFileSync(join(attempt.copy, 'explanation.txt'), '2 + 3 = 5\r\n');
  changeContract(root, (c) => c.criteria.push({
    id: 'literal-argv', command: ['node', '-e',
      "process.exit(process.argv[1] === 'a & b | c > d' ? 0 : 8)", 'a & b | c > d'],
  }));
  assert.equal(check(root, 'good').verdict, 'pass');
  accept(root, 'good', 'Reviewer');
  integrate(root, 'good');
  assert.equal(git(join(root, 'target.git'), ['show', 'main:explanation.txt']), '2 + 3 = 5');
});

test('CLI reports pass, fail and not-run as distinct exit statuses', async () => {
  const root = fixture();
  start(root, 'good', 'good');
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(invoke(['check', root, 'good']).status, 2);
  await run(root, 'good');
  assert.equal(invoke(['check', root, 'good']).status, 0);
  assert.equal(invoke(['accept', root, 'good', 'Reviewer']).status, 0);
  await ready(root, 'wrong', 'wrong');
  assert.equal(invoke(['check', root, 'wrong']).status, 1);
  assert.equal(invoke(['accept', root, 'wrong', 'Reviewer']).status, 1);
  assert.equal(invoke(['decide', root, 'wrong']).status, 1);
});

test('malformed contract cannot leave an earlier pass available', async () => {
  const root = fixture();
  await ready(root);
  check(root, 'good');
  accept(root, 'good', 'Reviewer');
  changeContract(root, (c) => c.criteria[0].command = 'node verify.mjs');
  assert.throws(() => check(root, 'good'), /Invalid contract criterion/);
  assert.equal(inspect(root, 'good').receipt, null);
  assert.equal(inspect(root, 'good').decision, null);
  assert.throws(() => accept(root, 'good', 'Reviewer'), /receipt/);
});

test('a killed check leaves not-run evidence and no previous acceptance', async () => {
  const root = fixture();
  await ready(root);
  check(root, 'good');
  accept(root, 'good', 'Reviewer');
  changeContract(root, (c) => c.criteria = [{
    id: 'interrupt', command: ['node', '-e', 'process.kill(process.ppid)'],
  }]);
  const interrupted = spawnSync(process.execPath, [cli, 'check', root, 'good'], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  });
  assert.notEqual(interrupted.status, 0);
  const attempt = inspect(root, 'good');
  assert.equal(attempt.state, 'checking');
  assert.equal(attempt.decision, null);
  assert.equal(json(attempt.receipt.path).verdict, 'not-run');
  assert.equal(json(attempt.receipt.path).criteria[0].exitCode, null);
  assert.throws(() => accept(root, 'good', 'Reviewer'), /pass/);
});

test('integration refuses a modified decision record', async () => {
  const root = fixture();
  const attempt = await ready(root);
  check(root, 'good');
  accept(root, 'good', 'Reviewer');
  const path = inspect(root, 'good').decision.path;
  const decision = json(path);
  decision.who = 'Somebody else';
  writeFileSync(path, JSON.stringify(decision));
  assert.throws(() => integrate(root, 'good'), /Decision does not match/);
  assert.equal(git(join(root, 'target.git'), ['rev-parse', 'main']), attempt.baseCommit);
});
