import { test } from 'node:test';
import * as assert from 'node:assert';
import { closeTagFor } from './autoCloseTag';

test('closes a tag with attributes', () => {
  assert.equal(closeTagFor('<theorem id="thm">'), '</theorem>');
  assert.equal(closeTagFor('  <figure src="a.png" id="fig:1">'), '</figure>');
});

test('closes a bare tag', () => {
  assert.equal(closeTagFor('<section>'), '</section>');
  assert.equal(closeTagFor('<m>'), '</m>');
});

test('does not close self-closing tags', () => {
  assert.equal(closeTagFor('<ref to="x" />'), undefined);
  assert.equal(closeTagFor('<toc/>'), undefined);
});

test('does not close on close tags, comments, or prose', () => {
  assert.equal(closeTagFor('</theorem>'), undefined);
  assert.equal(closeTagFor('<!-- a comment -->'), undefined);
  assert.equal(closeTagFor('1 < 2 and 3 > 2'), undefined);
  assert.equal(closeTagFor('inequality $a > b$'), undefined);
});

test('matches the innermost opening tag on a line with other content', () => {
  assert.equal(closeTagFor('text before <equation id="eq:1">'), '</equation>');
});
