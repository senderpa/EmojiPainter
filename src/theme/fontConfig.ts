import { Platform, StyleSheet, TextStyle } from 'react-native';

// The licensed project font is supplied separately from this public source export.
// Use the platform system font in a clean clone instead of referencing a missing file.
export const BASE_FONT_FAMILY = Platform.select({ ios: 'System', android: 'sans-serif' }) ?? 'sans-serif';
const LEGACY_FONT_FAMILY = 'vrtlfinale1';

export const FONT_VARIANTS = {
  regular: BASE_FONT_FAMILY,
  medium: BASE_FONT_FAMILY,
  semibold: BASE_FONT_FAMILY,
  bold: BASE_FONT_FAMILY,
  extrabold: BASE_FONT_FAMILY
} as const;

const WEIGHT_TO_VARIANT: Record<string, keyof typeof FONT_VARIANTS> = {
  normal: 'regular',
  '100': 'regular',
  '200': 'regular',
  '300': 'regular',
  '400': 'regular',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  '800': 'extrabold',
  '900': 'extrabold',
  bold: 'bold'
};

export const FONT_ASSETS: Record<string, number> = {};

const resolveWeightKey = (weight?: TextStyle['fontWeight']): keyof typeof FONT_VARIANTS => {
  if (!weight) {
    return 'regular';
  }

  const normalized = typeof weight === 'number' ? weight.toString() : `${weight}`.toLowerCase();
  return WEIGHT_TO_VARIANT[normalized] ?? 'regular';
};

export const resolveFontFamily = (weight?: TextStyle['fontWeight']): string =>
  FONT_VARIANTS[resolveWeightKey(weight)];

export const normalizeTextStyle = <T extends TextStyle | undefined | null>(style: T): T => {
  if (!style) {
    return style;
  }

  const { fontWeight, fontFamily, ...rest } = style as TextStyle;
  const usesProjectFont = fontFamily?.startsWith(LEGACY_FONT_FAMILY) || fontFamily?.startsWith('vrtlfinal');
  const next: TextStyle = {
    ...rest,
    fontFamily: usesProjectFont ? BASE_FONT_FAMILY : (fontFamily ?? resolveFontFamily(fontWeight)),
    fontWeight
  };

  return next as T;
};

const normalizeStyleDefinition = (entry: unknown): unknown => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  const textStyle = entry as TextStyle;
  const usesProjectFont = textStyle.fontFamily?.startsWith(LEGACY_FONT_FAMILY)
    || textStyle.fontFamily?.startsWith('vrtlfinal');
  if ((!('fontWeight' in entry) || !textStyle.fontWeight) && !usesProjectFont) {
    return entry;
  }

  return normalizeTextStyle(entry as TextStyle);
};

const originalCreate = StyleSheet.create;

StyleSheet.create = function createWithFontNormalization<T extends StyleSheet.NamedStyles<T>>(
  styles: T
): T {
  const transformedEntries = Object.entries(styles).map(([key, value]) => [
    key,
    normalizeStyleDefinition(value)
  ]);

  return originalCreate(Object.fromEntries(transformedEntries)) as T;
};

export const normalizeTextStyleProp = (style: unknown): unknown => {
  if (!style) {
    return style;
  }

  if (Array.isArray(style)) {
    return style.map((entry) => normalizeTextStyleProp(entry));
  }

  if (typeof style === 'object') {
    return normalizeStyleDefinition(style);
  }

  return style;
};
