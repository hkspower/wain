/**
 * The colours every screen draws with. One mode — see use-color-scheme.ts.
 *
 * The 'unspecified' fallback that used to sit here is gone because tsc said
 * so: with the hook returning 'dark' the comparison has no overlap, which is
 * the compiler pointing at a branch that can no longer run. Left in, it would
 * have read as though light were still reachable from here.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  return Colors[useColorScheme()];
}
