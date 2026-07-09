import * as vscode from 'vscode';
import { BuildManager, BuildResult } from './buildManager';
import { DeltaDiagnostics } from './diagnostics';
import { PreviewServer } from './previewServer';
import { readConfig } from './config';
import { closeTagFor } from './autoCloseTag';

const LANGUAGE_ID = 'delta';

export function activate(context: vscode.ExtensionContext): void {
  const builds = new BuildManager();
  const diagnostics = new DeltaDiagnostics();
  const preview = new PreviewServer();
  const autoOpened = new Set<string>();
  let previewActive = false;
  // The .dlt most recently saved while a preview is open; the preview follows it once rebuilt.
  let followDoc: vscode.TextDocument | undefined;

  context.subscriptions.push(builds, diagnostics, preview);

  // Feed every build cycle into the Problems panel and refresh any open preview.
  context.subscriptions.push(
    builds.onBuild((result: BuildResult) => {
      diagnostics.update(result.sourceUris, result.baseDir, result.output);
      for (const outputPath of result.outputPaths) {
        preview.reload(outputPath);
      }

      // Make the preview follow the document the user just saved: once its output is rebuilt,
      // tell the preview to switch to that page (a no-op if it's already showing it). An
      // `<include>` partial has no page of its own — its edit surfaces inside another page —
      // so we don't navigate; the live-reload above refreshes whatever page is showing.
      if (followDoc) {
        const followOutput = builds.followTargetFor(followDoc);
        if (!followOutput) {
          followDoc = undefined;
        } else if (result.outputPaths.includes(followOutput)) {
          preview.navigate(followOutput);
          followDoc = undefined;
        }
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
      void builds.ensureWatching(doc);
    }
  };
  vscode.workspace.textDocuments.forEach(maybeWatch);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(maybeWatch),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      // Remember the saved doc so the preview can follow it after the rebuild lands.
      if (doc.languageId === LANGUAGE_ID && previewActive) {
        followDoc = doc;
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === LANGUAGE_ID) {
        builds.release(doc.uri);
        diagnostics.clear(doc.uri);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => autoCloseTag(event))
  );

  /** Insert a matching close tag when an opening tag is completed with `>`. */
  function autoCloseTag(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
      return;
    }
    if (event.document.languageId !== LANGUAGE_ID) {
      return;
    }
    // Don't fight undo/redo, paste, or multi-cursor edits.
    if (
      event.reason === vscode.TextDocumentChangeReason.Undo ||
      event.reason === vscode.TextDocumentChangeReason.Redo ||
      event.contentChanges.length !== 1
    ) {
      return;
    }
    const change = event.contentChanges[0];
    if (change.text !== '>' || !readConfig(event.document.uri).autoCloseTags) {
      return;
    }

    const cursor = change.range.start.translate(0, change.text.length);
    const lineText = event.document.lineAt(change.range.start.line).text;
    const closeTag = closeTagFor(lineText.slice(0, cursor.character));
    if (!closeTag) {
      return;
    }
    // Don't double-close if the matching tag already sits right after the cursor.
    if (lineText.slice(cursor.character).startsWith(closeTag)) {
      return;
    }
    void editor
      .edit((b) => b.insert(cursor, closeTag), { undoStopBefore: false, undoStopAfter: false })
      .then((ok) => {
        if (ok) {
          // Leave the cursor between the tags: <theorem …>|</theorem>
          editor.selection = new vscode.Selection(cursor, cursor);
        }
      });
  }

  async function openPreviewFor(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const outputPath = await builds.ensureWatching(doc);
    const url = await preview.preview(outputPath);
    previewActive = true;
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
      void builds.restart(doc);
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
