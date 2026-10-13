import type { Stroke } from '../state/PaintingContext';

export interface TimelapseEncoderOptions {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
}

export interface TimelapseEncoder {
  addFrame(uri: string): Promise<void>;
  finalize(): Promise<string>;
}

export async function createTimelapseEncoder(strokes: Stroke[], options: TimelapseEncoderOptions): Promise<TimelapseEncoder> {
  throw new Error('GIF encoding not implemented yet');
}
