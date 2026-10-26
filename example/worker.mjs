import { readFileSync, writeSync } from 'node:fs';

// Workers return proposals; only the controller applies allowed writes.
const [kind, step] = process.argv.slice(2);
const { numbers } = JSON.parse(readFileSync('input.json', 'utf8'));
const total = numbers.reduce((sum, number) => sum + number, 0) + (kind === 'wrong' ? 1 : 0);
const action = kind === 'decide' ? { operation: 'decide', verdict: 'accept' }
  : step === 'calculate' ? { operation: 'write', file: 'result.json', content: JSON.stringify({ total }) + '\n' }
    : { operation: 'write', file: 'explanation.txt', content: `${numbers.join(' + ')} = ${total}\n` };
writeSync(1, JSON.stringify(action) + '\n');
