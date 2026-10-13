import type { VectorCameraState, VectorViewpoint } from './vectorTypes';

export interface ViewpointScreenFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

/** Project a saved viewpoint's viewport into the currently visible camera. */
export function viewpointScreenFrame(
  viewpoint: VectorViewpoint,
  camera: VectorCameraState,
  viewportWidth: number,
  viewportHeight: number
): ViewpointScreenFrame {
  const savedZoom = Number.isFinite(viewpoint.zoom) && viewpoint.zoom > 0 ? viewpoint.zoom : 1;
  const frameWidth = viewportWidth * camera.zoom / savedZoom;
  const frameHeight = viewportHeight * camera.zoom / savedZoom;
  const centerX = viewportWidth / 2 + (viewpoint.cx - camera.cx) * camera.zoom;
  const centerY = viewportHeight / 2 + (viewpoint.cy - camera.cy) * camera.zoom;
  const left = centerX - frameWidth / 2;
  const top = centerY - frameHeight / 2;
  return {
    left,
    top,
    width: frameWidth,
    height: frameHeight,
    visible: left < viewportWidth && top < viewportHeight && left + frameWidth > 0 && top + frameHeight > 0,
  };
}
