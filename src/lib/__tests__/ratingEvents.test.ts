import { addRatingCheckListener, triggerRatingCheck } from '../ratingEvents';

describe('rating events', () => {
  it('forwards delayed-check options to listeners', () => {
    const listener = jest.fn();
    const unsubscribe = addRatingCheckListener(listener);

    triggerRatingCheck({ delayMs: 3000 });

    expect(listener).toHaveBeenCalledWith({ delayMs: 3000 });
    unsubscribe();
  });

  it('allows a listener to be removed before a later trigger', () => {
    const listener = jest.fn();
    const unsubscribe = addRatingCheckListener(listener);
    unsubscribe();

    triggerRatingCheck();

    expect(listener).not.toHaveBeenCalled();
  });
});
