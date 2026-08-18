import { test } from 'node:test';
import assert from 'node:assert';

import { tagLines } from '../src/log-tag.js';

test('tags a single line with the level prefix', () => {
  assert.strictEqual(tagLines('info', 'hello world'), '[info] hello world');
});

test('tags every physical line of a multi-line stack', () => {
  const stack = ['Error: boom', '    at foo (a.js:1:1)', '    at bar (b.js:2:2)'].join('\n');
  const tagged = tagLines('error', stack);
  const lines = tagged.split('\n');
  assert.strictEqual(lines.length, 3);
  for (const line of lines) {
    assert.ok(line.startsWith('[error] '), `line not tagged: ${line}`);
  }
  assert.strictEqual(lines[0], '[error] Error: boom');
  assert.strictEqual(lines[1], '[error]     at foo (a.js:1:1)');
  assert.strictEqual(lines[2], '[error]     at bar (b.js:2:2)');
});

test('tags an empty message as a bare prefix', () => {
  assert.strictEqual(tagLines('warn', ''), '[warn] ');
});

test('coerces non-string input', () => {
  assert.strictEqual(tagLines('debug', 42), '[debug] 42');
});
