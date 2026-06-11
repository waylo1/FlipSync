import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { TransactionType } from '@flipsync/core'
import { MONO, formatEur, theme } from '../../src/theme'

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
  { id: 't1', type: TransactionType.DEBIT, amountCents: 250, description: 'Listing OPTIMIZED — Veste cuir', quand: 'il y a 2 h' },
  { id: 't2', type: TransactionType.REFUND, amountCents: 250, description: 'Échec publication — Sac Longchamp', quand: 'il y a 3 h' },
  { id: 't3', type: TransactionType.DEBIT, amountCents: 80, description: 'Listing SIMPLE — Cafetière', quand: 'hier' },
  { id: 't4', type: TransactionType.BONUS, amountCents: 100, description: 'Bonus fidélité première recharge', quand: 'il y a 3 j' },
  { id: 't5', type: TransactionType.CREDIT, amountCents: 1000, description: 'Recharge Stripe', quand: 'il y a 3 j' },
  { id: 't6', type: TransactionType.CREDIT, amountCents: 2000, description: 'Recharge Stripe', quand: 'la semaine dernière' },
]

/** Sémantique des mouvements : crédits en vert, débits en encre, signe explicite. */
const TX_META: Readonly<Record<TransactionType, { sign: '+' | '−'; color: string; label: string }>> = {
  [TransactionType.CREDIT]: { sign: '+', color: '#15803D', label: 'Recharge' },
  [TransactionType.BONUS]: { sign: '+', color: theme.goldDark, label: 'Bonus' },
  [TransactionType.REFUND]: { sign: '+', color: '#0F766E', label: 'Remboursement' },
  [TransactionType.DEBIT]: { sign: '−', color: theme.ink, label: 'Débit' },
}

const RECHARGE_AMOUNTS: readonly number[] = [500, 1000, 2000] // centimes

export default function WalletScreen() {
  // État local mock — sera remplacé par le wallet serveur (source de vérité).
  const [autoRecharge, setAutoRecharge] = useState(MOCK_WALLET.autoRechargeEnabled)
  const [rechargeAmount, setRechargeAmount] = useState(MOCK_WALLET.autoRechargeAmount)

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.heading}>Wallet</Text>
        <View style={styles.headerAccent} />
      </View>

      {/* Solde — toujours en centimes côté données, euros à l'affichage seulement. */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Solde disponible</Text>
        <Text style={styles.balanceValue}>{formatEur(MOCK_WALLET.balance)}</Text>
        <View style={styles.balanceFooter}>
          <Text style={styles.balanceChip}>
            {MOCK_WALLET.freeListingsRemaining} listing gratuit restant
          </Text>
          <Text style={styles.balanceMuted}>
            {formatEur(MOCK_WALLET.lifetimeRecharged)} rechargés au total
          </Text>
        </View>
      </View>

      {/* Auto-recharge — déclenchée par WalletService.authorize() (étape 3). */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleBlock}>
            <Text style={styles.sectionTitle}>Recharge automatique</Text>
            <Text style={styles.sectionHint}>
              Sous {formatEur(MOCK_WALLET.autoRechargeThreshold)}, recharge de{' '}
              {formatEur(rechargeAmount)} déclenchée à la prochaine annonce.
            </Text>
          </View>
          <Switch
            value={autoRecharge}
            onValueChange={setAutoRecharge}
            trackColor={{ false: theme.border, true: theme.gold }}
            thumbColor="#fff"
          />
        </View>

        {autoRecharge && (
          <View style={styles.amountRow}>
            {RECHARGE_AMOUNTS.map(amount => (
              <Pressable
                key={amount}
                style={[styles.amountChip, rechargeAmount === amount && styles.amountChipActive]}
                onPress={() => setRechargeAmount(amount)}
              >
                <Text
                  style={[
                    styles.amountChipText,
                    rechargeAmount === amount && styles.amountChipTextActive,
                  ]}
                >
                  {formatEur(amount)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Historique — montants signés, sémantique par type de transaction. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Historique</Text>
        {MOCK_TRANSACTIONS.map(tx => {
          const meta = TX_META[tx.type]
          return (
            <View key={tx.id} style={styles.txRow}>
              <View style={styles.txBody}>
                <Text style={styles.txDescription} numberOfLines={1}>
                  {tx.description}
                </Text>
                <Text style={styles.txWhen}>
                  {meta.label} · {tx.quand}
                </Text>
              </View>
              <Text style={[styles.txAmount, { color: meta.color }]}>
                {meta.sign} {formatEur(tx.amountCents)}
              </Text>
            </View>
          )
        })}
      </View>

      <Text style={styles.mockNote}>Données de démonstration — branchement API à venir.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { paddingBottom: 40 },
  header: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 26, fontWeight: '800', color: theme.ink },
  headerAccent: { width: 44, height: 4, borderRadius: 2, backgroundColor: theme.gold, marginTop: 6 },

  balanceCard: {
    marginHorizontal: 16,
    backgroundColor: theme.ink,
    borderRadius: 18,
    padding: 22,
    gap: 4,
  },
  balanceLabel: { color: theme.gold, fontSize: 13, fontWeight: '600' },
  balanceValue: {
    color: '#fff',
    fontFamily: MONO,
    fontSize: 48,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  balanceFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  balanceChip: {
    color: theme.ink,
    backgroundColor: theme.gold,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  balanceMuted: { color: '#A8A29E', fontSize: 11 },

  section: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: theme.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 12,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionTitleBlock: { flex: 1, gap: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: theme.ink },
  sectionHint: { fontSize: 12, color: theme.muted, lineHeight: 17 },

  amountRow: { flexDirection: 'row', gap: 8 },
  amountChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  amountChipActive: { backgroundColor: theme.gold, borderColor: theme.gold },
  amountChipText: { fontFamily: MONO, fontSize: 13, color: theme.ink },
  amountChipTextActive: { fontWeight: '700' },

  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  txBody: { flex: 1, gap: 2 },
  txDescription: { fontSize: 13, fontWeight: '500', color: theme.ink },
  txWhen: { fontSize: 11, color: theme.muted },
  txAmount: { fontFamily: MONO, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  mockNote: { textAlign: 'center', fontSize: 11, color: theme.muted, marginTop: 20 },
})
