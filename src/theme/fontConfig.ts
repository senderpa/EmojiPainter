import { StyleSheet, TextStyle } from 'react-native';

export const BASE_FONT_FAMILY = 'vrtlfinal';
const LEGACY_FONT_FAMILY = 'vrtlfinale1';

const fontSource = require('../../assets/fonts/vrtlfinale1.ttf');

export const FONT_VARIANTS = {
  regular: BASE_FONT_FAMILY,
  medium: `${BASE_FONT_FAMILY}-medium`,
  semibold: `${BASE_FONT_FAMILY}-semibold`,
  bold: `${BASE_FONT_FAMILY}-bold`,
  extrabold: `${BASE_FONT_FAMILY}-extrabold`
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

const registerFontFamily = (acc: Record<string, number>, family: string): void => {
  acc[family] = fontSource;
};

export const FONT_ASSETS: Record<string, number> = Object.values(FONT_VARIANTS).reduce(
  (acc, family) => {
    registerFontFamily(acc, family);

    // Register legacy aliases (so existing style declarations keep working)
    const legacyFamily = family.replace(BASE_FONT_FAMILY, LEGACY_FONT_FAMILY);
    if (legacyFamily !== family) {
      registerFontFamily(acc, legacyFamily);
    }

    return acc;
  },
  { [LEGACY_FONT_FAMILY]: fontSource } as Record<string, number>
);

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
  const sanitizedFontFamily =
    fontFamily && fontFamily.startsWith(LEGACY_FONT_FAMILY)
      ? fontFamily.replace(LEGACY_FONT_FAMILY, BASE_FONT_FAMILY)
      : fontFamily;
  const next: TextStyle = {
    ...rest,
    fontFamily: sanitizedFontFamily ?? resolveFontFamily(fontWeight)
  };

  return next as T;
};

const normalizeStyleDefinition = (entry: unknown): unknown => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  if (!('fontWeight' in entry) || !(entry as TextStyle).fontWeight) {
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
