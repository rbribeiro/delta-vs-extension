/**
 * Pure helper for tag auto-closing. Given the text on a line up to and including a just-typed
 * `>`, returns the matching close tag (e.g. `</theorem>`), or undefined when no close tag should
 * be inserted. Kept free of `vscode` so it stays unit-testable; the editor wiring lives in
 * extension.ts.
 */

// An opening tag ending exactly at the cursor: `<name`, optional attributes, then `>`.
// The negative lookbehind rejects self-closing tags (`… />`); a leading letter requirement
// rejects close tags (`</name>`), comments (`<!-- -->`) and CDATA (`]]>`).
const OPENING_TAG = /<([a-zA-Z][-_:.a-zA-Z0-9]*)(?:\s+[^<>]*?)?(?<!\/)>$/;

export function closeTagFor(textBeforeCursor: string): string | undefined {
  const match = OPENING_TAG.exec(textBeforeCursor);
  return match ? `</${match[1]}>` : undefined;
}
