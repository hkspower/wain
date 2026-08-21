/**
 * Sporta theme — brand ember on charcoal, in light and dark mode.
 *
 * The dark surfaces are not free choices. #2B3138 (ink.silver) and #363D45
 * (ink.steel) are the two greys the web storefront measured for WCAG AA behind
 * white text, and they are repeated here so a customer who uses both does not
 * meet two different shops. Same for the ember pair: #E0561C is the brand
 * orange, #FF7B17 the lift used on dark ground where the darker orange loses
 * contrast.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#14161a',
    background: '#ffffff',
    backgroundElement: '#f5f2ee',
    backgroundSelected: '#fdeee4',
    textSecondary: '#5c6570',
    tint: '#c8490f',
    tintSoft: '#fdeee4',
    sand: '#8a6a4f',
    sandSoft: '#f6efe6',
    border: '#e6e1da',
    ink: '#14161a',
    inkSilver: '#2b3138',
    inkSteel: '#363d45',
    onInk: '#ffffff',
    success: '#1c7a4a',
    danger: '#b3261e',
  },
  dark: {
    text: '#f6f4f1',
    background: '#14161a',
    backgroundElement: '#2b3138',
    backgroundSelected: '#3a2417',
    textSecondary: '#a8b0b9',
    tint: '#ff7b17',
    tintSoft: '#3a2417',
    sand: '#d9a47e',
    sandSoft: '#2a231d',
    border: '#363d45',
    ink: '#0d0f12',
    inkSilver: '#2b3138',
    inkSteel: '#363d45',
    onInk: '#ffffff',
    success: '#5cc98d',
    danger: '#ff8a80',
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

/**
 * Minimum tap target. 44 is Apple's number and Android's is 48dp; every
 * pressable in this app is sized against this rather than against its text.
 */
export const TapTarget = 48;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
