import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import {
  resolveDeltaCommand,
  localBinPath,
  outputPathFor,
  buildArgs,
  buildWatchArgs
} from './deltaCli';

test('explicit delta.path is trusted as-is', () => {
  const r = resolveDeltaCommand('/opt/delta/bin/delta', '/ws', () => true);
  assert.equal(r.command, '/opt/delta/bin/delta');
  assert.equal(r.isLocal, false);
});

test('default prefers a workspace-local install when present', () => {
  const local = localBinPath('/ws');
  const r = resolveDeltaCommand('delta', '/ws', (p) => p === local);
  assert.equal(r.command, local);
  assert.equal(r.isLocal, true);
});

test('default falls back to PATH when no local install', () => {
  const r = resolveDeltaCommand('delta', '/ws', () => false);
  assert.equal(r.command, 'delta');
  assert.equal(r.isLocal, false);
});

test('default with no workspace falls back to PATH', () => {
  const r = resolveDeltaCommand('delta', undefined, () => true);
  assert.equal(r.command, 'delta');
});

test('outputPathFor writes .html alongside the source', () => {
  assert.equal(outputPathFor(path.join('a', 'b', 'doc.dlt')), path.join('a', 'b', 'doc.html'));
});

test('build args target the resolved output path', () => {
  assert.deepEqual(buildArgs('doc.dlt', 'doc.html'), ['build', 'doc.dlt', '-o', 'doc.html']);
  assert.deepEqual(buildWatchArgs('doc.dlt', 'doc.html'), [
    'build',
    'doc.dlt',
    '-o',
    'doc.html',
    '--watch'
  ]);
});
