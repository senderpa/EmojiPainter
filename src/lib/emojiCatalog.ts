import fullEmojiList from './emojiList.json';
import { buildReverseTranslationMap } from './emojiTranslations';

export interface EmojiEntry {
  emoji: string;
  annotation: string;
  group: number;
  subgroup: number;
  tokens: string[];
  order: number;
}

// Build translation map for multi-language search
const TRANSLATION_MAP = buildReverseTranslationMap();

export interface EmojiCategory {
  id: string;
  label: string;
  group: number | null;
  emojis: string[];
  sample: string;
}

interface StoredEmojiEntry extends EmojiEntry {
  groupLabel: string;
}

const ALL_ENTRIES: StoredEmojiEntry[] = (fullEmojiList as StoredEmojiEntry[])
  .map((entry, index) => ({
    ...entry,
    order: entry.order ?? index
  }))
  .sort((a, b) => a.order - b.order);

const ALL_SEARCH_STRINGS: string[] = ALL_ENTRIES.map((entry) => buildSearchString(entry));
const ALL_INDICES = ALL_ENTRIES.map((_, index) => index);

const COMPONENT_GROUP_ID = 2;
const FLAGS_GROUP_ID = 9;

// Regional indicator characters (U+1F1E6–U+1F1FF) render as dotted-box letters
// on systems that don't support them as flag pairs. Filter them out so they
// never appear in the picker or search results.
function containsRegionalIndicator(emoji: string): boolean {
  for (const char of emoji) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true;
  }
  return false;
}

const KEYCAP_SUBGROUP_ID = 94; // #️⃣ *️⃣ 0️⃣–🔟 — render as boxed chars on some systems
const RENDERABLE_PAIRS = ALL_INDICES
  .map((index) => ({ entry: ALL_ENTRIES[index], index }))
  .filter(({ entry }) =>
    entry.group !== COMPONENT_GROUP_ID &&
    entry.group !== FLAGS_GROUP_ID &&
    entry.subgroup !== KEYCAP_SUBGROUP_ID &&
    !containsRegionalIndicator(entry.emoji)
  );

const RENDERABLE_INDICES = RENDERABLE_PAIRS.map((pair) => pair.index);
export const renderableEmojiEntries: EmojiEntry[] = RENDERABLE_PAIRS.map(({ entry }) => entry);

function buildCategories(entries: StoredEmojiEntry[]): EmojiCategory[] {
  const groups = new Map<number, EmojiCategory>();

  entries.forEach((entry) => {
    const group = entry.group ?? -1;
    if (!groups.has(group)) {
      const id = group >= 0 ? `group-${group}` : 'group-other';
      groups.set(group, {
        id,
        label: entry.groupLabel ?? 'Other',
        group,
        emojis: [],
        sample: entry.emoji
      });
    }
    groups.get(group)?.emojis.push(entry.emoji);
  });

  const ordered = Array.from(groups.values()).sort((a, b) => {
    const aGroup = a.group ?? Number.MAX_SAFE_INTEGER;
    const bGroup = b.group ?? Number.MAX_SAFE_INTEGER;
    return aGroup - bGroup;
  });

  const allCategory: EmojiCategory = {
    id: 'all',
    label: 'All Emoji',
    group: null,
    emojis: entries.map((entry) => entry.emoji),
    sample: entries[0]?.emoji ?? '😀'
  };

  return [allCategory, ...ordered];
}

export const emojiCategories: EmojiCategory[] = buildCategories(
  ALL_ENTRIES.filter((entry) => entry.group !== FLAGS_GROUP_ID)
);
export const renderableEmojiCategories: EmojiCategory[] = buildCategories(
  ALL_ENTRIES.filter((entry) => entry.group !== COMPONENT_GROUP_ID && entry.group !== FLAGS_GROUP_ID)
);

function buildSearchString(entry: StoredEmojiEntry): string {
  const pool = new Set<string>();
  pool.add(entry.emoji);
  pool.add(entry.annotation.toLowerCase());
  entry.tokens.forEach((token) => pool.add(token.toLowerCase()));
  return Array.from(pool)
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

const normalizeQuery = (value: string): string[] => {
  const tokens = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[\s_:-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  // Translate foreign language terms to English for searching
  return tokens.map((token) => {
    const translation = TRANSLATION_MAP.get(token);
    return translation || token;
  });
};

function filterEntries(entries: EmojiEntry[], indices: number[], terms: string[]): EmojiEntry[] {
  if (!terms.length) {
    return entries;
  }
  const lowered = terms.map((term) => term.toLowerCase());
  return entries.filter((_, idx) => {
    const haystack = ALL_SEARCH_STRINGS[indices[idx]];
    return lowered.every((term) => haystack.includes(term));
  });
}

export function searchRenderableEmojis(search: string): EmojiEntry[] {
  const terms = normalizeQuery(search);
  return filterEntries(renderableEmojiEntries, RENDERABLE_INDICES, terms);
}

export function filterEmojis(categoryId: string, search: string): EmojiEntry[] {
  const category = emojiCategories.find((entry) => entry.id === categoryId) ?? emojiCategories[0];
  const terms = normalizeQuery(search);

  if (category.group === null) {
    return filterEntries(ALL_ENTRIES, ALL_INDICES, terms);
  }

  const scopedEntries: EmojiEntry[] = [];
  const scopedIndices: number[] = [];
  ALL_ENTRIES.forEach((entry, index) => {
    if (entry.group === category.group) {
      scopedEntries.push(entry);
      scopedIndices.push(index);
    }
  });

  return filterEntries(scopedEntries, scopedIndices, terms);
}
