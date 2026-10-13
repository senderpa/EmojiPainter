import React, { useCallback } from 'react';
import { View, TouchableOpacity, type Insets, Animated as RNAnimated } from 'react-native';

import BrushEmojiIcon from '../components/BrushEmojiIcon';
import ButtonGlow from '../tutorial/ButtonGlow';
import HelperLabel, { HelperRing } from '../tutorial/HelperLabel';
import { useHelperMode } from '../tutorial/useHelperMode';

interface QuickAction {
  key: string;
  icon: string;
  label: string;
  helperLabel?: string;
  showCoachFeedback?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onLayout?: (coords: { x: number; y: number; width: number; height: number }) => void;
}

interface QuickActionsStripProps {
  styles: any;
  actions: QuickAction[];
  hitSlop: Insets | { top: number; bottom: number; left: number; right: number };
  infoPulseScale: any;
  infoPulseOpacity: any;
  emojiBounceScale?: RNAnimated.Value;
  onInfoButtonLayout?: (coords: { x: number; y: number; width: number; height: number }) => void;
  isLandscape?: boolean;
}

const QuickActionsStrip: React.FC<QuickActionsStripProps> = ({
  styles,
  actions,
  hitSlop,
  infoPulseScale,
  infoPulseOpacity,
  emojiBounceScale,
  onInfoButtonLayout,
  isLandscape = false
}) => {
  const infoButtonRef = React.useRef<View | null>(null);
  const buttonRefs = React.useRef<Map<string, View | null>>(new Map());

  const actionKeys = actions.map(a => a.key);
  const { activeHelperKey, glowCounters, triggerHelper, tutorialModeEnabled, helperModeEnabled } = useHelperMode({
    keys: actionKeys,
  });

  const handleTrigger = useCallback((key: string) => {
    triggerHelper(key);
  }, [triggerHelper]);

  return (
    <View style={styles.traceControls}>
      <View
        style={[
          styles.quickActions,
          isLandscape && {
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12
          }
        ]}
      >
        {actions.map((button) => {
          const handlePress = () => {
            if (button.showCoachFeedback !== false) {
              handleTrigger(button.key);
            }
            button.onPress();
          };

          const content = (
            <TouchableOpacity
              ref={(node) => {
                if (button.onLayout) {
                  buttonRefs.current.set(button.key, node);
                }
              }}
              onLayout={() => {
                if (button.onLayout) {
                  const buttonNode = buttonRefs.current.get(button.key);
                  if (buttonNode) {
                    buttonNode.measureInWindow((x, y, width, height) => {
                      button.onLayout?.({ x, y, width, height });
                    });
                  }
                }
              }}
              style={[styles.quickActionButton, button.key === 'info' && styles.infoButton, button.disabled && styles.disabledButton]}
              onPress={handlePress}
              onLongPress={button.onLongPress}
              disabled={button.disabled}
              accessibilityRole="button"
              accessibilityLabel={button.label}
              hitSlop={hitSlop}
            >
              <BrushEmojiIcon
                emoji={button.icon}
                size={typeof styles?.quickActionEmoji?.fontSize === 'number' ? styles.quickActionEmoji.fontSize : 20}
                textStyle={styles.quickActionEmoji}
                imageStyle={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
              />
            </TouchableOpacity>
          );

          const animatedContent = button.key === 'emoji' && emojiBounceScale
            ? (
                <RNAnimated.View style={{ transform: [{ scale: emojiBounceScale }] }}>
                  {content}
                </RNAnimated.View>
              )
            : content;

          const helperVisible = activeHelperKey === button.key;
          const helperText = button.helperLabel ?? '';

          if (button.key === 'info') {
            return (
              <View
                key={button.key}
                ref={(node) => { infoButtonRef.current = node; }}
                onLayout={() => {
                  if (!infoButtonRef.current || !onInfoButtonLayout) return;
                  infoButtonRef.current.measureInWindow((x, y, width, height) => {
                    onInfoButtonLayout({ x, y, width, height });
                  });
                }}
                style={[styles.infoButtonWrapper, { position: 'relative' }]}
              >
                <RNAnimated.View style={{ transform: [{ scale: infoPulseScale }], opacity: infoPulseOpacity }}>
                  {animatedContent}
                </RNAnimated.View>
                <ButtonGlow counter={glowCounters[button.key] ?? 0} enabled={tutorialModeEnabled} />
                <HelperRing visible={helperVisible && helperModeEnabled} />
                {helperText ? (
                  <HelperLabel text={helperText} visible={helperVisible} position="above" />
                ) : null}
              </View>
            );
          }

          return (
            <View key={button.key} style={[styles.quickActionStaticWrapper, { position: 'relative' }]}>
              {animatedContent}
              <ButtonGlow counter={glowCounters[button.key] ?? 0} enabled={tutorialModeEnabled} />
              <HelperRing visible={helperVisible && helperModeEnabled} />
              {helperText ? (
                <HelperLabel text={helperText} visible={helperVisible} position="above" />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default QuickActionsStrip;
