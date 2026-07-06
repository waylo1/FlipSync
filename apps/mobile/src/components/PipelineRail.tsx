import { StyleSheet, View } from 'react-native'
import { ListingStatus } from '@flipsync/core'
import { PIPELINE_STEPS, STATUS_META, radius, space, theme } from '../theme'

/**
 * Rail de progression du pipeline nominal (7 jalons).
 * Reflète STRICTEMENT l'état serveur — jamais optimiste. Masqué hors pipeline.
 */
export function PipelineRail({ status }: { status: ListingStatus }) {
  const meta = STATUS_META[status]
  if (meta.step === null) return null
  const step = meta.step

  return (
    <View
      accessibilityLabel={`Étape ${step} sur ${PIPELINE_STEPS}`}
      style={styles.rail}
    >
      {Array.from({ length: PIPELINE_STEPS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.segment,
            i < step && { backgroundColor: meta.fg },
            i === step - 1 && styles.segmentCurrent,
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: space[1] },
  segment: {
    flex: 1,
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.border,
  },
  segmentCurrent: { height: space[1] + space[1] / 2, marginTop: -space[1] / 4 },
})
