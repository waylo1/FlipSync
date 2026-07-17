# Play Console — Réponses au formulaire « Sécurité des données »

> À recopier dans Play Console → Politique de l'application → Sécurité des données.
> Réponses alignées sur le code au 2026-07-17 — si le produit change (analytics,
> crash reporting…), mettre À JOUR ce fichier ET le formulaire. Ne jamais déclarer
> moins que la réalité : c'est un motif de retrait de l'app.

## Vue d'ensemble

- L'app **collecte** des données : OUI.
- Les données sont **chiffrées en transit** : OUI (HTTPS partout).
- L'utilisateur peut **demander la suppression** : OUI (email — cf. /legal/privacy ;
  pas encore de bouton in-app → ne PAS cocher « suppression dans l'app »).
- Données **partagées** avec des tiers : OUI (sous-traitants ci-dessous, pour le
  fonctionnement du service uniquement — jamais pour la pub).

## Détail par catégorie

| Catégorie Play | Collectée ? | Partagée ? | Finalité | Détail |
|---|---|---|---|---|
| Adresse e-mail | Oui | Oui (Resend — envoi du lien) | Fonctionnalité, gestion du compte | Magic link, identifiant du compte |
| Photos | Oui | Oui (Anthropic — génération de l'annonce) | Fonctionnalité | Photos des objets à vendre, envoyées au serveur puis à l'API IA |
| Autres contenus créés | Oui | Non | Fonctionnalité | Annonces (titre, description, prix, état) |
| Infos de paiement | Oui | Oui (Stripe) | Fonctionnalité | Carte saisie dans la feuille Stripe — jamais stockée par FlipSync ; solde cagnotte en centimes côté serveur |
| Historique d'achats | Oui | Non | Fonctionnalité | Transactions cagnotte (recharges, débits, remboursements) |
| Identifiants utilisateur | Oui | Non | Fonctionnalité | ID de compte interne |

## À déclarer NON (état du code au 2026-07-17)

Localisation · contacts · SMS/appels · historique web · données de santé/fitness ·
fichiers du téléphone (les photos passent par la caméra in-app, pas la galerie —
si un jour un picker galerie est ajouté, revoir) · identifiants publicitaires ·
analytics tiers · crash reporting tiers (rien d'installé — si Sentry est ajouté
plus tard, mettre à jour) · aucune donnée utilisée pour la publicité.

## Questions annexes du formulaire

- **Public cible** : 18+ (transactions financières). Pas une app « enfants ».
- **URL politique de confidentialité** : `https://api.flipsync.fr/legal/privacy`
- **Compte requis** : OUI (email).
- **App financière** : NON au sens Play (pas un produit bancaire/prêt) — la
  cagnotte est un crédit de service prépayé.
