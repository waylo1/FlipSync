import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { X } from 'lucide-react-native'
import {
  ComplexCasePolicy,
  DeliveryPreference,
  SellObjective,
  centsToEur,
  eurToCents,
  negotiationMarginPct,
} from '@flipsync/core'
import { dev } from '../src/dev-session/recorder'
import { useMandateDraft } from '../src/store/mission.store'
import { MIN_TOUCH, font, formatEur, line, radius, space, theme, tracking } from '../src/theme'
import { Badge } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { FadeInUp } from '../src/ui/FadeInUp'
import { Field } from '../src/ui/Field'
import { Tappable } from '../src/ui/Tappable'

/**
 * S2 — Assistant « Personnaliser » (COMMISSAIRE_PRISEUR_PLAN.md §5.2).
 * Feuille 4 questions, une par vue : Objectif → Prix mini → Livraison →
 * Cas complexes. Chemin rapide = 4 taps (tout est pré-rempli). Ouvert depuis
 * S1 (« Personnaliser »). À la fin, comme S1, retombe directement sur
 * validate.tsx (S3 « Votre mandat » viendra au Lot 3) via le même canal
 * `postureConfirmed` — on saute donc deux écrans de la pile (S1 + S2).
 */

const OBJECTIVE_OPTIONS: readonly { value: SellObjective; label: string }[] = [
  { value: SellObjective.VENDRE_VITE, label: 'Vendre vite' },
  { value: SellObjective.EQUILIBRE, label: 'Équilibre' },
  { value: SellObjective.MEILLEUR_PRIX, label: 'Meilleur prix' },
]

const DELIVERY_OPTIONS: readonly { value: DeliveryPreference; label: string }[] = [
  { value: DeliveryPreference.MAIN_PROPRE, label: 'Main propre' },
  { value: DeliveryPreference.ENVOI, label: 'Envoi' },
  { value: DeliveryPreference.LES_DEUX, label: 'Les deux' },
]

const COMPLEX_CASE_OPTIONS: readonly { value: ComplexCasePolicy; label: string }[] = [
  { value: ComplexCasePolicy.ME_DEMANDER, label: 'Me demander' },
  { value: ComplexCasePolicy.REFUSER, label: 'Refuser' },
  { value: ComplexCasePolicy.CONTINUER, label: 'Continuer la discussion' },
]

const STEP_COUNT = 4

export default function MandateCustomizeScreen() {
  const router = useRouter()
  const { prixAffiche, prixPlancher } = useLocalSearchParams<{
    prixAffiche: string
    prixPlancher: string
  }>()
  const prixAfficheCents = Number(prixAffiche)
  const prixPlancherCents = Number(prixPlancher)

  const objectif = useMandateDraft(s => s.objectif)
  const setObjectif = useMandateDraft(s => s.setObjectif)
  const prixMini = useMandateDraft(s => s.prixMini)
  const setPrixMini = useMandateDraft(s => s.setPrixMini)
  const seedPrixMini = useMandateDraft(s => s.seedPrixMini)
  const livraison = useMandateDraft(s => s.livraison)
  const setLivraison = useMandateDraft(s => s.setLivraison)
  const casComplexes = useMandateDraft(s => s.casComplexes)
  const setCasComplexes = useMandateDraft(s => s.setCasComplexes)
  const autoAdjuge = useMandateDraft(s => s.autoAdjugeAuDessusDuMini)
  const setAutoAdjuge = useMandateDraft(s => s.setAutoAdjuge)
  const confirmPosture = useMandateDraft(s => s.confirmPosture)

  // Amorce unique au montage : si l'utilisateur revient sur cette vue, sa saisie prime.
  useEffect(() => {
    seedPrixMini(prixPlancherCents, prixAfficheCents)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [step, setStep] = useState(0)
  const [prixInput, setPrixInput] = useState(
    centsToEur(prixMini ?? Math.min(prixPlancherCents, prixAfficheCents)).toFixed(2),
  )
  const [optionsOpen, setOptionsOpen] = useState(false)

  const prixMiniCents = useMemo(() => {
    const eur = Number(prixInput.replace(',', '.'))
    return Number.isFinite(eur) ? eurToCents(eur) : NaN
  }, [prixInput])

  const prixError =
    step === 1 && (!Number.isFinite(prixMiniCents) || prixMiniCents <= 0)
      ? 'Le prix mini doit être supérieur à 0 €.'
      : step === 1 && prixMiniCents > prixAfficheCents
        ? 'Le prix mini doit être inférieur au prix affiché.'
        : null

  const canContinue = step !== 1 || prixError === null

  const handleClose = () => {
    dev.track('mandate_customize_closed')
    router.back()
  }

  const handleContinue = () => {
    if (!canContinue) return
    if (step === 1) setPrixMini(prixMiniCents)
    if (step < STEP_COUNT - 1) {
      setStep(step + 1)
      return
    }
    dev.track('mandate_customize_confirmed')
    confirmPosture()
    router.dismiss(2)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={handleClose}
          hitSlop={space[2]}
          style={styles.closeButton}
        >
          <X size={space[5]} color={theme.ink} />
        </Pressable>
        <View
          style={styles.dots}
          accessibilityLabel={`Étape ${step + 1} sur ${STEP_COUNT}`}
        >
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotActive]} />
          ))}
        </View>
      </View>

      <View style={styles.content}>
        {step === 0 && (
          <FadeInUp key="objectif">
            <Text accessibilityRole="header" style={styles.heading}>
              Quel est votre objectif ?
            </Text>
            <View style={styles.optionList} accessibilityRole="radiogroup">
              {OBJECTIVE_OPTIONS.map(o => (
                <OptionCard
                  key={o.value}
                  label={o.label}
                  active={objectif === o.value}
                  onPress={() => setObjectif(o.value)}
                />
              ))}
            </View>
          </FadeInUp>
        )}

        {step === 1 && (
          <FadeInUp key="prix">
            <Text accessibilityRole="header" style={styles.heading}>
              En dessous de quel prix ne jamais descendre ?
            </Text>
            <Field
              label="Prix minimum accepté"
              value={prixInput}
              onChangeText={setPrixInput}
              keyboardType="decimal-pad"
              error={prixError}
              style={styles.priceInput}
            />
            <Text style={styles.priceHint}>
              Prix affiché {formatEur(prixAfficheCents)} · Marge de négociation :{' '}
              {negotiationMarginPct(
                prixAfficheCents,
                Number.isFinite(prixMiniCents) ? prixMiniCents : 0,
              )}
              %
            </Text>
          </FadeInUp>
        )}

        {step === 2 && (
          <FadeInUp key="livraison">
            <Text accessibilityRole="header" style={styles.heading}>
              Comment l’objet peut-il être remis ?
            </Text>
            <View style={styles.optionList} accessibilityRole="radiogroup">
              {DELIVERY_OPTIONS.map(o => (
                <OptionCard
                  key={o.value}
                  label={o.label}
                  active={livraison === o.value}
                  onPress={() => setLivraison(o.value)}
                />
              ))}
            </View>
            {livraison !== DeliveryPreference.MAIN_PROPRE && (
              <Text style={styles.note}>
                L’IA propose l’envoi via le circuit sécurisé de la plateforme.
              </Text>
            )}
          </FadeInUp>
        )}

        {step === 3 && (
          <FadeInUp key="cas">
            <Text accessibilityRole="header" style={styles.heading}>
              Que faire si un cas dépasse les règles ?
            </Text>
            <View style={styles.optionList} accessibilityRole="radiogroup">
              {COMPLEX_CASE_OPTIONS.map(o => (
                <OptionCard
                  key={o.value}
                  label={o.label}
                  active={casComplexes === o.value}
                  onPress={() => setCasComplexes(o.value)}
                />
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: optionsOpen }}
              onPress={() => setOptionsOpen(v => !v)}
              style={styles.optionsToggle}
            >
              <Text style={styles.optionsToggleLabel}>Options</Text>
            </Pressable>
            {optionsOpen && (
              <Tappable
                accessibilityLabel={`Adjuger sans me demander au-dessus du prix mini, ${autoAdjuge ? 'activé' : 'désactivé'}`}
                onPress={() => setAutoAdjuge(!autoAdjuge)}
              >
                <Card style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    Adjuger sans me demander au-dessus du prix mini
                  </Text>
                  <Badge
                    label={autoAdjuge ? 'Activé' : 'Désactivé'}
                    fg={autoAdjuge ? theme.bouteille : theme.muted}
                    bg={autoAdjuge ? theme.bouteilleSoft : theme.kraft}
                  />
                </Card>
              </Tappable>
            )}
          </FadeInUp>
        )}
      </View>

      <View style={styles.footer}>
        <Button
          label={step === STEP_COUNT - 1 ? 'Voir mon mandat' : 'Continuer'}
          onPress={handleContinue}
          disabled={!canContinue}
        />
      </View>
    </View>
  )
}

function OptionCard({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Tappable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      <Card style={{ ...styles.optionCard, ...(active ? styles.optionCardActive : undefined) }}>
        <Text style={styles.optionLabel}>{label}</Text>
      </Card>
    </Tappable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[2],
  },
  closeButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: space[1] },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: theme.border },
  dotActive: { backgroundColor: theme.goldDark },

  content: { flex: 1, padding: space[5], paddingTop: space[3], gap: space[3] },
  heading: {
    fontSize: font.heading,
    lineHeight: line.heading,
    fontWeight: '700',
    color: theme.ink,
    letterSpacing: tracking.heading,
    marginBottom: space[2],
  },

  optionList: { gap: space[2] },
  optionCard: { paddingVertical: space[4] },
  optionCardActive: {
    borderColor: theme.terracotta,
    borderWidth: 2,
    backgroundColor: theme.terracottaSoft,
  },
  optionLabel: { fontSize: font.lead, fontWeight: '700', color: theme.ink },

  priceInput: { fontSize: font.display, textAlign: 'center' },
  priceHint: { fontSize: font.caption, lineHeight: line.caption, color: theme.muted },

  note: { fontSize: font.small, lineHeight: line.small, color: theme.muted },

  optionsToggle: { minHeight: MIN_TOUCH, justifyContent: 'center', marginTop: space[2] },
  optionsToggleLabel: { fontSize: font.small, fontWeight: '600', color: theme.goldDark },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  switchLabel: { flex: 1, fontSize: font.small, lineHeight: line.small, color: theme.ink },

  footer: {
    padding: space[5],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
})
