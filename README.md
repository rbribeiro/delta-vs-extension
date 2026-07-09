# Delta Lang for VS Code

VS Code support for the [delta-lang](https://github.com/rbribeiro/delta) markup language
(`.dlt`) — a LaTeX-inspired XML format that compiles a single document into a standalone,
interactive HTML file.

## Features

- **Syntax highlighting** for `.dlt`: XML tags plus embedded LaTeX math (`$…$`, `$$…$$`,
  and the body of `<equation>` / `<m>` elements).
- **Build on save** — opening a `.dlt` starts a `delta build … --watch` process that
  recompiles the HTML (written next to the source) on every save.
- **Live preview** — `Delta: Open Preview` serves the compiled HTML on a local port and
  opens it in VS Code's Simple Browser, auto-refreshing on each rebuild.
- **Diagnostics** — compiler errors surface in the Problems panel.
- **Snippets** for common tags (`document`, `section`, `theorem`, `equation`, …).

## Requirements

The [`delta` CLI](https://github.com/rbribeiro/delta) must be installed:

```
npm i -g delta-lang
```

The extension looks for a workspace-local `node_modules/.bin/delta` first, then falls back
to `delta` on your PATH. Override with the `delta.path` setting.

## Install from source

The extension isn't on the Marketplace yet — build a `.vsix` from this repo and install it
into VS Code:

```
npm install
npx @vscode/vsce package                        # → delta-lang-0.0.1.vsix
code --install-extension delta-lang-0.0.1.vsix
```

`vsce package` runs the production bundle automatically. Then reload VS Code (Command
Palette → *Developer: Reload Window*). You can also install the `.vsix` from the Extensions
view: the `⋯` menu → **Install from VSIX…**.

> Adjust the filename to match the version in [package.json](package.json) if it differs.
> `code --install-extension` needs VS Code's `code` command on your PATH (in VS Code, run
> *Shell Command: Install 'code' command in PATH* once).

To hack on the extension rather than install it, see [Development](#development) below.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `delta.path` | `delta` | Path/command for the delta CLI. |
| `delta.buildOnSave` | `true` | Auto-start the watch build when a `.dlt` opens. |
| `delta.preview.port` | `0` | Preview server port (`0` = auto). |
| `delta.preview.openOnBuild` | `false` | Open the preview on first build. |

## Development

```
npm install
npm run compile      # or: npm run watch
```

Press **F5** to launch the Extension Development Host. See [CLAUDE.md](CLAUDE.md) for
architecture notes.
