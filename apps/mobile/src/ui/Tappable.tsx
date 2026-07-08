import { ReactNode, useRef } from 'react'
import {
  AccessibilityRole,
  AccessibilityState,
  Animated,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native'
import { motion } from '../theme'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  children: ReactNode
  onPress: () => void
  accessibilityLabel: string
  accessibilityRole?: AccessibilityRole
  accessibilityState?: AccessibilityState
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  /** Échelle au toucher — 0.97 cartes, 0.94 petits contrôles. */
  pressScale?: number
}

/**
 * Surface tactile animée de l'app : ressort d'enfoncement au pressIn, retour
 * élastique au pressOut (native driver). C'est LE retour tactile des cartes et
 * tuiles — remplace l'opacité seule, qui fait « web ». Sous reduced-motion :
 * simple retour d'opacité.
 */
export function Tappable({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  disabled = false,
  style,
  pressScale = 0.97,
}: Props) {
  const reduced = useReducedMotion()
  const scale = useRef(new Animated.Value(1)).current

  const pressIn = () => {
    if (reduced) return
    Animated.timing(scale, {
      toValue: pressScale,
      duration: motion.dur.fast,
      easing: motion.ease.standard,
      useNativeDriver: true,
    }).start()
  }

  const pressOut = () => {
    if (reduced) return
    Animated.spring(scale, { toValue: 1, bounciness: 6, useNativeDriver: true }).start()
  }

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      style={({ pressed }) => [reduced && pressed && { opacity: 0.85 }]}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  )
}
