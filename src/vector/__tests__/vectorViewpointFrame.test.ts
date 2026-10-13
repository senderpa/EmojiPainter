import { viewpointScreenFrame } from '../vectorViewpointFrame';
import type { VectorViewpoint } from '../vectorTypes';

const viewpoint: VectorViewpoint = {
  id: 'view-1',
  label: 'View 1',
  cx: 0,
  cy: 0,
  zoom: 2,
  holdMs: 700,
  durationToNextMs: 1800,
  easing: 'easeInOut',
};

describe('vector viewpoint frame markers', () => {
  it('covers the viewport when the current camera matches the saved view', () => {
    expect(viewpointScreenFrame(viewpoint, { cx: 0, cy: 0, zoom: 2 }, 1000, 800)).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      visible: true,
    });
  });

  it('projects the saved crop as the current camera moves and zooms', () => {
    const frame = viewpointScreenFrame(viewpoint, { cx: -100, cy: 50, zoom: 1 }, 1000, 800);
    expect(frame).toEqual({
      left: 350,
      top: 150,
      width: 500,
      height: 400,
      visible: true,
    });
  });

  it('marks a frame outside the viewport as not visible', () => {
    expect(
      viewpointScreenFrame({ ...viewpoint, cx: 5000 }, { cx: 0, cy: 0, zoom: 1 }, 1000, 800).visible
    ).toBe(false);
  });
});
