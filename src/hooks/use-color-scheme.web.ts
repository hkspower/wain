/**
 * The web twin of use-color-scheme.ts — see the reasoning there.
 *
 * It used to defer to 'light' until hydration and then to the OS preference,
 * which was the static-rendering workaround Expo ships. With one fixed mode
 * there is nothing to re-calculate on the client: the server render and the
 * client render agree by construction, which is what that workaround existed
 * to achieve.
 */
export function useColorScheme(): 'dark' {
  return 'dark';
}
