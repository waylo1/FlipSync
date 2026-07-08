import { ReactNode, useEffect, useRef } from 'react'
import { Animated, ViewStyle } from 'react-native'
import { motion } from '../theme'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  children: ReactNode
  /** Décalage d'apparition (ms) — stagger de listes : index * 40, plafonné. */
  delay?: number
  style?: ViewStyle
}

/**
 * Entrée standard de l'app : fondu + légère montée (8 px), decelerate.
 * À poser sur toute carte/badge/section qui APPARAÎT (montage), jamais sur un
 * simple re-render. Sous reduced-motion : rendu direct, aucune animation.
 */
export function FadeInUp({ children, delay = 0, style }: Props) {
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current

  useEffect(() => {
    if (reduced) return
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.dur.base,
      delay,
      easing: motion.ease.decelerate,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, delay, reduced])

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] })

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  )
}
