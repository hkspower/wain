import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * False during the server render and the first client render on web; true
 * afterwards. Always true on native, where there is no server render to agree
 * with and a one-frame placeholder would be a flash for nothing.
 *
 * WHAT IT IS FOR. The static export prerenders /product/[slug] and
 * /order/[ref] with no parameters, because at build time there is no slug and
 * no order number. The browser is then handed that parameter-less HTML for a
 * real URL, the client renders the actual product, the two do not match, and
 * React throws #418 and re-renders the whole subtree from scratch.
 *
 * The page ended up correct, which is why this went unnoticed — the cost is a
 * console error on every product a customer opens and a discarded first paint.
 * Rendering the same placeholder on both sides for one frame is what makes
 * the two agree; the content arrives immediately after.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(Platform.OS !== 'web');
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
