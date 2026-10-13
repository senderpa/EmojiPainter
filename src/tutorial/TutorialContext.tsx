import React, { createContext, useContext, useCallback, useMemo, useState, useRef, ReactNode } from 'react';

import type { TouchRipple } from './types';

interface TutorialStateValue {
  ripples: TouchRipple[];
  tutorialAction: string;
}

interface TutorialActionsValue {
  addRipple: (x: number, y: number) => void;
  removeRipple: (id: string) => void;
  setTutorialAction: (text: string) => void;
}

const TutorialStateContext = createContext<TutorialStateValue>({
  ripples: [],
  tutorialAction: '',
});

const TutorialActionsContext = createContext<TutorialActionsValue>({
  addRipple: () => {},
  removeRipple: () => {},
  setTutorialAction: () => {},
});

let rippleCounter = 0;

export const TutorialProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [ripples, setRipples] = useState<TouchRipple[]>([]);
  const [tutorialAction, setTutorialActionState] = useState('');
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addRipple = useCallback((x: number, y: number) => {
    const id = `ripple_${rippleCounter++}`;
    setRipples(prev => [...prev.slice(-8), { id, x, y, timestamp: Date.now() }]);
  }, []);

  const removeRipple = useCallback((id: string) => {
    setRipples(prev => prev.filter(r => r.id !== id));
  }, []);

  const setTutorialAction = useCallback((text: string) => {
    setTutorialActionState(text);
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => setTutorialActionState(''), 3000);
  }, []);

  const actions = useMemo<TutorialActionsValue>(() => ({
    addRipple,
    removeRipple,
    setTutorialAction,
  }), [addRipple, removeRipple, setTutorialAction]);

  const state = useMemo<TutorialStateValue>(() => ({
    ripples,
    tutorialAction,
  }), [ripples, tutorialAction]);

  return (
    <TutorialActionsContext.Provider value={actions}>
      <TutorialStateContext.Provider value={state}>
        {children}
      </TutorialStateContext.Provider>
    </TutorialActionsContext.Provider>
  );
};

export const useTutorialState = (): TutorialStateValue => useContext(TutorialStateContext);
export const useTutorialActions = (): TutorialActionsValue => useContext(TutorialActionsContext);
export const useTutorial = (): TutorialStateValue & TutorialActionsValue => ({
  ...useTutorialState(),
  ...useTutorialActions(),
});
