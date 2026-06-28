import { test } from 'node:test';
import * as assert from 'node:assert';
import { parseShellPath } from './shellEnv';

test('parseShellPath extracts PATH between sentinels, ignoring shell noise', () => {
  const noisy =
    'bash: cannot set terminal process group\n' +
    '__DELTA_PATH_START__/home/u/.local/share/mise/shims:/usr/bin:/bin__DELTA_PATH_END__';
  assert.equal(parseShellPath(noisy), '/home/u/.local/share/mise/shims:/usr/bin:/bin');
});

test('parseShellPath returns undefined when sentinels are missing', () => {
  assert.equal(parseShellPath('/usr/bin:/bin'), undefined);
});

test('parseShellPath returns undefined for an empty PATH', () => {
  assert.equal(parseShellPath('__DELTA_PATH_START____DELTA_PATH_END__'), undefined);
});
