import { ReactNode } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ComplexCasePolicy, DeliveryPreference, SellObjective, negotiationMarginPct } from '@flipsync/core'
import { dev } from '../src/dev-session/recorder'
import { useMandateDraft } from '../src/store/mission.store'
import { font, formatEur, line, space, theme, tracking } from '../src/theme'
import { Badge } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { FadeInUp } from '../src/ui/FadeInUp'
import { StackHeader } from '../src/ui/StackHeader'

/**
 * S3 — Écran « Votre mandat » (COMMISSAIRE_PRISEUR_PLAN.md §5.3). Terminal du
 * flux de configuration (après S1 seul, ou S1→S2) : récap lisible + garanties
 * + « Confirmer le mandat ». La création réelle de la Mission (persistance +
 * transition BROUILLON_MANDAT → EN_VENTE) n'a lieu qu'après « Valider et
 * publier » côté validate.tsx, au moment où le listingId existe enfin (le
 * mandat est configuré AVANT la création du listing dans le flux actuel) —
 * ce écran ne fait que fixer le mandat dans le store et rendre la main à
 * validate.tsx via le canal `postureConfirmed` existant (cf. mission.store.ts).
 */

const OBJECTIVE_LABELS: Readonly<Record<SellObjective, string>> = {
  [SellObjective.VENDRE_VITE]: 'Vendre vite',
  [SellObjective.EQUILIBRE]: 'Équilibre',
  [SellObjective.MEILLEUR_PRIX]: 'Meilleur prix',
}

const DELIVERY_LABELS: Readonly<Record<DeliveryPreference, string>> = {
  [DeliveryPreference.MAIN_PROPRE]: 'Main propre',
  [DeliveryPreference.ENVOI]: 'Envoi',
  [DeliveryPreference.LES_DEUX]: 'Les deux',
}

const COMPLEX_CASE_LABELS: Readonly<Record<ComplexCasePolicy, string>> = {
  [ComplexCasePolicy.ME_DEMANDER]: 'Me demander',
  [ComplexCasePolicy.REFUSER]: 'Refuser',
  [ComplexCasePolicy.CONTINUER]: 'Continuer la discussion',
}

const GUARANTEES = [
  "L'IA ne descend jamais sous votre prix mini.",
  'Vos coordonnées restent privées.',
  'Vous validez la vente finale.',
] as const

export default function MandateRecapScreen() {
  const router = useRouter()
  const { prixAffiche, dismissCount } = useLocalSearchParams<{
    prixAffiche: string
    /** Nombre d'écrans à sauter au retour (2 = S1 seul, 3 = S1+S2). */
    dismissCount: string
  }>()
  const prixAfficheCents = Number(prixAffiche)

  const objectif = useMandateDraft(s => s.objectif)
  const prixMini = useMandateDraft(s => s.prixMini)
  const livraison = useMandateDraft(s => s.livraison)
  const casComplexes = useMandateDraft(s => s.casComplexes)
  const autoAdjuge = useMandateDraft(s => s.autoAdjugeAuDessusDuMini)
  const confirmPosture = useMandateDraft(s => s.confirmPosture)

  const prixMiniCents = prixMini ?? prixAfficheCents

  const handleConfirm = () => {
    dev.track('mandate_recap_confirmed')
    confirmPosture()
    router.dismiss(Number(dismissCount))
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Votre mandat" />
      <View style={styles.content}>
        <Text style={styles.emblem}>🪧</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          Votre commissaire-priseur IA est prêt.
        </Text>

        <FadeInUp>
          <Card style={styles.recapCard}>
            <RecapRow label="Objectif" value={OBJECTIVE_LABELS[objectif]} />
            <RecapRow label="Prix mini" value={formatEur(prixMiniCents)} />
            <RecapRow
              label="Négociation"
              value={`${negotiationMarginPct(prixAfficheCents, prixMiniCents)} %`}
            />
            <RecapRow label="Livraison" value={DELIVERY_LABELS[livraison]} />
            <RecapRow
              label="Cas complexes"
              value={COMPLEX_CASE_LABELS[casComplexes]}
              trailing={
                autoAdjuge ? (
                  <Badge
                    label="Adjuge seule au-dessus du prix mini"
                    fg={theme.ink}
                    bg={theme.moutardeSoft}
                  />
                ) : undefined
              }
            />
          </Card>
        </FadeInUp>

        <View style={styles.guarantees}>
          {GUARANTEES.map(g => (
            <Text key={g} accessibilityRole="text" style={styles.guaranteeLine}>
              <Text style={styles.guaranteeCheck}>✓ </Text>
              {g}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Confirmer le mandat" onPress={handleConfirm} />
        <Button label="Modifier" variant="ghost" onPress={() => router.back()} />
      </View>
    </View>
  )
}

function RecapRow({
  label,
  value,
  trailing,
}: {
  label: string
  value: string
  trailing?: ReactNode
}) {
  return (
    <View
      style={styles.recapRow}
      accessible
      accessibilityLabel={`${label} : ${value}`}
    >
      <Text style={styles.recapLabel}>{label}</Text>
      <View style={styles.recapValueWrap}>
        <Text style={styles.recapValue}>{value}</Text>
        {trailing}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { flex: 1, padding: space[5], paddingTop: space[3], gap: space[3] },

  emblem: { fontSize: font.display, textAlign: 'center', marginTop: space[2] },
  heading: {
    fontSize: font.heading,
    lineHeight: line.heading,
    fontWeight: '700',
    color: theme.ink,
    letterSpacing: tracking.heading,
    textAlign: 'center',
    marginBottom: space[2],
  },

  recapCard: { gap: space[2] },
  recapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space[2],
  },
  recapLabel: { fontSize: font.small, color: theme.muted },
  recapValueWrap: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  recapValue: { fontSize: font.small, fontWeight: '700', color: theme.ink },

  guarantees: { gap: space[1], marginTop: space[2] },
  guaranteeLine: { fontSize: font.small, lineHeight: line.small, color: theme.bouteille },
  guaranteeCheck: { fontWeight: '700' },

  footer: {
    padding: space[5],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: space[2],
  },
})
