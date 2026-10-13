import React, { useEffect } from 'react';
import { TouchableOpacity, type StyleProp, type ViewStyle, type TouchableOpacityProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

interface ToolbarButtonProps extends TouchableOpacityProps {
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  style: StyleProp<ViewStyle>;
  activeStyle?: StyleProp<ViewStyle>;
  disabledStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  active,
  disabled,
  onPress,
  accessibilityLabel,
  style,
  activeStyle,
  disabledStyle,
  children,
  ...rest
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  useEffect(() => {
    scale.value = withTiming(active ? 1.08 : 1, {
      duration: active ? 160 : 180
    });
  }, [active, scale]);

  const handlePressIn = () => {
    if (disabled) return;
    scale.value = withTiming(1.08, { duration: 120 });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 160 });
  };

  return (
    <AnimatedTouchableOpacity
      style={[style, active ? activeStyle : null, disabled ? disabledStyle : null, animatedStyle]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      {children}
    </AnimatedTouchableOpacity>
  );
};

export default ToolbarButton;
