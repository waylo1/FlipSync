import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@flipsync/db'
import { PaymentSource } from '@flipsync/core'
import { WalletService } from './wallet.service'
import {
  AlreadyCommittedError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidListingStateError,
  InvalidPaymentSourceError,
  NoFreeCreditError,
  NothingToRefundError,
  WalletNotFoundError,
} from './errors'

// ─── Fake Prisma en mémoire ───────────────────────────────────────────────────
// Reproduit les seules opérations utilisées par WalletService, y compris la
// sémantique updateMany+guard (count=0 si la condition échoue).

interface FakeWallet {
  id: string
  userId: string
  balance: number // centimes
  freeListingsRemaining: number
  /** Échéance du reset mensuel — future par défaut (pas de reset dans les tests nominaux). */
  freeListingsResetAt: Date
  autoRechargeEnabled: boolean
  autoRechargeAmount: number // centimes
}

interface FakeListing {
  id: string
  userId: string
  tier: string
  status: string
  paymentSource: string
  cost: number // centimes
}

interface FakeTransaction {
  id: string
  walletId: string
  type: string
  amount: number // centimes
  source: string
  listingId: string | null
  description: string | null
}

interface FakeState {
  wallet: FakeWallet | null
  listing: FakeListing | null
  transactions: FakeTransaction[]
}

const makeFakePrisma = (state: FakeState): PrismaClient => {
  let txSeq = 0

  const client = {
    userWallet: {
      findUnique: async ({ where }: { where: { userId?: string; id?: string } }) =>
        state.wallet &&
        ((where.userId && state.wallet.userId === where.userId) ||
          (where.id && state.wallet.id === where.id))
          ? { ...state.wallet }
          : null,
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string
          balance?: { gte: number }
          freeListingsRemaining?: { gt: number }
          freeListingsResetAt?: Date
        }
        data: {
          balance?: { decrement: number }
          freeListingsRemaining?: { decrement: number } | number
          freeListingsResetAt?: Date
        }
      }) => {
        const w = state.wallet
        if (!w || w.id !== where.id) return { count: 0 }
        if (where.balance && !(w.balance >= where.balance.gte)) return { count: 0 }
        if (
          where.freeListingsRemaining &&
          !(w.freeListingsRemaining > where.freeListingsRemaining.gt)
        )
          return { count: 0 }
        // Guard du reset paresseux : conditionné sur l'échéance exacte lue.
        if (
          where.freeListingsResetAt &&
          w.freeListingsResetAt.getTime() !== where.freeListingsResetAt.getTime()
        )
          return { count: 0 }
        if (data.balance) w.balance -= data.balance.decrement
        if (typeof data.freeListingsRemaining === 'number') {
          w.freeListingsRemaining = data.freeListingsRemaining
        } else if (data.freeListingsRemaining) {
          w.freeListingsRemaining -= data.freeListingsRemaining.decrement
        }
        if (data.freeListingsResetAt) w.freeListingsResetAt = data.freeListingsResetAt
        return { count: 1 }
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: {
          balance?: { increment: number }
          freeListingsRemaining?: { increment: number }
        }
      }) => {
        const w = state.wallet
        if (!w || w.id !== where.id) throw new Error('RECORD_NOT_FOUND')
        if (data.balance) w.balance += data.balance.increment
        if (data.freeListingsRemaining)
          w.freeListingsRemaining += data.freeListingsRemaining.increment
        return { ...w }
      },
    },
    listing: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.listing && state.listing.id === where.id ? { ...state.listing } : null,
    },
    walletTransaction: {
      findFirst: async ({
        where,
      }: {
        where: { listingId: string; type: string }
      }) =>
        state.transactions.find(
          t => t.listingId === where.listingId && t.type === where.type,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: Omit<FakeTransaction, 'id' | 'listingId' | 'description'> & {
          listingId?: string
          description?: string
        }
      }) => {
        const created: FakeTransaction = {
          id: `tx_${++txSeq}`,
          walletId: data.walletId,
          type: data.type,
          amount: data.amount,
          source: data.source,
          listingId: data.listingId ?? null,
          description: data.description ?? null,
        }
        state.transactions.push(created)
        return created
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
  }

  return client as unknown as PrismaClient
}

const IN_ONE_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

const baseWallet = (over: Partial<FakeWallet> = {}): FakeWallet => ({
  id: 'w1',
  userId: 'u1',
  balance: 0,
  freeListingsRemaining: 0,
  freeListingsResetAt: IN_ONE_MONTH,
  autoRechargeEnabled: false,
  autoRechargeAmount: 1000,
  ...over,
})

const baseListing = (over: Partial<FakeListing> = {}): FakeListing => ({
  id: 'l1',
  userId: 'u1',
  tier: 'SIMPLE',
  status: 'USER_VALIDATED',
  paymentSource: 'WALLET',
  cost: 250,
  ...over,
})

// ─── authorize() ──────────────────────────────────────────────────────────────

describe('WalletService.authorize', () => {
  it('priorité 1 — FREE_CREDIT si freeListingsRemaining > 0, cost projeté 0, aucun débit', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 500, freeListingsRemaining: 2 }),
      listing: null,
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    const res = await svc.authorize('u1', 250)

    expect(res.authorized).toBe(true)
    expect(res.source).toBe(PaymentSource.FREE_CREDIT)
    expect(res.cost).toBe(0)
    expect(res.freeCreditsRemaining).toBe(2)
    expect(res.walletBalanceBefore).toBe(500)
    expect(res.walletBalanceAfter).toBe(500)
    // Lecture seule : rien n'a bougé en "base"
    expect(state.wallet?.balance).toBe(500)
    expect(state.wallet?.freeListingsRemaining).toBe(2)
    expect(state.transactions).toHaveLength(0)
  })

  it('priorité 2 — WALLET si balance >= cost, balance projetée correcte', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 300 }),
      listing: null,
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    const res = await svc.authorize('u1', 250)

    expect(res).toMatchObject({
      authorized: true,
      source: PaymentSource.WALLET,
      cost: 250,
      walletBalanceBefore: 300,
      walletBalanceAfter: 50,
    })
    expect(state.wallet?.balance).toBe(300) // aucun débit à l'autorisation
  })

  it('priorité 3 — BLOCKED avec deficit exact en centimes (auto-recharge retirée, F2 — recharge manuelle MVP)', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 100 }),
      listing: null,
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    const res = await svc.authorize('u1', 250)

    expect(res.authorized).toBe(false)
    expect(res.source).toBe(PaymentSource.BLOCKED)
    expect(res.deficit).toBe(150)
    expect(res.walletBalanceAfter).toBe(100)
  })

  it('reset paresseux — échéance passée : quota restauré à 3 et FREE_CREDIT prime', async () => {
    const past = new Date(Date.now() - 1000)
    const state: FakeState = {
      wallet: baseWallet({ balance: 500, freeListingsRemaining: 0, freeListingsResetAt: past }),
      listing: null,
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    const res = await svc.authorize('u1', 250)

    expect(res.source).toBe(PaymentSource.FREE_CREDIT)
    expect(res.freeCreditsRemaining).toBe(3)
    expect(state.wallet?.freeListingsRemaining).toBe(3)
    expect(state.wallet && state.wallet.freeListingsResetAt.getTime()).toBeGreaterThan(Date.now())
  })

  describe('31 janvier — pas de débordement sur mars (fix F9)', () => {
    beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-01-31T10:00:00.000Z')))
    afterEach(() => vi.useRealTimers())

    it('ancre le prochain reset au 1er février, jamais au 3 mars', async () => {
      const past = new Date('2026-01-01T00:00:00.000Z') // échéance déjà dépassée
      const state: FakeState = {
        wallet: baseWallet({ balance: 500, freeListingsRemaining: 0, freeListingsResetAt: past }),
        listing: null,
        transactions: [],
      }
      const svc = new WalletService(makeFakePrisma(state))

      await svc.authorize('u1', 250)

      const next = state.wallet?.freeListingsResetAt
      expect(next?.getMonth()).toBe(1) // février (0-indexé) — jamais mars
      expect(next?.getDate()).toBe(1)
    })
  })

  it('rejette un montant non entier (jamais de Float monétaire)', async () => {
    const svc = new WalletService(
      makeFakePrisma({ wallet: baseWallet(), listing: null, transactions: [] }),
    )
    await expect(svc.authorize('u1', 2.5)).rejects.toBeInstanceOf(InvalidAmountError)
    await expect(svc.authorize('u1', -100)).rejects.toBeInstanceOf(InvalidAmountError)
  })

  it('rejette si wallet inexistant', async () => {
    const svc = new WalletService(
      makeFakePrisma({ wallet: null, listing: null, transactions: [] }),
    )
    await expect(svc.authorize('u1', 250)).rejects.toBeInstanceOf(WalletNotFoundError)
  })
})

// ─── commit() ─────────────────────────────────────────────────────────────────

describe('WalletService.commit', () => {
  it('débite le wallet du coût exact et journalise un DEBIT', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 300 }),
      listing: baseListing({ paymentSource: 'WALLET', cost: 250 }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.commit('l1')

    expect(state.wallet?.balance).toBe(50)
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({
      type: 'DEBIT',
      amount: 250,
      source: 'WALLET',
      listingId: 'l1',
    })
  })

  it('consomme un crédit gratuit (amount 0) si FREE_CREDIT', async () => {
    const state: FakeState = {
      wallet: baseWallet({ freeListingsRemaining: 3, balance: 0 }),
      listing: baseListing({ paymentSource: 'FREE_CREDIT', cost: 0 }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.commit('l1')

    expect(state.wallet?.freeListingsRemaining).toBe(2)
    expect(state.wallet?.balance).toBe(0)
    expect(state.transactions[0]).toMatchObject({ type: 'DEBIT', amount: 0, source: 'FREE_CREDIT' })
  })

  it('refuse le commit avant USER_VALIDATED (machine à états stricte)', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 300 }),
      listing: baseListing({ status: 'DRAFT_READY' }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await expect(svc.commit('l1')).rejects.toBeInstanceOf(InvalidListingStateError)
    expect(state.wallet?.balance).toBe(300)
    expect(state.transactions).toHaveLength(0)
  })

  it('est idempotent : un second commit lève ALREADY_COMMITTED sans double débit', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 500 }),
      listing: baseListing({ cost: 250 }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.commit('l1')
    await expect(svc.commit('l1')).rejects.toBeInstanceOf(AlreadyCommittedError)

    expect(state.wallet?.balance).toBe(250) // un seul débit
    expect(state.transactions).toHaveLength(1)
  })

  it('refuse si fonds insuffisants au moment du commit', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 100 }),
      listing: baseListing({ cost: 250 }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await expect(svc.commit('l1')).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(state.wallet?.balance).toBe(100)
  })

  it('refuse si plus de crédit gratuit au moment du commit FREE_CREDIT', async () => {
    const state: FakeState = {
      wallet: baseWallet({ freeListingsRemaining: 0 }),
      listing: baseListing({ paymentSource: 'FREE_CREDIT' }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await expect(svc.commit('l1')).rejects.toBeInstanceOf(NoFreeCreditError)
  })

  it('refuse une source non débitable (BLOCKED)', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 500 }),
      listing: baseListing({ paymentSource: 'BLOCKED' }),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await expect(svc.commit('l1')).rejects.toBeInstanceOf(InvalidPaymentSourceError)
  })
})

// ─── refund() ─────────────────────────────────────────────────────────────────

describe('WalletService.refund', () => {
  it('recrédite le montant exact du DEBIT et journalise un REFUND', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 50 }),
      listing: baseListing(),
      transactions: [
        {
          id: 'tx_1',
          walletId: 'w1',
          type: 'DEBIT',
          amount: 250,
          source: 'WALLET',
          listingId: 'l1',
          description: null,
        },
      ],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.refund('l1', 'PUBLISH_FAILED')

    expect(state.wallet?.balance).toBe(300)
    expect(state.transactions).toHaveLength(2)
    expect(state.transactions[1]).toMatchObject({
      type: 'REFUND',
      amount: 250,
      listingId: 'l1',
      description: 'PUBLISH_FAILED',
    })
  })

  it('restitue le crédit gratuit si le DEBIT était FREE_CREDIT', async () => {
    const state: FakeState = {
      wallet: baseWallet({ freeListingsRemaining: 2 }),
      listing: baseListing({ paymentSource: 'FREE_CREDIT' }),
      transactions: [
        {
          id: 'tx_1',
          walletId: 'w1',
          type: 'DEBIT',
          amount: 0,
          source: 'FREE_CREDIT',
          listingId: 'l1',
          description: null,
        },
      ],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.refund('l1', 'AI_FAILED')

    expect(state.wallet?.freeListingsRemaining).toBe(3)
    expect(state.transactions[1]).toMatchObject({ type: 'REFUND', amount: 0, source: 'FREE_CREDIT' })
  })

  it('est idempotent : un second refund est un no-op (pas de double crédit)', async () => {
    const state: FakeState = {
      wallet: baseWallet({ balance: 50 }),
      listing: baseListing(),
      transactions: [
        {
          id: 'tx_1',
          walletId: 'w1',
          type: 'DEBIT',
          amount: 250,
          source: 'WALLET',
          listingId: 'l1',
          description: null,
        },
      ],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await svc.refund('l1', 'AI_FAILED')
    await svc.refund('l1', 'AI_FAILED')

    expect(state.wallet?.balance).toBe(300) // un seul remboursement
    expect(state.transactions.filter(t => t.type === 'REFUND')).toHaveLength(1)
  })

  it('lève NOTHING_TO_REFUND si aucun débit préalable', async () => {
    const state: FakeState = {
      wallet: baseWallet(),
      listing: baseListing(),
      transactions: [],
    }
    const svc = new WalletService(makeFakePrisma(state))

    await expect(svc.refund('l1', 'AI_FAILED')).rejects.toBeInstanceOf(NothingToRefundError)
  })
})
