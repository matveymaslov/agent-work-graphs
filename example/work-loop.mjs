import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync,
  existsSync, lstatSync, openSync, closeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workerScript = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const verifierScript = fileURLToPath(new URL('./verify.mjs', import.meta.url));
const steps = ['calculate', 'explain'];
const resultFiles = ['result.json', 'explanation.txt'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const target = (root) => join(root, 'target.git');
const tip = (root) => git(target(root), ['rev-parse', 'refs/heads/main']);
const contractPath = (root) => join(root, 'contract.json');

// A new file plus rename keeps the journal parseable if a process is killed.
function write(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n');
  renameSync(temporary, path);
}

function directory(root, id) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id ?? '')) throw new Error('Use a short lowercase attempt id');
  return join(resolve(root), 'control', `attempt-${id}`);
}

function save(root, attempt) {
  write(join(directory(root, attempt.id), 'attempt.json'), attempt);
}

export function inspect(root, id) {
  return read(join(directory(root, id), 'attempt.json'));
}

// Ignore caller Git routing/config variables: every operation names its repository.
export function git(cwd, args, { input, env = {} } = {}) {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  // A finite file for stdin also works where closing anonymous input pipes is restricted.
  const inputPath = input === undefined ? null : join(cwd, `input-${randomUUID()}.tmp`);
  let descriptor;
  let result;
  try {
    if (inputPath) {
      writeFileSync(inputPath, input, { flag: 'wx' });
      descriptor = openSync(inputPath, 'r');
    }
    result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], {
      cwd, encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000,
      stdio: [descriptor ?? 'ignore', 'pipe', 'pipe'],
      env: { ...environment, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env },
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (inputPath && existsSync(inputPath)) unlinkSync(inputPath);
  }
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]}: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function init(root) {
  root = resolve(root);
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).length) throw new Error('Initialize an empty directory');
  mkdirSync(join(root, 'control'));
  mkdirSync(join(root, 'copies'));
  mkdirSync(join(root, 'empty-hooks'));
  git(root, ['init', '--bare', '--initial-branch=main', '--template=', target(root)]);
  for (const [name, value] of Object.entries({
    'user.name': 'Example Reviewer', 'user.email': 'reviewer@example.invalid',
    'commit.gpgSign': 'false', 'core.fileMode': 'false',
    'core.hooksPath': join(root, 'empty-hooks'),
  })) git(target(root), ['config', name, value]);
  const entries = [
    ['.gitattributes', '* -text\n'],
    ['input.json', '{"numbers":[2,3]}\n'],
  ].map(([name, content]) => {
    const blob = git(target(root), ['hash-object', '-w', '--stdin'], { input: content });
    return `100644 blob ${blob}\t${name}\n`;
  }).join('');
  const tree = git(target(root), ['mktree'], { input: entries });
  const base = git(target(root), ['commit-tree', tree, '-m', 'Initial input']);
  git(target(root), ['update-ref', 'refs/heads/main', base]);
  const contract = {
    id: 'add-two-numbers', revision: 1,
    criteria: ['total', 'explanation'].map((id) => ({
      id, command: ['node', verifierScript, id],
    })),
  };
  write(contractPath(root), contract);
  return { root, target: target(root), contract };
}

export function start(root, id, worker = 'good') {
  if (!['good', 'wrong', 'decide'].includes(worker)) throw new Error('Unknown scripted worker');
  const control = directory(root, id);
  if (existsSync(control)) throw new Error('Attempt already exists; use run to resume');
  const baseCommit = tip(root);
  const copy = join(resolve(root), 'copies', `attempt-${id}`);
  git(target(root), ['worktree', 'add', '--detach', copy, baseCommit]);
  mkdirSync(control);
  const attempt = { id, baseCommit, copy, worker, state: 'created',
    completed: [], receipt: null, decision: null };
  save(root, attempt);
  return attempt;
}

// This is the worker's entire write capability. Control records are not in it.
export function applyWorkerAction(copy, action) {
  if (action?.operation !== 'write' || !resultFiles.includes(action.file)
      || typeof action.content !== 'string') {
    throw new Error('Worker may only write result files; it cannot decide');
  }
  const path = join(copy, action.file);
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('Result must be a regular file');
  writeFileSync(path, action.content);
}

export async function run(root, id, { onStep = () => {} } = {}) {
  const attempt = inspect(root, id);
  if (attempt.state === 'integrated') throw new Error('Attempt already integrated');
  for (const done of attempt.completed) {
    const path = join(attempt.copy, done.file);
    if (!existsSync(path) || hash(readFileSync(path)) !== done.hash) {
      throw new Error(`Completed step ${done.step} changed; start a fresh attempt`);
    }
  }
  for (const step of steps.slice(attempt.completed.length)) {
    attempt.state = 'working';
    attempt.receipt = null;
    attempt.decision = null;
    save(root, attempt);
    const result = spawnSync(process.execPath, [workerScript, attempt.worker, step], {
      cwd: attempt.copy, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
    const action = JSON.parse(result.stdout);
    if (action.file !== resultFiles[steps.indexOf(step)]) {
      throw new Error('Worker may only write result files for its current step; it cannot decide');
    }
    applyWorkerAction(attempt.copy, action);
    attempt.completed.push({ step, file: action.file, hash: hash(readFileSync(join(attempt.copy, action.file))) });
    attempt.state = attempt.completed.length === steps.length ? 'ready' : 'working';
    save(root, attempt);
    await onStep(step);
  }
  return attempt;
}

// Use a disposable index, include ignored/untracked files, and leave HEAD untouched.
function resultTree(root, attempt) {
  const index = join(directory(root, attempt.id), `index-${randomUUID()}`);
  const options = { env: { GIT_INDEX_FILE: index } };
  try {
    git(attempt.copy, ['read-tree', 'HEAD'], options);
    git(attempt.copy, ['add', '--all', '--force', '--', '.'], options);
    return git(attempt.copy, ['write-tree'], options);
  } finally {
    if (existsSync(index)) unlinkSync(index);
  }
}

function validateContract(contract) {
  if (!contract || typeof contract.id !== 'string' || !contract.id
      || !Number.isInteger(contract.revision) || contract.revision < 1
      || !Array.isArray(contract.criteria)) throw new Error('Invalid contract');
  const ids = new Set();
  for (const criterion of contract.criteria) {
    if (typeof criterion.id !== 'string' || !criterion.id || ids.has(criterion.id)
        || !Array.isArray(criterion.command) || !criterion.command.length
        || !criterion.command.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
        || !criterion.command[0]) throw new Error('Invalid contract criterion');
    ids.add(criterion.id);
  }
}

function record(root, attempt, kind, data) {
  const path = join(directory(root, attempt.id), `${kind}-${data.id}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  return { id: data.id, path, hash: hash(readFileSync(path)) };
}

export function check(root, id) {
  const attempt = inspect(root, id);
  if (attempt.state === 'integrated') throw new Error('Attempt already integrated');
  // A crashed or invalid re-check must not leave an old pass available for acceptance.
  attempt.receipt = null;
  attempt.decision = null;
  attempt.state = 'checking';
  save(root, attempt);
  const contractBytes = readFileSync(contractPath(root));
  const contract = JSON.parse(contractBytes);
  validateContract(contract);
  const receipt = {
    id: randomUUID(), attemptId: id, contractHash: hash(contractBytes),
    resultTreeHash: resultTree(root, attempt), targetCommit: tip(root), resultCommit: null,
    criteria: contract.criteria.map(({ id, command }) => ({ id, command, exitCode: null, reason: 'Not run' })),
    verdict: 'not-run', reason: '',
  };
  if (attempt.completed.length !== steps.length) receipt.reason = 'Worker steps incomplete';
  else if (receipt.targetCommit !== attempt.baseCommit) {
    receipt.reason = 'Target moved; start a fresh attempt from the new base and re-check';
  } else if (!receipt.criteria.length) receipt.reason = 'Contract has no criteria';
  else {
    // Persist not-run evidence before running any command, including a command that kills us.
    attempt.receipt = record(root, attempt, 'receipt', receipt);
    save(root, attempt);
    for (const criterion of receipt.criteria) {
      const [executable, ...args] = criterion.command;
      const result = spawnSync(executable === 'node' ? process.execPath : executable, args, {
        cwd: attempt.copy, encoding: 'utf8', shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000, maxBuffer: 1024 * 1024,
      });
      criterion.exitCode = result.status;
      criterion.reason = result.error?.message ?? (result.signal ? `Terminated by ${result.signal}` : '');
      criterion.stdout = result.stdout ?? '';
      criterion.stderr = result.stderr ?? '';
    }
    receipt.verdict = receipt.criteria.some((c) => c.exitCode !== null && c.exitCode !== 0) ? 'fail'
      : receipt.criteria.every((c) => c.exitCode === 0 && !c.reason) ? 'pass' : 'not-run';
    if (resultTree(root, attempt) !== receipt.resultTreeHash
        || hash(readFileSync(contractPath(root))) !== receipt.contractHash) {
      receipt.verdict = 'fail';
      receipt.reason = 'Result or contract changed during check';
    }
  }
  if (receipt.verdict === 'pass') {
    receipt.resultCommit = git(attempt.copy, ['commit-tree', receipt.resultTreeHash,
      '-p', attempt.baseCommit, '-m', `Checked result: ${id}`]);
  }
  // Final receipts are immutable; the preliminary not-run receipt remains as evidence.
  receipt.id = randomUUID();
  attempt.receipt = record(root, attempt, 'receipt', receipt);
  attempt.state = 'checked';
  save(root, attempt);
  return receipt;
}

function boundReceipt(root, attempt) {
  if (!attempt.receipt) throw new Error('No check receipt; run check first');
  const bytes = readFileSync(attempt.receipt.path);
  if (hash(bytes) !== attempt.receipt.hash) throw new Error('The receipt changed; re-check');
  const receipt = JSON.parse(bytes);
  if (receipt.verdict !== 'pass' || !receipt.criteria.length
      || !receipt.criteria.every((c) => c.exitCode === 0 && !c.reason)) {
    throw new Error('Only a pass receipt can be accepted');
  }
  if (hash(readFileSync(contractPath(root))) !== receipt.contractHash) {
    throw new Error('The contract changed; re-check');
  }
  if (resultTree(root, attempt) !== receipt.resultTreeHash) throw new Error('The result tree has changed; re-check');
  return receipt;
}

// Only this command creates a decision. The worker protocol cannot call it.
export function accept(root, id, who) {
  if (typeof who !== 'string' || !who.trim()) throw new Error('Name the accepting reviewer');
  const attempt = inspect(root, id);
  if (attempt.state === 'integrated') throw new Error('Attempt already integrated');
  boundReceipt(root, attempt);
  const decision = { id: randomUUID(), who: who.trim(),
    receipt: { id: attempt.receipt.id, hash: attempt.receipt.hash }, when: new Date().toISOString() };
  attempt.decision = record(root, attempt, 'decision', decision);
  attempt.state = 'accepted';
  save(root, attempt);
  return decision;
}

export function integrate(root, id) {
  const attempt = inspect(root, id);
  if (!attempt.decision) throw new Error('Run accept before integration');
  const receipt = boundReceipt(root, attempt);
  const decisionBytes = readFileSync(attempt.decision.path);
  const decision = JSON.parse(decisionBytes);
  if (hash(decisionBytes) !== attempt.decision.hash
      || decision.receipt.id !== receipt.id || decision.receipt.hash !== attempt.receipt.hash) {
    throw new Error('Decision does not match this receipt; accept again');
  }
  if (tip(root) !== receipt.targetCommit) {
    throw new Error('Target moved since check; start a fresh attempt and re-check');
  }
  // Compare-and-swap also catches movement between the read above and this update.
  try {
    git(target(root), ['update-ref', 'refs/heads/main', receipt.resultCommit, receipt.targetCommit]);
  } catch (error) {
    throw new Error(`Integration refused; target may have moved. Re-check: ${error.message}`);
  }
  attempt.state = 'integrated';
  save(root, attempt);
  return receipt.resultCommit;
}
