import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, ViewStyle } from 'react-native'
import { motion, radius, theme } from '../theme'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  width?: ViewStyle['width']
  height: number
  round?: keyof typeof radius
  style?: ViewStyle
}

/**
 * Bloc de chargement crème/kraft avec shimmer sobre.
 * Sous reduced-motion : bloc statique — aucune information perdue.
 */
export function Skeleton({ width = '100%', height, round = 'md', style }: Props) {
  const reduced = useReducedMotion()
  const pulse = useRef(new Animated.Value(0.55)).current

  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motion.dur.slow * 2,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: motion.dur.slow * 2,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, reduced])

  return (
    <Animated.View
      accessibilityLabel="Chargement"
      style={[
        styles.base,
        { width, height, borderRadius: radius[round], opacity: reduced ? 0.7 : pulse },
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  base: { backgroundColor: theme.kraft },
})
