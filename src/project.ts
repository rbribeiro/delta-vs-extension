import * as path from 'path';
import * as fs from 'fs';

/**
 * Helpers for delta's multi-file project mode.
 *
 * A `project.toml` lists its source documents in an `inputs` array of `.dlt` paths (relative to
 * the toml). Building it (`delta build project.toml -o <dir>`) emits one `<basename>.html` per
 * input into the output directory. These helpers are pure (fs/IO is injectable) so they can be
 * unit-tested without `vscode`.
 */

export interface ProjectInfo {
  /** Absolute path to the project.toml. */
  tomlPath: string;
  /** Directory containing the project.toml (delta resolves inputs relative to here). */
  projectDir: string;
  /** Absolute paths of the project's input .dlt files. */
  inputs: string[];
  /** The toml's `out` key (raw, relative to projectDir), or undefined when absent. */
  out?: string;
}

/** Extract the `inputs = [...]` string entries from a project.toml's contents. */
export function parseInputs(toml: string): string[] {
  const arrayMatch = /inputs\s*=\s*\[([\s\S]*?)\]/.exec(toml);
  if (!arrayMatch) {
    return [];
  }
  const entries: string[] = [];
  const stringRe = /(["'])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = stringRe.exec(arrayMatch[1])) !== null) {
    entries.push(m[2]);
  }
  return entries;
}

/**
 * Extract the top-level `out = "..."` string value from a project.toml (delta's project
 * output directory). Returns undefined when the key is absent so callers can fall back to the
 * extension's own setting. A trailing `# comment` after the value is ignored.
 */
export function parseOut(toml: string): string | undefined {
  const m = /^[ \t]*out[ \t]*=[ \t]*(["'])(.*?)\1/m.exec(toml);
  return m ? m[2] : undefined;
}

/**
 * Walk up from `startDir` (bounded by `workspaceRoot`) looking for a `project.toml`.
 * Returns its absolute path, or undefined if none is found within the workspace.
 */
export function findProjectToml(
  startDir: string,
  workspaceRoot: string,
  exists: (p: string) => boolean = fs.existsSync
): string | undefined {
  const root = path.resolve(workspaceRoot);
  let dir = path.resolve(startDir);
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined; // startDir is outside the workspace
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, 'project.toml');
    if (exists(candidate)) {
      return candidate;
    }
    if (dir === root) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/** Read a project.toml and resolve its inputs to absolute paths. */
export function loadProject(
  tomlPath: string,
  read: (p: string) => string = (p) => fs.readFileSync(p, 'utf8')
): ProjectInfo {
  const projectDir = path.dirname(tomlPath);
  let inputs: string[] = [];
  let out: string | undefined;
  try {
    const toml = read(tomlPath);
    inputs = parseInputs(toml).map((rel) => path.resolve(projectDir, rel));
    out = parseOut(toml);
  } catch {
    inputs = [];
  }
  return { tomlPath, projectDir, inputs, out };
}

/** True when `dltPath` is one of the project's inputs. */
export function projectIncludes(info: ProjectInfo, dltPath: string): boolean {
  const target = path.resolve(dltPath);
  return info.inputs.some((p) => path.resolve(p) === target);
}
