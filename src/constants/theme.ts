/**
 * Wain theme — brand teal + sand, in light and dark mode.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#ffffff',
    backgroundElement: '#f1f5f9',
    backgroundSelected: '#d7f2ec',
    textSecondary: '#64748b',
    tint: '#217972',
    tintSoft: '#d7f2ec',
    sand: '#ce742a',
    sandSoft: '#faf0db',
    border: '#e2e8f0',
  },
  dark: {
    text: '#f8fafc',
    background: '#0b1220',
    backgroundElement: '#1a2332',
    backgroundSelected: '#1c4e4c',
    textSecondary: '#94a3b8',
    tint: '#4db3a8',
    tintSoft: '#12312f',
    sand: '#e3a556',
    sandSoft: '#332412',
    border: '#243044',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
