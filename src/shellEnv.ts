import { execFile } from 'child_process';

/**
 * Desktop-launched editors (VS Code from a dock/menu) don't inherit the user's shell PATH, so
 * version managers like mise/asdf/nvm and Homebrew are invisible to spawned processes — `delta`
 * (and the `node` its shebang needs) then fail with ENOENT. We ask the user's login+interactive
 * shell for its PATH once and cache it; spawns use it so those tools resolve.
 *
 * Best-effort: on Windows, or if the probe fails/times out, we keep `process.env.PATH`.
 */

const MARK_START = '__DELTA_PATH_START__';
const MARK_END = '__DELTA_PATH_END__';

let cache: string | undefined;
let attempted = false;

/** Extract the PATH that the probe command printed between sentinels (ignoring shell noise). */
export function parseShellPath(stdout: string): string | undefined {
  const start = stdout.indexOf(MARK_START);
  const end = stdout.indexOf(MARK_END);
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  const value = stdout.slice(start + MARK_START.length, end);
  return value.length > 0 ? value : undefined;
}

/** Resolve (and cache) the login-shell PATH. Returns process.env.PATH as a fallback. */
export async function getShellPath(): Promise<string | undefined> {
  if (attempted) {
    return cache;
  }
  attempted = true;
  cache = process.env.PATH;
  if (process.platform === 'win32') {
    return cache;
  }

  const shell = process.env.SHELL || '/bin/bash';
  // `-ilc` runs an interactive login shell so rc files (where mise/asdf/nvm activate) are sourced.
  const command = `printf '%s%s%s' '${MARK_START}' "$PATH" '${MARK_END}'`;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        shell,
        ['-ilc', command],
        { timeout: 5000, windowsHide: true },
        (err, out) => (err ? reject(err) : resolve(out.toString()))
      );
      child.on('error', reject);
    });
    const parsed = parseShellPath(stdout);
    if (parsed) {
      cache = parsed;
    }
  } catch {
    // Keep the process.env.PATH fallback.
  }
  return cache;
}

/** Test hook: clear the memoized result. */
export function resetShellPathCache(): void {
  attempted = false;
  cache = undefined;
}
