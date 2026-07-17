-- Fusion des paliers Essentiel (SIMPLE) et Optimisé (OPTIMIZED).
-- Les deux délivraient EXACTEMENT le même brouillon IA (aucune branche sur le
-- tier dans packages/ai) : « Optimisé » facturait le double pour un produit
-- identique. On garde une seule offre de base (SIMPLE) + Premium.
--
-- Les annonces OPTIMIZED existantes deviennent SIMPLE — même sens métier, aucune
-- perte : le brouillon reçu était le même. Réaffectation faite dans le USING,
-- avant la bascule de type (Postgres refuse de retirer une valeur d'enum en usage).
BEGIN;

CREATE TYPE "ListingTier_new" AS ENUM ('SIMPLE', 'PREMIUM');

ALTER TABLE "Listing" ALTER COLUMN "tier" TYPE "ListingTier_new"
  USING (
    CASE WHEN "tier"::text = 'OPTIMIZED' THEN 'SIMPLE' ELSE "tier"::text END
  )::"ListingTier_new";

ALTER TYPE "ListingTier" RENAME TO "ListingTier_old";
ALTER TYPE "ListingTier_new" RENAME TO "ListingTier";
DROP TYPE "ListingTier_old";

COMMIT;
