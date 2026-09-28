import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Copied from the billing app (mobile/src/theme.ts) so both apps on the tablet look like one
 * family. Change it there first, then copy it here.
 *
 * The phone app's half of one design.
 *
 * These are the same values as the web app's CSS custom properties, written out again because
 * React Native has no stylesheet to share. When one side changes, change the other: the two apps
 * sit side by side on the same counter, and a shopkeeper who notices they are different colours
 * has been given something to wonder about instead of a tool.
 *
 * The old short names (bg, card, ink, soft, line, accent...) are kept so every screen keeps
 * compiling; they now point at the new palette.
 */
export const C = {
  /* paper and ink -- warm greys, not blue-greys */
  bg: '#f6f3ec',
  card: '#fffefb',
  well: '#f1ece2',
  paper: '#fffdf7',

  ink: '#17140f',
  ink700: '#3d3830',
  soft: '#6e675c',
  faint: '#938b7d',

  line: '#e4ded2',
  lineStrong: '#d3cabb',

  /* brand */
  accent: '#0d6847',
  accentDeep: '#0a5238',
  accentBright: '#117f57',
  accentInk: '#ffffff',
  accentWash: '#e7f1ec',
  accentEdge: '#bcd9cc',

  gold: '#a8721a',
  goldWash: '#fbf1dc',

  danger: '#a3291a',
  dangerWash: '#fceeec',
  dangerEdge: '#f0c4bd',
};

/** Two radii, as on the web. More than that and nothing looks intentional. */
export const R = { sm: 10, md: 14, lg: 20, pill: 999 };

export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/**
 * Android draws shadows from `elevation` and ignores the iOS shadow properties; iOS does the
 * reverse. Both are given so one definition covers the platform this ships on and the one it
 * might later.
 */
export function shadow(level: 1 | 2 | 3): ViewStyle {
  const spec = {
    1: { elevation: 1, radius: 3, opacity: 0.07, y: 1 },
    2: { elevation: 3, radius: 10, opacity: 0.1, y: 3 },
    3: { elevation: 10, radius: 22, opacity: 0.17, y: 8 },
  }[level];
  return Platform.select<ViewStyle>({
    android: { elevation: spec.elevation, shadowColor: C.ink },
    default: {
      shadowColor: C.ink,
      shadowOpacity: spec.opacity,
      shadowRadius: spec.radius,
      shadowOffset: { width: 0, height: spec.y },
    },
  }) as ViewStyle;
}

/**
 * Durations and springs, matched to the web's. Short on purpose: this screen is used a few
 * hundred times a day, and an animation the operator waits for becomes a tax within a week.
 */
export const T = { tap: 90, fast: 150, base: 220, slow: 320 };

export const SPRING = { damping: 16, stiffness: 220, mass: 0.7, useNativeDriver: true };

/**
 * Type scale. No custom face is loaded: a font asset would mean `expo-font`, a native module, and
 * therefore a fresh APK for what is a cosmetic gain. Hierarchy comes from weight and size, which
 * cost nothing and ship as an update.
 */
export const TYPE = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8, color: C.ink } as TextStyle,
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: C.ink } as TextStyle,
  section: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: C.ink } as TextStyle,
  body: { fontSize: 15, fontWeight: '400', color: C.ink700 } as TextStyle,
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: C.faint,
  } as TextStyle,
  hint: { fontSize: 12, color: C.soft, lineHeight: 18 } as TextStyle,
};
