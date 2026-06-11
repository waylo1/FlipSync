import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Ré-export du client Prisma généré : types des modèles + enums.
// Les enums Prisma (ListingStatus, PaymentSource, …) sont la source de vérité,
// reflétée à l'identique par @flipsync/core.
export * from '@prisma/client'
