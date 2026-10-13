declare module 'emojibase-data/en/data.json' {
  const data: Array<{
    emoji?: string;
    label?: string;
    tags?: string[];
    shortcodes?: string[];
    group?: number;
    subgroup?: number;
    order?: number;
    hexcode?: string;
  }>;
  export default data;
}

declare module 'emojibase-data/en/shortcodes/emojibase.json' {
  const data: Record<string, string | string[]>;
  export default data;
}
