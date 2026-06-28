import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { readConfig } from './config';
import { resolveDeltaCommand, outputPathFor, buildWatchArgs } from './deltaCli';
import { findProjectToml, loadProject, projectIncludes } from './project';

export interface BuildResult {
  /** Stable key of the watcher that produced this result (per-file or per-project). */
  key: string;
  /** True for a project (project.toml) build. */
  isProject: boolean;
  /** Directory delta runs in; relative diagnostic paths resolve against it. */
  baseDir: string;
  /** Source documents this build is responsible for (for clearing stale diagnostics). */
  sourceUris: vscode.Uri[];
  /** Compiled HTML outputs to refresh in any open preview. */
  outputPaths: string[];
  /** False when delta reported an error this cycle. */
  success: boolean;
  /** Raw output accumulated for the cycle, for diagnostics parsing. */
  output: string;
}

/**
 * What to compile and where. Unifies single-file builds (`delta build doc.dlt -o doc.html`) and
 * project builds (`delta build project.toml -o out-dir`), which share one watcher across all the
 * project's documents.
 */
interface BuildTarget {
  key: string;
  /** The .dlt or project.toml passed to delta. */
  inputPath: string;
  /** The `-o` argument: an HTML file (single) or an output directory (project). */
  outputArg: string;
  isProject: boolean;
  cwd: string;
  sourceUris: vscode.Uri[];
  /** Map a source .dlt to its compiled HTML path. */
  outputHtmlFor: (dltPath: string) => string;
}

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  target: BuildTarget;
  /** Open documents referencing this process; the watcher stops when none remain. */
  refs: Set<string>;
  buffer: string;
  settleTimer?: NodeJS.Timeout;
  alive: boolean;
}

const SETTLE_MS = 250;

/**
 * Owns long-lived `delta build … --watch` child processes — one per single `.dlt`, or one shared
 * per `project.toml`. delta's watcher already tracks the full dependency graph (includes, theme
 * CSS, imports, bibliography, images, project.toml), so the extension never reimplements it.
 */
export class BuildManager implements vscode.Disposable {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly _onBuild = new vscode.EventEmitter<BuildResult>();
  readonly onBuild = this._onBuild.event;
  private readonly channel: vscode.OutputChannel;
  private warnedMissingBinary = false;

  constructor() {
    this.channel = vscode.window.createOutputChannel('Delta');
  }

  /** Compiled HTML path a document maps to, without starting anything. */
  outputPathFor(doc: vscode.TextDocument): string {
    return this.resolveTarget(doc).outputHtmlFor(doc.uri.fsPath);
  }

  /** Ensure a watch build is running for the document; returns its output HTML path. */
  ensureWatching(doc: vscode.TextDocument): string {
    const target = this.resolveTarget(doc);
    let proc = this.processes.get(target.key);
    if (!proc?.alive) {
      proc = this.startWatch(target);
      this.processes.set(target.key, proc);
    }
    proc.refs.add(doc.uri.toString());
    return target.outputHtmlFor(doc.uri.fsPath);
  }

  /** Restart the watcher for a document's target, preserving its references. */
  restart(doc: vscode.TextDocument): string {
    const target = this.resolveTarget(doc);
    const existing = this.processes.get(target.key);
    const refs = existing ? new Set(existing.refs) : new Set<string>();
    this.stopByKey(target.key);
    const proc = this.startWatch(target);
    proc.refs = refs;
    proc.refs.add(doc.uri.toString());
    this.processes.set(target.key, proc);
    return target.outputHtmlFor(doc.uri.fsPath);
  }

  /** Release a document; stops its watcher only when no other open docs reference it. */
  release(uri: vscode.Uri): void {
    const key = uri.toString();
    for (const [procKey, proc] of this.processes) {
      if (proc.refs.delete(key) && proc.refs.size === 0) {
        this.stopByKey(procKey);
      }
    }
  }

  private stopByKey(key: string): void {
    const proc = this.processes.get(key);
    if (!proc) {
      return;
    }
    proc.alive = false;
    if (proc.settleTimer) {
      clearTimeout(proc.settleTimer);
    }
    proc.child.removeAllListeners();
    proc.child.kill();
    this.processes.delete(key);
  }

  /** Decide whether a document builds standalone or as part of a project. */
  private resolveTarget(doc: vscode.TextDocument): BuildTarget {
    const dltPath = doc.uri.fsPath;
    const config = readConfig(doc.uri);
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;

    if (config.projectEnabled && workspaceRoot) {
      const tomlPath = findProjectToml(path.dirname(dltPath), workspaceRoot);
      if (tomlPath) {
        const info = loadProject(tomlPath);
        if (projectIncludes(info, dltPath)) {
          const outputDir = path.resolve(info.projectDir, config.projectOutputDir);
          return {
            key: `project:${tomlPath}`,
            inputPath: tomlPath,
            outputArg: outputDir,
            isProject: true,
            cwd: info.projectDir,
            sourceUris: info.inputs.map((p) => vscode.Uri.file(p)),
            outputHtmlFor: (p) => path.join(outputDir, `${path.basename(p, path.extname(p))}.html`)
          };
        }
      }
    }

    const outputPath = outputPathFor(dltPath);
    return {
      key: `file:${dltPath}`,
      inputPath: dltPath,
      outputArg: outputPath,
      isProject: false,
      cwd: path.dirname(dltPath),
      sourceUris: [doc.uri],
      outputHtmlFor: () => outputPath
    };
  }

  private startWatch(target: BuildTarget): ManagedProcess {
    const config = readConfig(vscode.Uri.file(target.inputPath));
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(target.inputPath)
    )?.uri.fsPath;
    const resolved = resolveDeltaCommand(config.path, workspaceRoot);
    const args = buildWatchArgs(target.inputPath, target.outputArg);

    this.channel.appendLine(`$ ${resolved.command} ${args.join(' ')}`);
    const child = spawn(resolved.command, args, { cwd: target.cwd, shell: false });
    const proc: ManagedProcess = { child, target, refs: new Set(), buffer: '', alive: true };

    const onData = (data: Buffer) => {
      const text = data.toString();
      this.channel.append(text);
      proc.buffer += text;
      this.scheduleSettle(proc);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      proc.alive = false;
      this.handleSpawnError(err as NodeJS.ErrnoException, resolved.command);
      this._onBuild.fire(this.resultFor(target, false, `error: ${err.message}`));
    });

    child.on('exit', (code) => {
      proc.alive = false;
      this.channel.appendLine(`\n[delta watch exited: ${code ?? 'signal'}]`);
    });

    return proc;
  }

  /** Treat a quiet gap in output as the end of a build cycle, then emit a result. */
  private scheduleSettle(proc: ManagedProcess): void {
    if (proc.settleTimer) {
      clearTimeout(proc.settleTimer);
    }
    proc.settleTimer = setTimeout(() => {
      const output = proc.buffer;
      proc.buffer = '';
      const success = !/\berror\b/i.test(output);
      this._onBuild.fire(this.resultFor(proc.target, success, output));
    }, SETTLE_MS);
  }

  private resultFor(target: BuildTarget, success: boolean, output: string): BuildResult {
    return {
      key: target.key,
      isProject: target.isProject,
      baseDir: target.cwd,
      sourceUris: target.sourceUris,
      outputPaths: target.sourceUris.map((u) => target.outputHtmlFor(u.fsPath)),
      success,
      output
    };
  }

  private handleSpawnError(err: NodeJS.ErrnoException, command: string): void {
    this.channel.appendLine(`\n[delta failed to start: ${err.message}]`);
    if (err.code === 'ENOENT' && !this.warnedMissingBinary) {
      this.warnedMissingBinary = true;
      void vscode.window
        .showErrorMessage(
          `Could not run the delta CLI ('${command}'). Install it with 'npm i -g delta-lang' or set 'delta.path'.`,
          'Open Settings'
        )
        .then((choice) => {
          if (choice === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'delta.path');
          }
        });
    }
  }

  dispose(): void {
    for (const key of [...this.processes.keys()]) {
      this.stopByKey(key);
    }
    this._onBuild.dispose();
    this.channel.dispose();
  }
}
