import { init, start, run, check, accept, integrate, inspect, git } from './work-loop.mjs';
import { join } from 'node:path';

const usage = 'Usage: node cli.mjs init ROOT | start ROOT ID [good|wrong|decide] | run ROOT ID [--pause-after calculate] | check ROOT ID | accept ROOT ID WHO | integrate ROOT ID | inspect ROOT ID | advance-target ROOT';

try {
  const [command, root, id, ...rest] = process.argv.slice(2);
  if (!root) throw new Error(usage);
  let result;
  if (command === 'init' && !id) result = init(root);
  else if (command === 'start' && rest.length <= 1) result = start(root, id, rest[0]);
  else if (command === 'run' && (rest.length === 0
      || (rest.length === 2 && rest[0] === '--pause-after' && rest[1] === 'calculate'))) {
    result = await run(root, id, { onStep: async (step) => {
      console.log(`Saved step: ${step}`);
      if (rest[1] === step) {
        console.log('Checkpoint saved. Stop this process, then run again to resume.');
        process.send?.({ step });
        await new Promise(() => setInterval(() => {}, 1000));
      }
    } });
  } else if (command === 'check' && !rest.length) {
    result = check(root, id);
    process.exitCode = { pass: 0, fail: 1, 'not-run': 2 }[result.verdict];
  } else if (command === 'accept' && rest.length === 1) result = accept(root, id, rest[0]);
  else if (command === 'integrate' && !rest.length) result = integrate(root, id);
  else if (command === 'inspect' && !rest.length) result = inspect(root, id);
  else if (command === 'advance-target' && !id) {
    // Teaching aid: another actor advances the branch, even with the same tree.
    const repo = join(root, 'target.git');
    const previous = git(repo, ['rev-parse', 'main']);
    const next = git(repo, ['commit-tree', `${previous}^{tree}`, '-p', previous, '-m', 'Another change']);
    git(repo, ['update-ref', 'refs/heads/main', next, previous]);
    result = { previous, next };
  } else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
