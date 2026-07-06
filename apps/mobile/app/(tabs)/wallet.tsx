import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { TransactionType } from '@flipsync/core'
import { MIN_TOUCH, font, formatEur, radius, shadow, space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { Card } from '../../src/ui/Card'
import { AmountText } from '../../src/ui/AmountText'

interface TransactionRow {
  id: string
  type: TransactionType
  amountCents: number // centimes Int
  description: string
  quand: string
}

/**
 * MOCK — état wallet et historique de démonstration.
 * TODO(Sprint 3) : remplacer par api.getWallet() / api.getTransactions()
 * + recharge Stripe (PaymentSheet) qui alimente le webhook existant.
 */
const MOCK_WALLET = {
  balance: 2350, // centimes — 23,50 €
  freeListingsRemaining: 1,
  lifetimeRecharged: 3000,
  autoRechargeEnabled: false,
  autoRechargeThreshold: 100, // déclenche sous 1,00 €
  autoRechargeAmount: 1000, //  recharge de 10,00 €
}

const MOCK_TRANSACTIONS: readonly TransactionRow[] = [
  { id: 't1', type: TransactionType.DEBIT, amountCents: 250, description: 'Annonce Optimisée — Veste cuir', quand: 'il y a 2 h' },
  { id: 't2', type: TransactionType.REFUND, amountCents: 250, description: 'Échec publication — Sac Longchamp', quand: 'il y a 3 h' },
  { id: 't3', type: TransactionType.DEBIT, amountCents: 80, description: 'Annonce Simple — Cafetière', quand: 'hier' },
  { id: 't4', type: TransactionType.BONUS, amountCents: 100, description: 'Bonus fidélité première recharge', quand: 'il y a 3 j' },
  { id: 't5', type: TransactionType.CREDIT, amountCents: 1000, description: 'Recharge', quand: 'il y a 3 j' },
  { id: 't6', type: TransactionType.CREDIT, amountCents: 2000, description: 'Recharge', quand: 'la semaine dernière' },
]

/** Sémantique des mouvements : crédits en bouteille, débits en encre, signe explicite. */
const TX_META: Readonly<Record<TransactionType, { sign: '+' | '−'; color: string; label: string }>> = {
  [TransactionType.CREDIT]: { sign: '+', color: theme.bouteille, label: 'Recharge' },
  [TransactionType.BONUS]: { sign: '+', color: theme.goldDark, label: 'Bonus' },
  [TransactionType.REFUND]: { sign: '+', color: theme.bouteille, label: 'Remboursement' },
  [TransactionType.DEBIT]: { sign: '−', color: theme.ink, label: 'Débit' },
}

const RECHARGE_AMOUNTS: readonly number[] = [500, 1000, 2000] // centimes

export default function WalletScreen() {
  // État local mock — sera remplacé par le wallet serveur (source de vérité).
  const [autoRecharge, setAutoRecharge] = useState(MOCK_WALLET.autoRechargeEnabled)
  const [rechargeAmount, setRechargeAmount] = useState(MOCK_WALLET.autoRechargeAmount)

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Ma cagnotte" />

      {/* Solde — toujours en centimes côté données, euros à l'affichage seulement. */}
      <View style={styles.balanceCard} accessibilityLabel={`Solde disponible : ${formatEur(MOCK_WALLET.balance)}`}>
        <Text style={styles.balanceLabel}>Solde disponible</Text>
        <AmountText cents={MOCK_WALLET.balance} size={font.balance} color={theme.onDark} />
        <View style={styles.balanceFooter}>
          <Text style={styles.balanceChip}>
            {MOCK_WALLET.freeListingsRemaining} annonce gratuite restante
          </Text>
          <Text style={styles.balanceMuted}>
            {formatEur(MOCK_WALLET.lifetimeRecharged)} rechargés au total
          </Text>
        </View>
      </View>

      {/* Auto-recharge — déclenchée par WalletService.authorize() (étape 3). */}
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleBlock}>
            <Text style={styles.sectionTitle}>Recharge automatique</Text>
            <Text style={styles.sectionHint}>
              Sous {formatEur(MOCK_WALLET.autoRechargeThreshold)}, recharge de{' '}
              {formatEur(rechargeAmount)} déclenchée à la prochaine annonce.
            </Text>
          </View>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel="Recharge automatique"
            accessibilityState={{ checked: autoRecharge }}
            value={autoRecharge}
            onValueChange={setAutoRecharge}
            trackColor={{ false: theme.border, true: theme.gold }}
            thumbColor={theme.card}
          />
        </View>

        {autoRecharge && (
          <View style={styles.amountRow} accessibilityRole="radiogroup">
            {RECHARGE_AMOUNTS.map(amount => {
              const active = rechargeAmount === amount
              return (
                <Pressable
                  key={amount}
                  accessibilityRole="radio"
                  accessibilityLabel={`Recharge de ${formatEur(amount)}`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.amountChip,
                    active && styles.amountChipActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setRechargeAmount(amount)}
                >
                  <Text style={[styles.amountChipText, active && styles.amountChipTextActive]}>
                    {formatEur(amount)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </Card>

      {/* Historique — montants signés, sémantique par type de transaction. */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Historique</Text>
        {MOCK_TRANSACTIONS.map(tx => {
          const meta = TX_META[tx.type]
          return (
            <View
              key={tx.id}
              style={styles.txRow}
              accessibilityLabel={`${meta.label}, ${tx.description}, ${meta.sign === '+' ? 'plus' : 'moins'} ${formatEur(tx.amountCents)}, ${tx.quand}`}
            >
              <View style={styles.txBody}>
                <Text style={styles.txDescription} numberOfLines={1}>
                  {tx.description}
                </Text>
                <Text style={styles.txWhen}>
                  {meta.label} · {tx.quand}
                </Text>
              </View>
              <AmountText
                cents={tx.amountCents}
                sign={meta.sign}
                size={font.body}
                color={meta.color}
              />
            </View>
          )
        })}
      </Card>

      <Text style={styles.mockNote}>Données de démonstration — branchement API à venir.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { paddingBottom: space[6] },

  balanceCard: {
    marginHorizontal: space[4],
    backgroundColor: theme.ink,
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[1],
    ...shadow.sheet,
  },
  balanceLabel: { color: theme.gold, fontSize: font.small, fontWeight: '600' },
  balanceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[2],
  },
  balanceChip: {
    color: theme.ink,
    backgroundColor: theme.gold,
    fontSize: font.caption,
    fontWeight: '700',
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    overflow: 'hidden',
  },
  balanceMuted: { color: theme.onDarkMuted, fontSize: font.caption },

  section: { marginHorizontal: space[4], marginTop: space[4], gap: space[3] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  sectionTitleBlock: { flex: 1, gap: space[1] },
  sectionTitle: { fontSize: font.body, fontWeight: '700', color: theme.ink },
  sectionHint: { fontSize: font.caption, color: theme.muted, lineHeight: space[4] + space[1] },

  amountRow: { flexDirection: 'row', gap: space[2] },
  amountChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
  amountChipActive: { backgroundColor: theme.gold, borderColor: theme.gold },
  amountChipText: { fontSize: font.small, color: theme.ink },
  amountChipTextActive: { fontWeight: '700' },
  pressed: { opacity: 0.85 },

  txRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: space[6] },
  txBody: { flex: 1, gap: space[1] / 2 },
  txDescription: { fontSize: font.small, fontWeight: '500', color: theme.ink },
  txWhen: { fontSize: font.caption, color: theme.muted },

  mockNote: {
    textAlign: 'center',
    fontSize: font.caption,
    color: theme.muted,
    marginTop: space[5],
  },
})
