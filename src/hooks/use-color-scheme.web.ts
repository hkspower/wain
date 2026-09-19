import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * Supports three theme modes: light, dark, and dark-white (neutral grays).
 */
export function useColorScheme() {
  const [colorScheme, setColorScheme] = useState<'light' | 'dark' | 'dark-white'>('dark');
  const [hasHydrated, setHasHydrated] = useState(false);
  const systemScheme = useRNColorScheme();

  useEffect(() => {
    // Load theme preference from localStorage
    const stored = localStorage.getItem('sporta_theme');
    if (stored && ['light', 'dark', 'dark-white'].includes(stored)) {
      setColorScheme(stored as 'light' | 'dark' | 'dark-white');
    } else if (systemScheme && systemScheme !== 'dark' && systemScheme !== 'light') {
      // Fall back to system preference if stored is not set
      setColorScheme(systemScheme === 'light' ? 'light' : 'dark');
    } else if (systemScheme) {
      setColorScheme(systemScheme);
    }
    setHydrated(true);
  }, []);

  if (!hasHydrated) {
    return 'dark';
  }

  return colorScheme;
}
