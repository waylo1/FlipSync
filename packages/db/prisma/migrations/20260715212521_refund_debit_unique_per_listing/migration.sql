-- P-06 : atomicité stricte refund/debit — un listing a au plus 1 DEBIT et 1 REFUND.
-- NULL non contraint par Postgres (BONUS/RECHARGE, listingId absent), sans effet sur eux.
CREATE UNIQUE INDEX "WalletTransaction_listingId_type_key" ON "WalletTransaction"("listingId", "type");
