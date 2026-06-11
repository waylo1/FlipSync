import { Platform } from 'react-native'
import { ListingStatus, centsToEur } from '@flipsync/core'

/** Thème FlipSync — accent or #C8A96E, neutres chauds. */
export const theme = {
  gold: '#C8A96E',
  goldDark: '#A8854B',
  goldSoft: '#F5EDDE',
  ink: '#1C1917',
  paper: '#FAF9F7',
  card: '#FFFFFF',
  muted: '#78716C',
  border: '#E7E5E4',
} as const

/** Police monospace native (soldes, prix) — tabular pour l'alignement. */
export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

/** Affichage français : 2350 → "23,50 €". Centimes Int uniquement en entrée. */
export const formatEur = (cents: number): string =>
  `${centsToEur(cents).toFixed(2).replace('.', ',')} €`

interface StatusMeta {
  /** Libellé utilisateur (français). */
  label: string
  /** Couleur sémantique du badge (texte) et fond assorti. */
  fg: string
  bg: string
  /**
   * Position dans le pipeline nominal (1..7) — null pour les états
   * d'échec/terminaux hors pipeline (rail de progression masqué ou plein).
   */
  step: number | null
  /** true si l'état est définitif (aucune transition possible). */
  terminal: boolean
}

export const PIPELINE_STEPS = 7

/**
 * Sémantique visuelle des 11 états de la machine ListingStatus.
 * Ambre = attente, bleu/violet/indigo = en cours, or = action utilisateur,
 * vert = succès, rouge = échec, gris = terminal neutre.
 */
export const STATUS_META: Readonly<Record<ListingStatus, StatusMeta>> = {
  [ListingStatus.PENDING_AUTH]: {
    label: 'En attente de paiement',
    fg: '#B45309',
    bg: '#FEF3C7',
    step: 1,
    terminal: false,
  },
  [ListingStatus.AUTHORIZED]: {
    label: 'Autorisée',
    fg: '#1D4ED8',
    bg: '#DBEAFE',
    step: 2,
    terminal: false,
  },
  [ListingStatus.AI_PROCESSING]: {
    label: 'Analyse IA…',
    fg: '#6D28D9',
    bg: '#EDE9FE',
    step: 3,
    terminal: false,
  },
  [ListingStatus.AI_FAILED]: {
    label: 'Échec IA',
    fg: '#B91C1C',
    bg: '#FEE2E2',
    step: null,
    terminal: true,
  },
  [ListingStatus.DRAFT_READY]: {
    label: 'À valider',
    fg: theme.goldDark,
    bg: theme.goldSoft,
    step: 4,
    terminal: false,
  },
  [ListingStatus.USER_VALIDATED]: {
    label: 'Validée',
    fg: '#0F766E',
    bg: '#CCFBF1',
    step: 5,
    terminal: false,
  },
  [ListingStatus.USER_CANCELLED]: {
    label: 'Annulée',
    fg: '#57534E',
    bg: '#F5F5F4',
    step: null,
    terminal: true,
  },
  [ListingStatus.QUEUED]: {
    label: 'File de publication',
    fg: '#4338CA',
    bg: '#E0E7FF',
    step: 6,
    terminal: false,
  },
  [ListingStatus.PUBLISH_FAILED]: {
    label: 'Échec publication — remboursée',
    fg: '#B91C1C',
    bg: '#FEE2E2',
    step: null,
    terminal: true,
  },
  [ListingStatus.PUBLISHED]: {
    label: 'En ligne',
    fg: '#15803D',
    bg: '#DCFCE7',
    step: 7,
    terminal: false,
  },
  [ListingStatus.EXPIRED]: {
    label: 'Expirée',
    fg: '#57534E',
    bg: '#F5F5F4',
    step: null,
    terminal: true,
  },
}
