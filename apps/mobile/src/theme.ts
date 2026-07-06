import { Easing, Platform, ViewStyle } from 'react-native'
import { ListingStatus, centsToEur } from '@flipsync/core'

/**
 * Thème FlipSync — identité « Vide-Grenier Chaleureux ».
 * SEULE source de style : couleur, espacement, rayon, ombre, motion, typo.
 * Aucune valeur en dur dans les écrans (gate G1/G2 — flipsync-fe-contract.md).
 */
export const theme = {
  // Neutres papier (existant conservé)
  gold: '#C8A96E', // laiton chiné — accent DÉCORATIF (fonds, jauges, texte sur ink uniquement)
  goldDark: '#8A6A38', // laiton lisible — seul laiton autorisé en TEXTE sur fond clair (≥4.5:1)
  goldSoft: '#F5EDDE',
  ink: '#1C1917',
  paper: '#FAF9F7',
  card: '#FFFFFF',
  muted: '#6A635D', // texte secondaire — ≥5:1 sur paper ET card (AA même en 12 px)
  border: '#E7E5E4',

  // Palette vide-grenier
  terracotta: '#B8542F', // action principale
  terracottaDark: '#9A4325',
  terracottaSoft: '#F7E7DF',
  bouteille: '#3E6B4F', // succès, en ligne, crédits
  bouteilleSoft: '#E2EDE4',
  moutarde: '#8A5A0F', // attente, vigilance
  moutardeSoft: '#F6E8CC',
  moutardeBorder: '#D9A94A',
  faience: '#3F5E8C', // traitement en cours
  faienceSoft: '#E3EAF4',
  brique: '#A63D2F', // échec — TOUJOURS accompagné du remboursement
  briqueSoft: '#F7E4DF',
  kraft: '#EFE6D8', // fonds chinés
  krafInk: '#6B5F4F',
  onDark: '#FFFFFF', // texte sur fonds sombres (ink, terracotta, scrim)
  onDarkMuted: '#A8A29E',
  scrim: 'rgba(28, 25, 23, 0.78)', // voile sur caméra
  scrimBrique: 'rgba(122, 38, 25, 0.88)',
} as const

/** Grille d'espacement stricte {4,8,12,16,24,32,48,64} — gate G2. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 } as const

/**
 * Rayons — angles doux, jamais coupants. Usage sémantique par niveau :
 * xs = jauges/segments, sm = vignettes, md = cartes internes/bandeaux,
 * lg = surfaces d'écran (solde, sheets), pill = chips + contrôles circulaires.
 */
export const radius = { xs: 4, sm: 8, md: 12, lg: 16, pill: 999 } as const

/** Ombres « papier posé sur l'étal » — diffuses, jamais de glow coloré. */
export const shadow: Readonly<Record<'surface' | 'card' | 'sheet', ViewStyle>> = {
  surface: {
    shadowColor: theme.ink,
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  card: {
    shadowColor: theme.ink,
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: theme.ink,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
}

/** Motion — decelerate à l'entrée, accelerate à la sortie, jamais linear spatial. */
export const motion = {
  dur: { fast: 120, base: 200, slow: 320 },
  ease: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    decelerate: Easing.bezier(0, 0, 0, 1),
    accelerate: Easing.bezier(0.3, 0, 1, 1),
  },
} as const

/** Échelle typo — corps ≥ 15 (l'app parle à tout le monde). */
export const font = {
  caption: 12,
  small: 13,
  body: 15,
  lead: 16,
  title: 20,
  heading: 26,
  display: 32,
  balance: 48,
} as const

/**
 * Interlignages appariés à l'échelle typo (≈1.5 sur le corps, WCAG lisibilité).
 * Tout Text multi-lignes DOIT porter le line du cran utilisé — jamais de
 * lineHeight dérivé (space[x] + space[y]).
 */
export const line = {
  caption: 18,
  small: 20,
  body: 22,
  lead: 24,
  title: 28,
  heading: 34,
} as const

/** Cible tactile minimale 44 pt (a11y) — appliquer aux petits contrôles. */
export const MIN_TOUCH = 44

/** Police monospace native (soldes, prix) — tabular pour l'alignement. */
export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

/** Affichage français : 2350 → "23,50 €". Centimes Int uniquement en entrée. */
export const formatEur = (cents: number): string =>
  `${centsToEur(cents).toFixed(2).replace('.', ',')} €`

interface StatusMeta {
  /** Libellé utilisateur (français simple). */
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
 * Moutarde = attente, faïence = en cours, laiton = action utilisateur,
 * bouteille = succès, brique = échec (remboursement dit), kraft = terminal neutre.
 */
export const STATUS_META: Readonly<Record<ListingStatus, StatusMeta>> = {
  [ListingStatus.PENDING_AUTH]: {
    label: 'En attente de paiement',
    fg: theme.moutarde,
    bg: theme.moutardeSoft,
    step: 1,
    terminal: false,
  },
  [ListingStatus.AUTHORIZED]: {
    label: 'Réservée — rien n’est débité',
    fg: theme.faience,
    bg: theme.faienceSoft,
    step: 2,
    terminal: false,
  },
  [ListingStatus.AI_PROCESSING]: {
    label: 'Analyse en cours…',
    fg: theme.faience,
    bg: theme.faienceSoft,
    step: 3,
    terminal: false,
  },
  [ListingStatus.AI_FAILED]: {
    label: 'Analyse échouée — rien n’est débité',
    fg: theme.brique,
    bg: theme.briqueSoft,
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
    label: 'Validée et payée',
    fg: theme.bouteille,
    bg: theme.bouteilleSoft,
    step: 5,
    terminal: false,
  },
  [ListingStatus.USER_CANCELLED]: {
    label: 'Annulée — rien n’est débité',
    fg: theme.krafInk,
    bg: theme.kraft,
    step: null,
    terminal: true,
  },
  [ListingStatus.QUEUED]: {
    label: 'Publication en cours',
    fg: theme.faience,
    bg: theme.faienceSoft,
    step: 6,
    terminal: false,
  },
  [ListingStatus.PUBLISH_FAILED]: {
    label: 'Échec publication — remboursée',
    fg: theme.brique,
    bg: theme.briqueSoft,
    step: null,
    terminal: true,
  },
  [ListingStatus.PUBLISHED]: {
    label: 'En ligne',
    fg: theme.bouteille,
    bg: theme.bouteilleSoft,
    step: 7,
    terminal: false,
  },
  [ListingStatus.EXPIRED]: {
    label: 'Expirée',
    fg: theme.krafInk,
    bg: theme.kraft,
    step: null,
    terminal: true,
  },
}
