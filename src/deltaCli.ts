import * as path from 'path';
import * as fs from 'fs';

/**
 * Thin abstraction over locating and invoking the external `delta` CLI.
 *
 * Nothing in here assumes anything about delta's internals beyond the documented
 * command surface (`delta build <file> -o <out> [--watch]`). Keep it that way so the
 * rest of the extension is insulated from delta version differences.
 */

export interface ResolvedDelta {
  /** The command or absolute path used to spawn delta. */
  command: string;
  /** True when resolved to a workspace-local install rather than PATH. */
  isLocal: boolean;
}

/** Path to a workspace-local `node_modules/.bin/delta` for the current platform. */
export function localBinPath(workspaceRoot: string): string {
  const bin = process.platform === 'win32' ? 'delta.cmd' : 'delta';
  return path.join(workspaceRoot, 'node_modules', '.bin', bin);
}

/**
 * Resolve which delta command to run.
 *
 * - An explicit `delta.path` setting (anything other than the bare default) is trusted as-is.
 * - Otherwise prefer a workspace-local `node_modules/.bin/delta`.
 * - Otherwise fall back to `delta` on the system PATH.
 *
 * `exists` is injectable for testing.
 */
export function resolveDeltaCommand(
  configuredPath: string,
  workspaceRoot: string | undefined,
  exists: (p: string) => boolean = fs.existsSync
): ResolvedDelta {
  const configured = (configuredPath ?? '').trim();
  if (configured && configured !== 'delta') {
    return { command: configured, isLocal: false };
  }
  if (workspaceRoot) {
    const local = localBinPath(workspaceRoot);
    if (exists(local)) {
      return { command: local, isLocal: true };
    }
  }
  return { command: 'delta', isLocal: false };
}

/** Output HTML path for a `.dlt` source: alongside the source, same basename. */
export function outputPathFor(dltPath: string): string {
  const dir = path.dirname(dltPath);
  const base = path.basename(dltPath, path.extname(dltPath));
  return path.join(dir, `${base}.html`);
}

/** Args for a one-shot build. */
export function buildArgs(dltPath: string, outPath: string): string[] {
  return ['build', dltPath, '-o', outPath];
}

/** Args for a long-lived watch build. */
export function buildWatchArgs(dltPath: string, outPath: string): string[] {
  return [...buildArgs(dltPath, outPath), '--watch'];
}
