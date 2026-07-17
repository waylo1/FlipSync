# GO-LIVE — FlipSync v1 sur le Play Store

> Runbook d'exécution vers la mise en ligne. Mode de travail acté le 2026-07-17 :
> Claude pilote (CTO/Lead), Maxime n'intervient que pour l'argent, le juridique,
> le produit et les actions qu'il est seul à pouvoir faire. Complète
> DISTRIBUTION.md (mécanique de build) et ROADMAP_2_6_MONTHS.md (après-lancement).

## Périmètre v1 (figé)

Une seule offre : **« Annonce IA » à 0,99 €** (photo → titre + description +
estimation de prix), 3 annonces gratuites/mois, cagnotte Stripe. Diffusion
**manuelle** (kit copier-coller + deep links — aucun accès partenaire requis).
Premium (commissaire-priseur) **hors-vente** : `PREMIUM_TIER_ENABLED=false`
(core), garde API `TIER_DISABLED` — règle COMMISSAIRE_PRISEUR_PLAN §10.0.
Apple : différé (99 $/an récurrents, à revoir une fois l'app en ligne sur Android).

## Décisions techniques (CTO — justification courte)

| Décision | Choix | Pourquoi |
|---|---|---|
| Hébergeur API | **Railway** (région UE) | Dockerfile déjà prêt, deploy Git en 2 clics, pas de veille serveur (les magic links et jobs IA ne tolèrent pas un hébergeur qui s'endort), ~5 $/mois. Alternative documentée : Fly.io (Paris). |
| Base de données | **Supabase EU** | Déjà dans la stack (schema.prisma, DIRECT_URL), gratuit au départ. |
| IA production | **API Anthropic** (Haiku) | Décidé 2026-07-15 ; backend commité (`createVisionBackend`), ~0,5 c€/annonce. |
| Email | **Resend** | `TransactionalEmailService` déjà écrit pour son API. Domaine requis pour la délivrabilité. |
| Pages légales | **Servies par l'API** (`/legal/privacy`, `/legal/cgv`) | Même domaine, zéro hébergement de plus, URL exigée par Play. |
| Domaine | **flipsync.fr** (à acheter, non enregistré au 2026-07-17) | eas.json pointe déjà sur api.flipsync.fr ; requis pour Resend. |
| Compte Play | **Organisation** via DUNS micro-entreprise | Exempte des 12 testeurs / 14 jours. Repli : compte personnel + 12 testeurs. |

## Phases

### Phase 0 — Code prêt pour la prod ✅ (2026-07-17)
- [x] Backend IA Anthropic + sélecteur (refus de boot en prod sans clé) — `e7fd6b3`
- [x] Kit manuel canaux non connectés (mode nominal v1) — `72c1165`
- [x] Fusion des offres, « Annonce IA » 0,99 € — `57e8689`
- [x] Premium hors-vente (garde API + mobile + test)
- [x] Pages légales publiques + test contrat
- DoD : tests api/ai/wallet/core verts, typecheck propre, CI verte.

### Phase 1 — Comptes & infra (actions Maxime + config Claude)
- [ ] MAXIME : demande DUNS (gratuit, ~5 j) — le plus long délai, à lancer en premier
- [ ] MAXIME : achat flipsync.fr (~8 €/an)
- [ ] MAXIME : clé Anthropic, activation Stripe, comptes Railway/Supabase/Resend
- [ ] MAXIME : dénomination + SIRET + adresse + email contact (placeholders légaux)
- [ ] CLAUDE : config Railway (Dockerfile, env, domaine api.flipsync.fr), migrations
      Supabase, DNS Resend, webhook Stripe → `https://api.flipsync.fr/stripe/webhook`
- DoD : `GET https://api.flipsync.fr/health` = ok, magic link reçu par email réel,
  `/legal/privacy` en ligne, webhook Stripe `succeeded` crédite un wallet de test.

### Phase 2 — Paiement in-app + build
- [ ] CLAUDE : Payment Sheet (@stripe/stripe-react-native + plugin app.json,
      clé publiable via env EAS) — le bouton Recharger ouvre la feuille native
- [ ] CLAUDE : `eas build --profile preview` (APK) → MAXIME : test sur son téléphone
      (parcours complet : login email, photo → annonce, recharge test, kit manuel)
- [ ] CLAUDE : build production (AAB)
- DoD : recharge test de bout en bout sur device (carte test 4242…), zéro crash.

### Phase 3 — Play Store
- [ ] MAXIME : compte Play Console Organisation (25 $, DUNS reçu)
- [ ] CLAUDE : fiche store (textes FR), formulaire Data Safety (cf.
      PLAY-DATA-SAFETY.md), déclaration de l'URL privacy
- [ ] MAXIME : captures d'écran depuis son téléphone (min. 2), soumission
- DoD : app publiée (piste interne puis production).

### Phase 4 — Post-lancement (ROADMAP_2_6_MONTHS.md)
Monitoring /health (UptimeRobot), observabilité persistée (T14), alerting email,
puis différenciateurs : photo « portée » IA, prix par ventes réelles (tâches #13/#14).

## Variables d'environnement production (Railway)

| Variable | Source |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase (Settings → Database) |
| `JWT_SECRET` | générer : `openssl rand -base64 48` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com (live) |
| `EMAIL_API_KEY` / `EMAIL_FROM` | Resend (`FlipSync <login@flipsync.fr>`) |
| `MAGIC_LINK_REDIRECT_URL` | `flipsync://auth/verify` |
| `PUBLIC_BASE_URL` | `https://api.flipsync.fr` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `MARKETPLACE_MOCK` | **ne pas définir** (ignoré en prod de toute façon) |

## Budget récurrent v1

Play 25 $ (une fois) · domaine ~8 €/an · Railway ~5 $/mois · Supabase 0 € ·
Resend 0 € (3 000 emails/mois) · Anthropic ~0,005 €/annonce · Stripe ~1,5 % + 0,25 €
par recharge. Total fixe ≈ **6 €/mois** une fois lancé.
