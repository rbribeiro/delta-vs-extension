import { test } from 'node:test';
import * as assert from 'node:assert';
import { injectLivereload } from './previewServer';

test('injectLivereload inserts the client before </body>, keyed to dir+file', () => {
  const out = injectLivereload('<html><body>hi</body></html>', 'abc123def456', 'ch2.html');
  assert.match(out, /EventSource/);
  assert.ok(out.includes('"abc123def456"'), 'embeds the directory key');
  assert.ok(out.includes('"ch2.html"'), 'embeds the file name');
  assert.match(out, /navigate:/, 'handles navigate events');
  assert.ok(out.indexOf('<script') < out.indexOf('</body>'), 'sits before </body>');
});

test('injectLivereload appends when there is no </body>', () => {
  const out = injectLivereload('<p>partial</p>', 'k', 'a.html');
  assert.ok(out.startsWith('<p>partial</p>'));
  assert.ok(out.includes('"a.html"'));
});

test('injectLivereload preserves scroll across reloads', () => {
  const out = injectLivereload('<body></body>', 'k', 'a.html');
  assert.match(out, /sessionStorage/);
  assert.match(out, /scrollTo/);
});

test('injectLivereload embeds names safely (JSON-encoded)', () => {
  const out = injectLivereload('<body></body>', 'k', 'a b".html');
  // a malicious/odd file name must not break out of the JS string literal
  assert.ok(out.includes(JSON.stringify('a b".html')));
});
