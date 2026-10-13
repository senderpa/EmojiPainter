import fs from 'fs';
import path from 'path';
import { maskTopic } from '../utils/masking';

type WebMaskResult = { masked: string; revealedPositions: number[] };

function loadWebMaskTopic(): (topic: string, topicId?: number | null) => WebMaskResult {
  const galleryPath = path.resolve(__dirname, '../../../.website_work/gallery.html');
  const html = fs.readFileSync(galleryPath, 'utf8');
  const start = html.indexOf('function mysteryMaskSeed');
  const end = html.indexOf('function topicsMatch', start);
  if (start < 0 || end < 0) throw new Error('Web Mystery masking functions not found');

  // Evaluate only the three pure masking helpers and maskTopic, never the page.
  // eslint-disable-next-line no-new-func
  return new Function(`${html.slice(start, end)}; return maskTopic;`)() as ReturnType<typeof loadWebMaskTopic>;
}

describe('web/app Mystery masking parity', () => {
  const webMaskTopic = loadWebMaskTopic();

  test.each([
    ['Cat', 1],
    ['Blue Whale', 0],
    ['Space Whale', 123],
    ['Butterfly Garden', 0],
    ['ABCDEFGHIJKLMNOPQRST', 0],
    ['Fire Dragon', -7],
    ['Café Élite', 0],
  ] as const)('matches for %s (topic id %s)', (topic, topicId) => {
    expect(webMaskTopic(topic, topicId)).toEqual(maskTopic(topic, topicId));
  });
});

