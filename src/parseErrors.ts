/**
 * Tolerant parser for the delta compiler's console output.
 *
 * delta's exact diagnostic format is unconfirmed and may evolve, so this recognises a few
 * common shapes and degrades gracefully (an unrecognised error line still surfaces as a
 * location-less diagnostic). All line/column numbers are 1-based; 0 means "unknown".
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ParsedDiagnostic {
  /** Absolute or relative path reported by delta, if any. */
  file?: string;
  /** 1-based line; 0 when unknown. */
  line: number;
  /** 1-based column; 0 when unknown. */
  column: number;
  severity: DiagnosticSeverity;
  message: string;
}

function toSeverity(raw: string | undefined): DiagnosticSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'warning':
    case 'warn':
      return 'warning';
    case 'info':
    case 'note':
      return 'info';
    default:
      return 'error';
  }
}

// `file.dlt:12:5: error: message`  (column and severity optional)
const GNU_STYLE =
  /^\s*(?<file>(?:[A-Za-z]:)?[^:\n]+\.dlt):(?<line>\d+)(?::(?<col>\d+))?:\s*(?:(?<sev>error|warning|info|note)\s*:?\s*)?(?<msg>.+)$/i;

// delta's actual shape: `error: 6:11: unexpected close tag. (broken.dlt:6:11)`.
// Also matches `Error: message (file.dlt:12)`. The leading `line:col:` (when delta repeats the
// location inside the message) is consumed so it doesn't show up twice in the Problems panel.
const TRAILING_LOC =
  /^\s*(?<sev>error|warning|info|note)\s*:\s*(?:\d+:\d+:\s*)?(?<msg>.+?)\s*\((?<file>[^():\n]+\.dlt):(?<line>\d+)(?::(?<col>\d+))?\)\s*$/i;

// Bare `error: message` / `error - message` with no location.
const BARE = /^\s*(?<sev>error|warning)\b\s*[-:]?\s*(?<msg>.+)$/i;

/** Parse a chunk of delta output into structured diagnostics. */
export function parseDeltaOutput(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = stripAnsi(rawLine);
    if (!line.trim()) {
      continue;
    }

    const gnu = GNU_STYLE.exec(line);
    if (gnu?.groups) {
      const g = gnu.groups;
      diagnostics.push({
        file: g.file,
        line: Number(g.line) || 0,
        column: Number(g.col) || 0,
        severity: toSeverity(g.sev),
        message: g.msg.trim()
      });
      continue;
    }

    const trailing = TRAILING_LOC.exec(line);
    if (trailing?.groups) {
      const g = trailing.groups;
      diagnostics.push({
        file: g.file,
        line: Number(g.line) || 0,
        column: Number(g.col) || 0,
        severity: toSeverity(g.sev),
        message: g.msg.trim()
      });
      continue;
    }

    const bare = BARE.exec(line);
    if (bare?.groups) {
      diagnostics.push({
        line: 0,
        column: 0,
        severity: toSeverity(bare.groups.sev),
        message: bare.groups.msg.trim()
      });
    }
  }
  return dedupe(diagnostics);
}

/** delta can emit the same diagnostic on consecutive lines; collapse exact duplicates. */
function dedupe(items: ParsedDiagnostic[]): ParsedDiagnostic[] {
  const seen = new Set<string>();
  const out: ParsedDiagnostic[] = [];
  for (const d of items) {
    const key = `${d.severity}|${d.file ?? ''}|${d.line}|${d.column}|${d.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

/** Strip ANSI color codes that watch-mode CLIs commonly emit. */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}
