import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { prodPackages, pruneResources, NODE_MODULES_GLOB } from '../scripts/prune-resources.js';

const repoRoot = path.join(import.meta.dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

const lockFixture = {
  lockfileVersion: 2,
  packages: {
    '': { name: 'app' },
    'node_modules/mqtt': {},
    'node_modules/@scope/prod': {},
    'node_modules/mqtt/node_modules/nested': {},
    'node_modules/typescript': { dev: true },
    'node_modules/@types/node': { dev: true },
    'node_modules/opt-installed': { optional: true },
    'node_modules/opt-missing': { optional: true },
    'node_modules/dev-optional': { devOptional: true },
  },
};

test('prodPackages keeps top-level non-dev packages that are installed', () => {
  const installed = name => name !== 'opt-missing';
  assert.deepStrictEqual(prodPackages(lockFixture, installed), [
    '@scope/prod',
    'dev-optional',
    'mqtt',
    'opt-installed',
  ]);
});

test('pruneResources swaps the node_modules sweep for one glob per package', () => {
  const base = ['../package.json', '../src/*', NODE_MODULES_GLOB, '../assets/**/*'];
  assert.deepStrictEqual(pruneResources(base, ['@scope/prod', 'mqtt']), [
    '../package.json',
    '../src/*',
    '../node_modules/@scope/prod/**/*',
    '../node_modules/mqtt/**/*',
    '../assets/**/*',
  ]);
});

test('pruneResources refuses a base list without the node_modules sweep', () => {
  assert.throws(() => pruneResources(['../src/*'], ['mqtt']), /node_modules/);
});

test('pruneResources refuses an empty package list', () => {
  assert.throws(() => pruneResources([NODE_MODULES_GLOB], []), /no production packages/);
});

// Против настоящего package-lock.json: всё из dependencies обязано уцелеть —
// initModules() глотает исключения, так что выпавший пакет в установленном
// приложении упадёт молча. devDependencies, наоборот, уехать не должны.
test('real lockfile: every dependency survives, every devDependency is dropped', () => {
  const pkg = readJson('package.json');
  const kept = prodPackages(readJson('package-lock.json'), () => true);
  for (const name of Object.keys(pkg.dependencies)) {
    assert.ok(kept.includes(name), `${name} is a dependency and must be bundled`);
  }
  for (const name of Object.keys(pkg.devDependencies)) {
    assert.ok(!kept.includes(name), `${name} is a devDependency and must not be bundled`);
  }
});

test('real base config: only the node_modules entry is rewritten', () => {
  const base = readJson('src-tauri/tauri.conf.json').bundle.resources;
  const pruned = pruneResources(base, ['mqtt']);
  for (const entry of base) {
    if (entry === NODE_MODULES_GLOB) continue;
    assert.ok(pruned.includes(entry), `${entry} must survive pruning`);
  }
  assert.ok(!pruned.includes(NODE_MODULES_GLOB));
});
