import * as vscode from 'vscode';
import * as path from 'path';
import { parseDeltaOutput, ParsedDiagnostic, DiagnosticSeverity } from './parseErrors';

/**
 * Publishes delta compiler errors to the Problems panel.
 *
 * Diagnostics for a build are attributed to the file delta names (falling back to the source
 * document when no location is given), and cleared on the next clean build.
 */
export class DeltaDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('delta');
  }

  /**
   * Update diagnostics for a build.
   *
   * `sourceUris` are all documents the build is responsible for; each is cleared first so a clean
   * build removes stale squiggles (across every chapter of a project). Relative paths reported by
   * delta resolve against `baseDir` (delta's working directory); diagnostics with no location fall
   * back to the first source document.
   */
  update(sourceUris: vscode.Uri[], baseDir: string, output: string): void {
    const parsed = parseDeltaOutput(output);
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const uri of sourceUris) {
      byFile.set(uri.toString(), []);
    }

    const fallback = sourceUris[0];
    for (const item of parsed) {
      const uri = this.resolveUri(item, baseDir, fallback);
      const list = byFile.get(uri.toString()) ?? [];
      list.push(toDiagnostic(item));
      byFile.set(uri.toString(), list);
    }

    for (const [key, list] of byFile) {
      this.collection.set(vscode.Uri.parse(key), list);
    }
  }

  private resolveUri(
    item: ParsedDiagnostic,
    baseDir: string,
    fallback: vscode.Uri
  ): vscode.Uri {
    if (!item.file) {
      return fallback;
    }
    if (path.isAbsolute(item.file)) {
      return vscode.Uri.file(item.file);
    }
    return vscode.Uri.file(path.resolve(baseDir, item.file));
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.collection.delete(uri);
    } else {
      this.collection.clear();
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toSeverity(s: DiagnosticSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function toDiagnostic(item: ParsedDiagnostic): vscode.Diagnostic {
  // delta reports 1-based positions; VS Code ranges are 0-based. A 0 means "unknown".
  const line = Math.max(0, item.line - 1);
  const col = Math.max(0, item.column - 1);
  // Highlight to end of line when we only have a start position.
  const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);
  const diagnostic = new vscode.Diagnostic(range, item.message, toSeverity(item.severity));
  diagnostic.source = 'delta';
  return diagnostic;
}
