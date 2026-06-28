'use strict';

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Recursively collect files matching a predicate. */
function collect(dir, predicate, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, predicate, acc);
    } else if (predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

const testEntries = fs.existsSync('src')
  ? collect('src', (f) => f.endsWith('.test.ts'))
  : [];

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

/** Tests are bundled separately so `node --test` can run them; they must not import `vscode`. */
const testConfig = {
  entryPoints: testEntries,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outdir: 'dist/test',
  external: ['vscode', 'node:test', 'node:assert'],
  sourcemap: !production,
  logLevel: 'info'
};

async function main() {
  const configs = [extensionConfig];
  if (testEntries.length > 0) {
    configs.push(testConfig);
  }

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[esbuild] watching...');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
