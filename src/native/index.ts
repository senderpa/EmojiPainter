/**
 * Native Module Bridges
 * Entry point for all Metal and native performance modules
 *
 * STROKE-REPLAY SYSTEM: No snapshots, only stroke persistence
 */

export * from './metal';
export * from './exporter';
export * from './strokelog';
export * from './autosave';
export * from './projects';
export {
  addExportProgressListener,
  isTimelapseExportAvailable,
  resolveCustomBrushToBase64,
  prepareStrokesForExport,
  isAnimationExportNativeAvailable,
  exportAnimationFramesNative,
  generatePreviewFrames,
  exportTimelapse,
  exportGif,
  generateProjectPreview,
  exportWebM,
  exportVectorFlythroughNative,
  isVectorNativeExportAvailable,
} from './timelapse';
export type { PreviewFrame, ProgressCallback } from './timelapse';
export * from './licenses';
export * from './screenRecorder';

import metalModule from './metal';
import exporterModule from './exporter';
import strokeLogModule from './strokelog';
import autosaveModule from './autosave';
import projectModule from './projects';
import timelapseModule from './timelapse';
import licensesModule from './licenses';

export { metalModule, exporterModule, strokeLogModule, autosaveModule, projectModule, timelapseModule, licensesModule };

/**
 * Check if all native performance modules are available
 */
export const isNativeRenderingAvailable = (): boolean => {
  return (
    metalModule.isMetalAvailable() &&
    exporterModule.isMetalExportAvailable() &&
    strokeLogModule.isStrokeLogAvailable()
  );
};
