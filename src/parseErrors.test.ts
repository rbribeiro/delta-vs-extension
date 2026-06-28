import { test } from 'node:test';
import * as assert from 'node:assert';
import { parseDeltaOutput, stripAnsi } from './parseErrors';

test('parses GNU-style file:line:col: error: message', () => {
  const [d] = parseDeltaOutput('paper.dlt:12:5: error: unexpected closing tag </secton>');
  assert.equal(d.file, 'paper.dlt');
  assert.equal(d.line, 12);
  assert.equal(d.column, 5);
  assert.equal(d.severity, 'error');
  assert.equal(d.message, 'unexpected closing tag </secton>');
});

test('parses GNU-style without column or severity (defaults to error)', () => {
  const [d] = parseDeltaOutput('chapter.dlt:3: missing required attribute "id"');
  assert.equal(d.line, 3);
  assert.equal(d.column, 0);
  assert.equal(d.severity, 'error');
  assert.equal(d.message, 'missing required attribute "id"');
});

test('parses warning with trailing (file:line:col) location', () => {
  const [d] = parseDeltaOutput('warning: unknown package (preamble.dlt:7:2)');
  assert.equal(d.severity, 'warning');
  assert.equal(d.file, 'preamble.dlt');
  assert.equal(d.line, 7);
  assert.equal(d.column, 2);
  assert.equal(d.message, 'unknown package');
});

test('parses delta real format and drops the duplicated leading location', () => {
  // Exact shape observed from the delta CLI.
  const [d] = parseDeltaOutput('error: 6:11: unexpected close tag. (broken.dlt:6:11)');
  assert.equal(d.severity, 'error');
  assert.equal(d.file, 'broken.dlt');
  assert.equal(d.line, 6);
  assert.equal(d.column, 11);
  assert.equal(d.message, 'unexpected close tag.');
});

test('collapses delta duplicate diagnostic lines', () => {
  const out = [
    'error: 6:11: unexpected close tag. (broken.dlt:6:11)',
    'error: 6:11: unexpected close tag. (broken.dlt:6:11)',
    'error: 6:11: unmatched closing tag: sectio. (broken.dlt:6:11)'
  ].join('\n');
  assert.equal(parseDeltaOutput(out).length, 2);
});

test('parses a bare error line with no location', () => {
  const [d] = parseDeltaOutput('Error: could not resolve bibliography refs.bib');
  assert.equal(d.line, 0);
  assert.equal(d.severity, 'error');
  assert.match(d.message, /bibliography/);
});

test('ignores ordinary progress lines', () => {
  const out = ['Building paper.dlt...', 'Watching for changes', 'Done in 240ms'].join('\n');
  assert.deepEqual(parseDeltaOutput(out), []);
});

test('strips ANSI color codes before matching', () => {
  const colored = '\x1b[31mpaper.dlt:1:1: error: boom\x1b[0m';
  assert.equal(stripAnsi(colored), 'paper.dlt:1:1: error: boom');
  const [d] = parseDeltaOutput(colored);
  assert.equal(d.message, 'boom');
});
