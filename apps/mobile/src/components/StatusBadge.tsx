import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import { ListingStatus } from '@flipsync/core'
import { STATUS_META, motion } from '../theme'
import { Badge } from '../ui/Badge'
import { useReducedMotion } from '../ui/useReducedMotion'

/**
 * Badge d'état listing — libellés STATUS_META (serveur-autoritaire).
 * AI_PROCESSING « respire » doucement (signal travail en cours) ;
 * statique sous reduced-motion, le libellé « Analyse en cours… » suffit.
 */
export function StatusBadge({ status }: { status: ListingStatus }) {
  const meta = STATUS_META[status]
  const reduced = useReducedMotion()
  const breath = useRef(new Animated.Value(1)).current
  const breathing = status === ListingStatus.AI_PROCESSING && !reduced

  useEffect(() => {
    if (!breathing) {
      breath.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0.55,
          duration: motion.dur.slow * 3,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: motion.dur.slow * 3,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [breath, breathing])

  return (
    <Animated.View style={{ opacity: breath }}>
      <Badge label={meta.label} fg={meta.fg} bg={meta.bg} />
    </Animated.View>
  )
}
