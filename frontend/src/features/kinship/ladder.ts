/*
 * The ladder under "What does this mean?": both lines down from the
 * shared ancestors, one row per generation. The first person's line is on the left, the
 * second's on the right; the two at the same generation are joined by what they are to each
 * other ("second cousins"), and the rest of the longer line says how far below it is.
 */

export type LadderRow = {
  left: string | null; // on the first person's line
  right: string | null; // on the second person's line
  pair: boolean; // the two at the same generation
  note: string | null; // the last row of the longer line: 'one generation below: "once removed"'
};

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function generations(count: number): string {
  return `${NUMBERS[count - 1] ?? count} generation${count === 1 ? "" : "s"}`;
}

/** The rows below the shared ancestors: `path[top]` is where the two lines meet. */
export function ladderRows(
  path: readonly string[],
  top: number,
  removed: string | null,
): LadderRow[] {
  const leftDepth = top;
  const rightDepth = path.length - 1 - top;
  const nearest = Math.min(leftDepth, rightDepth);
  const deepest = Math.max(leftDepth, rightDepth);
  const rows: LadderRow[] = [];
  for (let depth = 1; depth <= deepest; depth++) {
    const last = depth === deepest && deepest > nearest;
    rows.push({
      left: depth <= leftDepth ? (path[top - depth] ?? null) : null,
      right: depth <= rightDepth ? (path[top + depth] ?? null) : null,
      pair: depth === nearest,
      note: last
        ? `${generations(deepest - nearest)} below${removed ? `: “${removed}”` : ""}`
        : null,
    });
  }
  return rows;
}
