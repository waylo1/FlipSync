import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { POSTURE_ORDER, POSTURE_PRESETS, SellPosture } from '@flipsync/core'
import { useMandateDraft } from '../src/store/mission.store'
import { font, line, space, theme, tracking } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { FadeInUp } from '../src/ui/FadeInUp'
import { StackHeader } from '../src/ui/StackHeader'
import { Tappable } from '../src/ui/Tappable'

/**
 * S1 — « Configurez votre IA » (COMMISSAIRE_PRISEUR_PLAN.md §5.1).
 * Premier écran du mandat : choix d'une posture parmi 4, montée en autonomie
 * exprimée en une phrase par carte — jamais une liste de réglages. Ouvert
 * depuis validate.tsx en tapant « Valider et publier » sur le palier Premium.
 *
 * Lot 1 : aucun appel réseau ici. « Continuer » confirme la posture choisie
 * (canal useMandateDraft) et revient à validate.tsx, qui enchaîne sur la
 * confirmation de publication existante — S2 « Personnaliser » et S3 « Votre
 * mandat » viendront s'insérer dans ce chemin aux lots suivants.
 */
export default function MandatePostureScreen() {
  const router = useRouter()
  const posture = useMandateDraft(s => s.posture)
  const setPosture = useMandateDraft(s => s.setPosture)
  const confirmPosture = useMandateDraft(s => s.confirmPosture)

  const handleContinue = () => {
    confirmPosture()
    router.back()
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Configurez l'IA" />
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Comment l'IA doit-elle vendre ?
        </Text>
        <Text style={styles.subheading}>
          Vous gardez le contrôle. Vous validez la vente finale.
        </Text>

        <View style={styles.postureList} accessibilityRole="radiogroup">
          {POSTURE_ORDER.map((p, index) => {
            const preset = POSTURE_PRESETS[p]
            const active = posture === p
            return (
              <FadeInUp key={p} delay={index * 40}>
                <Tappable
                  accessibilityRole="radio"
                  accessibilityLabel={`${preset.label}, ${preset.promesse}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => setPosture(p)}
                >
                  <Card
                    style={{
                      ...styles.postureCard,
                      ...(active ? styles.postureCardActive : undefined),
                    }}
                  >
                    <View style={styles.postureHeader}>
                      <Text style={styles.postureEmoji}>{preset.emoji}</Text>
                      <Text style={styles.postureLabel}>{preset.label}</Text>
                    </View>
                    <Text style={styles.posturePromesse}>{preset.promesse}</Text>
                    <Text style={styles.postureSupport}>{preset.support}</Text>
                  </Card>
                </Tappable>
              </FadeInUp>
            )
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Continuer" onPress={handleContinue} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { padding: space[5], paddingTop: space[2], gap: space[3] },
  heading: {
    fontSize: font.heading,
    lineHeight: line.heading,
    fontWeight: '700',
    color: theme.ink,
    letterSpacing: tracking.heading,
  },
  subheading: {
    fontSize: font.small,
    lineHeight: line.small,
    color: theme.muted,
    marginBottom: space[2],
  },

  postureList: { gap: space[2] },
  postureCard: { gap: space[1] },
  postureCardActive: {
    borderColor: theme.terracotta,
    borderWidth: 2,
    backgroundColor: theme.terracottaSoft,
  },
  postureHeader: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  postureEmoji: { fontSize: font.lead },
  postureLabel: { fontSize: font.body, fontWeight: '700', color: theme.ink },
  posturePromesse: {
    fontSize: font.lead,
    lineHeight: line.lead,
    fontWeight: '700',
    color: theme.ink,
    marginTop: space[1],
  },
  postureSupport: {
    fontSize: font.caption,
    lineHeight: line.caption,
    color: theme.muted,
    marginTop: space[1],
  },

  footer: {
    padding: space[5],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
})
