import type { Stroke, TraceState } from '../state/PaintingContext';

export interface LabPayload {
  strokes: Stroke[];
  trace: TraceState;
  brushEmoji: string;
  brushSize: number;
  brushOpacity: number;
  brushSpacing: number;
  createdAt: string;
}

export async function sendLabPayload(payload: LabPayload): Promise<void> {
  // Placeholder for real network integration. Simulate latency.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  console.info('Lab payload queued', {
    strokes: payload.strokes.length,
    traceIncluded: Boolean(payload.trace.imageUri),
  });
}

export function canSendToLab(strokes: Stroke[], trace: TraceState): boolean {
  return strokes.length > 0 && Boolean(trace.imageUri);
}
