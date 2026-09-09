/**
 * ONE MODE, NOT TWO — 2026-09-09, on the owner's instruction.
 *
 * This used to re-export React Native's useColorScheme, so the app was light
 * on one phone and dark on the next, following whatever the OS was set to.
 * The website has never worked that way: it ships black, dark silver and
 * orange, and as of today its light theme is unreachable. A customer who uses
 * both was meeting two different shops.
 *
 * THE HOOK IS KEPT rather than deleted, and every call site still goes through
 * it, because that makes this one line the whole switch. Reverting to the OS
 * preference — or offering a real setting — is an edit to this file and its
 * .web.ts twin, not a hunt through the screens. `Colors.light` in
 * constants/theme.ts is kept for the same reason.
 *
 * app.json carries `userInterfaceStyle: "dark"` so the NATIVE chrome agrees:
 * the status bar, the keyboard and the system share sheet are drawn by the OS
 * from that value and this hook cannot reach them.
 */
export function useColorScheme(): 'dark' {
  return 'dark';
}
