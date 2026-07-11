import { MissionStatus, PrismaClient } from '@flipsync/db'
import { SellMandate, isMandateValid } from '@flipsync/core'

/** Erreur métier — code SNAKE_CASE mappé en HTTP par l'error-handler. */
export class MissionError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'MissionError'
  }
}

/**
 * MissionService — stub serveur du Lot 3 (COMMISSAIRE_PRISEUR_PLAN.md §10).
 * Persiste le mandat confirmé côté mobile (S1→S3) et fait franchir la
 * transition BROUILLON_MANDAT → EN_VENTE. Aucune négociation ici : le canal
 * simulé (`NegotiationChannel`) arrive au Lot 4, cette méthode ne fait que
 * démarrer la mission.
 */
export class MissionService {
  constructor(private readonly prisma: PrismaClient) {}

  async confirmMandate(userId: string, listingId: string, mandate: SellMandate) {
    if (!isMandateValid(mandate)) throw new MissionError('INVALID_MANDATE')

    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, userId } })
    if (!listing) throw new MissionError('LISTING_NOT_FOUND')

    const existing = await this.prisma.mission.findUnique({ where: { listingId } })
    if (existing) throw new MissionError('ALREADY_COMMITTED')

    const mission = await this.prisma.mission.create({
      data: {
        userId,
        listingId,
        status: MissionStatus.BROUILLON_MANDAT,
        posture: mandate.posture,
        objectif: mandate.objectif,
        prixAffiche: mandate.prixAffiche,
        prixMini: mandate.prixMini,
        livraison: mandate.livraison,
        casComplexes: mandate.casComplexes,
        autoAdjugeAuDessusDuMini: mandate.autoAdjugeAuDessusDuMini,
      },
    })

    return this.activate(mission.id)
  }

  /** BROUILLON_MANDAT → EN_VENTE — stub : aucun appel marketplace ici (cf. PublicationService pour le listing). */
  private async activate(missionId: string) {
    return this.prisma.mission.update({
      where: { id: missionId },
      data: { status: MissionStatus.EN_VENTE, enVenteAt: new Date() },
    })
  }
}
