import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Receipt } from 'lucide-react-native'
import { TransactionType } from '@flipsync/core'
import { ApiTransaction, api } from '../../src/services/api'
import { useAuthStore } from '../../src/store/auth.store'
import { useApiResource } from '../../src/hooks/useApiResource'
import { formatRelativeFr } from '../../src/lib/time'
import { font, formatEur, line, radius, shadow, space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { Avatar } from '../../src/ui/Avatar'
import { Card } from '../../src/ui/Card'
import { AmountText } from '../../src/ui/AmountText'
import { ErrorBanner } from '../../src/ui/ErrorBanner'
import { EmptyState } from '../../src/ui/EmptyState'
import { Skeleton } from '../../src/ui/Skeleton'

/** Sémantique des mouvements : crédits en bouteille, débits en encre, signe explicite. */
const TX_META: Readonly<Record<TransactionType, { sign: '+' | '−'; color: string; label: string }>> = {
  [TransactionType.CREDIT]: { sign: '+', color: theme.bouteille, label: 'Recharge' },
  [TransactionType.BONUS]: { sign: '+', color: theme.goldDark, label: 'Bonus' },
  [TransactionType.REFUND]: { sign: '+', color: theme.bouteille, label: 'Remboursement' },
  [TransactionType.DEBIT]: { sign: '−', color: theme.ink, label: 'Débit' },
}

function TransactionLine({ tx }: { tx: ApiTransaction }) {
  const meta = TX_META[tx.type]
  const description = tx.description ?? meta.label
  const quand = formatRelativeFr(tx.createdAt)
  return (
    <View
      style={styles.txRow}
      accessibilityLabel={`${meta.label}, ${description}, ${meta.sign === '+' ? 'plus' : 'moins'} ${formatEur(tx.amount)}, ${quand}`}
    >
      <View style={styles.txBody}>
        <Text style={styles.txDescription} numberOfLines={1}>
          {description}
        </Text>
        <Text style={styles.txWhen}>
          {meta.label} · {quand}
        </Text>
      </View>
      <AmountText cents={tx.amount} sign={meta.sign} size={font.body} color={meta.color} />
    </View>
  )
}

export default function WalletScreen() {
  const router = useRouter()
  const email = useAuthStore(s => s.email)
  const wallet = useApiResource(api.getWallet)
  const transactions = useApiResource(api.getTransactions)

  const refreshing = wallet.refreshing || transactions.refreshing
  const refreshAll = () => {
    void wallet.refresh()
    void transactions.refresh()
  }
  const retryAll = () => {
    wallet.retry()
    transactions.retry()
  }
  const error = wallet.error ?? transactions.error

  const w = wallet.data

  return (
    <View style={styles.screen}>
      {/* Fixe au-dessus du scroll (cohérent avec Home) : ne défile jamais sous
          la barre système. */}
      <ScreenHeader
        title="Ma cagnotte"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mon profil"
            onPress={() => router.push('/profile')}
            hitSlop={space[2]}
            style={({ pressed }) => pressed && styles.avatarPressed}
          >
            <Avatar email={email} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={theme.goldDark}
            colors={[theme.goldDark]}
          />
        }
      >
      {error !== null && (
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={
              error === 'NETWORK_ERROR'
                ? 'Impossible de joindre le serveur — vérifiez votre connexion.'
                : `Chargement impossible (${error}).`
            }
            onRetry={retryAll}
          />
        </View>
      )}

      {/* Solde — toujours en centimes côté données, euros à l'affichage seulement. */}
      {w === null ? (
        wallet.error === null && (
          <View style={styles.bannerWrap}>
            <Skeleton height={space[8] + space[8]} round="lg" />
          </View>
        )
      ) : (
        <View
          style={styles.balanceCard}
          accessibilityLabel={`Solde disponible : ${formatEur(w.balance)}`}
        >
          <Text style={styles.balanceLabel}>Solde disponible</Text>
          <AmountText cents={w.balance} size={font.balance} color={theme.onDark} />
          <View style={styles.balanceFooter}>
            <Text style={styles.balanceMuted}>
              {formatEur(w.lifetimeRecharged)} rechargés au total
            </Text>
          </View>
        </View>
      )}

      {/* Historique — montants signés, sémantique par type de transaction. */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Historique</Text>
        {transactions.data === null ? (
          transactions.error === null && (
            <View style={styles.txSkeletons}>
              <Skeleton height={space[6]} />
              <Skeleton height={space[6]} />
            </View>
          )
        ) : transactions.data.transactions.length === 0 ? (
          <EmptyState
            icon={<Receipt size={space[6]} color={theme.goldDark} />}
            title="Aucun mouvement"
            body="Vos débits, recharges et remboursements apparaîtront ici."
          />
        ) : (
          transactions.data.transactions.map(tx => <TransactionLine key={tx.id} tx={tx} />)
        )}
      </Card>

      {/* Auto-recharge — réglage serveur (WalletService.authorize, étape 3), lecture
          seule (aucun endpoint de modification). Volontairement discrète : c'est un
          réglage de fond, pas une information que l'utilisateur vient chercher ici. */}
      {w !== null && (
        <View style={styles.autoRow}>
          <Text style={styles.autoLabel} numberOfLines={2}>
            Recharge automatique —{' '}
            {w.autoRechargeEnabled
              ? `sous ${formatEur(w.autoRechargeThreshold)}, +${formatEur(w.autoRechargeAmount)}`
              : 'désactivée'}
          </Text>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel="Recharge automatique (réglage en lecture seule)"
            accessibilityState={{ checked: w.autoRechargeEnabled, disabled: true }}
            value={w.autoRechargeEnabled}
            disabled
            trackColor={{ false: theme.border, true: theme.gold }}
            thumbColor={theme.card}
          />
        </View>
      )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { paddingBottom: space[6] },
  bannerWrap: { marginHorizontal: space[4], marginBottom: space[3] },

  balanceCard: {
    marginHorizontal: space[4],
    backgroundColor: theme.bouteille,
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[2],
    ...shadow.sheet,
  },
  balanceLabel: { color: theme.bouteilleSoft, fontSize: font.small, fontWeight: '600' },
  balanceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    marginTop: space[3],
  },
  balanceMuted: { color: theme.onDarkMuted, fontSize: font.caption, flexShrink: 1 },

  section: { marginHorizontal: space[4], marginTop: space[4], gap: space[3] },
  // Titre de section un cran au-dessus du contenu (hiérarchie taille + poids).
  sectionTitle: { fontSize: font.lead, fontWeight: '700', color: theme.ink },

  // Réglage secondaire (lecture seule) : une ligne discrète, jamais une Card
  // pleine — ne doit pas rivaliser visuellement avec le solde ou l'historique.
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginHorizontal: space[4],
    marginTop: space[5],
  },
  autoLabel: { flex: 1, fontSize: font.caption, lineHeight: line.caption, color: theme.muted },

  avatarPressed: { opacity: 0.7 },
  txSkeletons: { gap: space[2] },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: space[6] + space[2],
  },
  txBody: { flex: 1, gap: space[1] / 2 },
  txDescription: { fontSize: font.small, lineHeight: line.small, fontWeight: '500', color: theme.ink },
  txWhen: { fontSize: font.caption, color: theme.muted },
})
