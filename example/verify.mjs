import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The trusted verifier lives outside the worker's result tree.
try {
  const { numbers } = JSON.parse(readFileSync('input.json', 'utf8'));
  assert.deepEqual(numbers, [2, 3]);
  const total = numbers.reduce((sum, number) => sum + number, 0);
  const criterion = process.argv[2];
  if (criterion === 'total') {
    assert.deepEqual(JSON.parse(readFileSync('result.json', 'utf8')), { total });
  } else if (criterion === 'explanation') {
    assert.equal(readFileSync('explanation.txt', 'utf8').replace(/\r\n/g, '\n'), `${numbers.join(' + ')} = ${total}\n`);
  } else throw new Error('Unknown criterion');
  console.log(`${criterion}: pass`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
