import { MissionStatus, centsToEur } from '@flipsync/core'

/**
 * Dérivations pures pour l'écran S4 « Mission » (COMMISSAIRE_PRISEUR_PLAN.md
 * §5.4). Séparées du composant pour rester testables sans rendu React Native
 * — c'est ici que les 6 états du bandeau (et « en attente de vous ») sont
 * couverts par les tests, la DoD du Lot 5. Volontairement sans dépendance à
 * ../theme (qui importe react-native) : ce module doit rester testable en
 * pur Node, sans pipeline Metro/Jest.
 */
const formatEur = (cents: number): string => `${centsToEur(cents).toFixed(2).replace('.', ',')} €`

export type BandeauTone = 'faience' | 'moutarde' | 'bouteille' | 'muted'

export interface Bandeau {
  readonly tone: BandeauTone
  readonly title: string
  readonly subtitle: string | null
}

/** Sous-ensemble de Mission utilisé par le dashboard (réponse GET /mission/*). */
export interface DashboardMission {
  status: MissionStatus
  activeBuyerCount: number
  bestOfferAmount: number | null
  pendingReason: string | null
  pendingOfferAmount: number | null
  pendingBuyerName: string | null
  soldAmount: number | null
}

/** Bandeau d'état (§5.4) — un par statut de Mission, textes exacts du plan. */
export function missionBandeau(mission: DashboardMission): Bandeau {
  switch (mission.status) {
    case MissionStatus.BROUILLON_MANDAT:
      return { tone: 'muted', title: 'Mandat en préparation', subtitle: null }

    case MissionStatus.EN_VENTE:
      return { tone: 'faience', title: 'En vente · l’IA veille', subtitle: null }

    case MissionStatus.NEGOCIATION_ACTIVE:
      return {
        tone: 'faience',
        title: 'Négociation en cours',
        subtitle:
          mission.bestOfferAmount !== null
            ? `${mission.activeBuyerCount} acheteur${mission.activeBuyerCount > 1 ? 's' : ''} · meilleure offre ${formatEur(mission.bestOfferAmount)}`
            : `${mission.activeBuyerCount} acheteur${mission.activeBuyerCount > 1 ? 's' : ''}`,
      }

    case MissionStatus.EN_ATTENTE_VALIDATION:
      return { tone: 'moutarde', title: 'En attente de vous', subtitle: null }

    case MissionStatus.VENDU:
      return {
        tone: 'bouteille',
        title: 'Vendu',
        subtitle: mission.soldAmount !== null ? `à ${formatEur(mission.soldAmount)}` : null,
      }

    case MissionStatus.MISSION_TERMINEE:
      return { tone: 'muted', title: 'Mission terminée', subtitle: null }

    case MissionStatus.SUSPENDUE:
      return { tone: 'muted', title: 'Mission suspendue', subtitle: 'L’IA ne répond plus — reprenez à tout moment.' }

    case MissionStatus.ARRETEE:
      return { tone: 'muted', title: 'Mission arrêtée', subtitle: 'La vente redevient manuelle.' }

    case MissionStatus.EXPIREE:
      return { tone: 'muted', title: 'Mission expirée', subtitle: 'Aucune vente conclue dans le délai.' }
  }
}

/** Carte « en attente de vous » — n'apparaît QUE si une validation est due (§5.4). */
export function pendingValidationSummary(mission: DashboardMission): string | null {
  if (mission.status !== MissionStatus.EN_ATTENTE_VALIDATION) return null
  const who = mission.pendingBuyerName ?? 'Un acheteur'

  switch (mission.pendingReason) {
    case 'OFFER':
      return mission.pendingOfferAmount !== null
        ? `Offre de ${who} à ${formatEur(mission.pendingOfferAmount)}`
        : `Offre de ${who}`
    case 'OFFER_AT_FLOOR':
      return `Offre à ${mission.pendingOfferAmount !== null ? formatEur(mission.pendingOfferAmount) : 'votre prix mini'} — au prix mini`
    case 'COMPLEX_CASE':
      return `${who} : cas hors mandat`
    case 'SECURITY_ALERT':
      return `${who} tente de sortir du circuit sécurisé`
    default:
      return 'Validation requise'
  }
}

/** Écran serein (§5.4) : pas de validation en attente ET aucune activité encore. */
export function isDashboardCalm(mission: DashboardMission, eventCount: number): boolean {
  return mission.status === MissionStatus.EN_VENTE && eventCount === 0
}
