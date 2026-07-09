import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { parseInputs, parseOut, findProjectToml, loadProject, projectIncludes } from './project';

test('parseInputs reads a single-line inputs array', () => {
  assert.deepEqual(parseInputs('inputs = ["intro.dlt", "chapter2.dlt"]'), [
    'intro.dlt',
    'chapter2.dlt'
  ]);
});

test('parseOut reads the out key, ignoring a trailing comment', () => {
  assert.equal(parseOut('inputs = ["a.dlt"]\nout = "site"   # output dir'), 'site');
  assert.equal(parseOut("out = 'build'"), 'build');
});

test('parseOut returns undefined when there is no out key', () => {
  assert.equal(parseOut('inputs = ["a.dlt"]'), undefined);
});

test('parseInputs reads a multi-line inputs array with trailing comma', () => {
  const toml = ['title = "Book"', 'inputs = [', '  "a.dlt",', "  'b.dlt',", ']', ''].join('\n');
  assert.deepEqual(parseInputs(toml), ['a.dlt', 'b.dlt']);
});

test('parseInputs returns empty when there is no inputs array', () => {
  assert.deepEqual(parseInputs('title = "Book"'), []);
});

test('findProjectToml walks up to the workspace root', () => {
  const root = path.join('/ws');
  const start = path.join('/ws', 'chapters', 'sub');
  const toml = path.join('/ws', 'project.toml');
  const found = findProjectToml(start, root, (p) => p === toml);
  assert.equal(found, toml);
});

test('findProjectToml stops at the workspace root', () => {
  const root = path.join('/ws');
  const start = path.join('/ws', 'chapters');
  // project.toml only exists above the workspace; must not be found.
  const found = findProjectToml(start, root, (p) => p === path.join('/', 'project.toml'));
  assert.equal(found, undefined);
});

test('findProjectToml ignores dirs outside the workspace', () => {
  assert.equal(findProjectToml('/other/place', '/ws', () => true), undefined);
});

test('loadProject resolves inputs relative to the toml dir and checks membership', () => {
  const toml = path.join('/ws', 'project.toml');
  const info = loadProject(toml, () => 'inputs = ["chapters/a.dlt", "b.dlt"]');
  assert.deepEqual(info.inputs, [
    path.join('/ws', 'chapters', 'a.dlt'),
    path.join('/ws', 'b.dlt')
  ]);
  assert.ok(projectIncludes(info, path.join('/ws', 'b.dlt')));
  assert.ok(!projectIncludes(info, path.join('/ws', 'c.dlt')));
});

test('loadProject surfaces the out key when present, undefined otherwise', () => {
  const toml = path.join('/ws', 'project.toml');
  const withOut = loadProject(toml, () => 'inputs = ["a.dlt"]\nout = "site"');
  assert.equal(withOut.out, 'site');
  const withoutOut = loadProject(toml, () => 'inputs = ["a.dlt"]');
  assert.equal(withoutOut.out, undefined);
});
