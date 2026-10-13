import React from 'react';
import { View, StyleSheet } from 'react-native';

import CaptionBar from './CaptionBar';
import TouchRipple from './TouchRipple';
import { useTutorialActions, useTutorialState } from './TutorialContext';

interface TutorialOverlayProps {
  tutorialModeEnabled: boolean;
}

const TutorialOverlay: React.FC<TutorialOverlayProps> = ({ tutorialModeEnabled }) => {
  const { ripples } = useTutorialState();
  const { removeRipple } = useTutorialActions();

  return (
    <View style={styles.container} pointerEvents="none">
      {tutorialModeEnabled && ripples.map(ripple => (
        <TouchRipple
          key={ripple.id}
          id={ripple.id}
          x={ripple.x}
          y={ripple.y}
          onDone={removeRipple}
        />
      ))}
      <CaptionBar visible={tutorialModeEnabled} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9400,
  },
});

export default TutorialOverlay;
