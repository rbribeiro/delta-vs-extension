import * as vscode from 'vscode';
import { BuildManager, BuildResult } from './buildManager';
import { DeltaDiagnostics } from './diagnostics';
import { PreviewServer } from './previewServer';
import { readConfig } from './config';

const LANGUAGE_ID = 'delta';

export function activate(context: vscode.ExtensionContext): void {
  const builds = new BuildManager();
  const diagnostics = new DeltaDiagnostics();
  const preview = new PreviewServer();
  const autoOpened = new Set<string>();

  context.subscriptions.push(builds, diagnostics, preview);

  // Feed every build cycle into the Problems panel and refresh any open preview.
  context.subscriptions.push(
    builds.onBuild((result: BuildResult) => {
      diagnostics.update(result.sourceUris, result.baseDir, result.output);
      for (const outputPath of result.outputPaths) {
        preview.reload(outputPath);
      }

      if (result.success && !autoOpened.has(result.key) && readConfig(result.sourceUris[0]).openOnBuild) {
        autoOpened.add(result.key);
        const active = activeDeltaDocument();
        if (active) {
          void openPreviewFor(active.uri);
        }
      }
    })
  );

  // Auto-start the watcher when a .dlt document is opened (if enabled).
  const maybeWatch = (doc: vscode.TextDocument) => {
    if (doc.languageId === LANGUAGE_ID && readConfig(doc.uri).buildOnSave) {
      builds.ensureWatching(doc);
    }
  };
  vscode.workspace.textDocuments.forEach(maybeWatch);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(maybeWatch),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === LANGUAGE_ID) {
        builds.release(doc.uri);
        diagnostics.clear(doc.uri);
      }
    })
  );

  async function openPreviewFor(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const outputPath = builds.ensureWatching(doc);
    const url = await preview.preview(outputPath);
    await vscode.commands.executeCommand('simpleBrowser.show', url);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('delta.openPreview', async () => {
      const doc = activeDeltaDocument();
      if (!doc) {
        void vscode.window.showInformationMessage('Open a .dlt file to preview it.');
        return;
      }
      await openPreviewFor(doc.uri);
    }),
    vscode.commands.registerCommand('delta.restartWatcher', () => {
      const doc = activeDeltaDocument();
      if (!doc) {
        void vscode.window.showInformationMessage('Open a .dlt file first.');
        return;
      }
      builds.restart(doc);
    })
  );
}

export function deactivate(): void {
  // Disposables registered on the context handle teardown.
}

function activeDeltaDocument(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  return doc?.languageId === LANGUAGE_ID ? doc : undefined;
}
