export interface DailyPrompt {
  emoji: string;
  topic: string;
  timeMinutes: number;
  translations?: Record<string, string>;
}

export const formatPrompt = (prompt: DailyPrompt, language: string = 'en'): string => {
  const localized = prompt.translations?.[language] ?? prompt.topic;
  return `${prompt.emoji} ${localized}`.trim();
};
