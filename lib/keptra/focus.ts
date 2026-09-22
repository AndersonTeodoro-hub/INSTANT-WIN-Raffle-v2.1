/**
 * SPEC-BLOCO-03 V5 (B1): the signing sheet holds the focus while it is open.
 *
 * Given the sheet's controls in tab order and what has the focus, where Tab (or
 * Shift+Tab) must go instead of where the browser would take it: past the last
 * control back to the first, before the first round to the last, and from
 * anywhere outside the sheet back into it. null leaves the browser to move on
 * inside the sheet.
 */
export function trapTarget<T>(controls: readonly T[], active: T | null, backwards: boolean): T | null {
  if (controls.length === 0) return null;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const at = active === null ? -1 : controls.indexOf(active);
  if (at === -1) return backwards ? last : first;
  if (backwards && at === 0) return last;
  if (!backwards && at === controls.length - 1) return first;
  return null;
}
