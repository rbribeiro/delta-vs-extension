import * as vscode from 'vscode';

export interface DeltaConfig {
  /** Path or command for the delta CLI. */
  path: string;
  /** Auto-start the watch build when a .dlt opens. */
  buildOnSave: boolean;
  /** Preview server port (0 = auto-pick). */
  previewPort: number;
  /** Open the preview automatically on first build. */
  openOnBuild: boolean;
  /** Build via an ancestor project.toml when one is found. */
  projectEnabled: boolean;
  /** Output directory for project builds, relative to the project.toml. */
  projectOutputDir: string;
}

export function readConfig(scope?: vscode.Uri): DeltaConfig {
  const c = vscode.workspace.getConfiguration('delta', scope ?? null);
  return {
    path: c.get<string>('path', 'delta'),
    buildOnSave: c.get<boolean>('buildOnSave', true),
    previewPort: c.get<number>('preview.port', 0),
    openOnBuild: c.get<boolean>('preview.openOnBuild', false),
    projectEnabled: c.get<boolean>('project.enabled', true),
    projectOutputDir: c.get<string>('project.outputDirectory', 'out')
  };
}
