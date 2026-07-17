import { FastifyPluginAsync } from 'fastify'

/**
 * Pages légales publiques — servies par l'API (même domaine, zéro hébergement
 * de plus) : Google Play exige une URL de politique de confidentialité
 * fonctionnelle dès le premier envoi. Volontairement SANS hook JWT (comme
 * /health) : ces pages doivent être lisibles par n'importe qui, y compris les
 * robots de vérification des stores.
 *
 * ⚠ Placeholders [ … ] à remplacer par les informations légales de la
 * micro-entreprise (dénomination, SIRET, adresse, email de contact) AVANT le
 * déploiement production — cf. GO-LIVE.md, action Maxime. Faire relire par un
 * professionnel avant de scaler : ceci est un point de départ honnête, pas un
 * avis juridique.
 */

/** Habillage minimal commun — lisible sur mobile, aucun asset externe. */
const page = (title: string, body: string): string => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — FlipSync</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto;
         padding: 24px 16px 64px; line-height: 1.6; color: #1d1d1f; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2em; }
  footer { margin-top: 3em; font-size: .85rem; color: #6e6e73; }
</style>
</head>
<body>
${body}
<footer>FlipSync — [DÉNOMINATION MICRO-ENTREPRISE], SIRET [SIRET], [ADRESSE].<br>
Contact : [EMAIL_CONTACT]</footer>
</body>
</html>`

const PRIVACY_HTML = page(
  'Politique de confidentialité',
  `<h1>Politique de confidentialité</h1>
<p>Dernière mise à jour : 17 juillet 2026.</p>
<p>FlipSync est une application d'aide à la revente : vous photographiez un objet,
l'intelligence artificielle rédige l'annonce (titre, description, estimation de prix),
et vous la publiez sur la plateforme de votre choix.</p>

<h2>Données collectées</h2>
<ul>
<li><strong>Adresse email</strong> — création et connexion au compte (lien magique).</li>
<li><strong>Photos de vos objets</strong> — envoyées à nos serveurs pour générer l'annonce.</li>
<li><strong>Contenu des annonces</strong> — titre, description, prix, état, marque.</li>
<li><strong>Historique de cagnotte</strong> — recharges et débits en centimes d'euro.
Vos données bancaires ne transitent jamais par nos serveurs : le paiement est traité
par Stripe.</li>
</ul>

<h2>Utilisation</h2>
<p>Ces données servent exclusivement au fonctionnement du service : générer vos
annonces, gérer votre compte et votre cagnotte. Aucune vente de données, aucune
publicité, aucun profilage.</p>

<h2>Sous-traitants</h2>
<ul>
<li><strong>Anthropic</strong> (États-Unis) — analyse des photos et rédaction des annonces
par IA. Transfert encadré par le Data Privacy Framework / clauses contractuelles types ;
les données soumises via l'API ne sont pas utilisées pour entraîner les modèles.</li>
<li><strong>Stripe</strong> — paiement des recharges de cagnotte.</li>
<li><strong>Supabase</strong> (Union européenne) — hébergement de la base de données.</li>
<li><strong>Railway</strong> (région UE) — hébergement du serveur applicatif.</li>
<li><strong>Resend</strong> — envoi des emails de connexion.</li>
</ul>

<h2>Conservation</h2>
<p>Les données du compte sont conservées tant que le compte est actif. Les photos et
annonces peuvent être supprimées depuis l'application (annulation d'annonce) ; le
compte et l'ensemble des données associées sont supprimés sur simple demande.</p>

<h2>Vos droits</h2>
<p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, de
suppression et de portabilité de vos données. Écrivez à [EMAIL_CONTACT] — réponse
sous 30 jours. Vous pouvez saisir la CNIL (cnil.fr) si vous estimez vos droits
non respectés.</p>`,
)

const CGV_HTML = page(
  'Conditions générales',
  `<h1>Conditions générales d'utilisation et de vente</h1>
<p>Dernière mise à jour : 17 juillet 2026.</p>

<h2>Le service</h2>
<p>FlipSync génère des annonces de revente par intelligence artificielle à partir de
vos photos : titre, description, estimation de prix et état. Vous restez seul
responsable de la publication de l'annonce sur les plateformes tierces (Leboncoin,
Vinted…) et de la vente elle-même. FlipSync n'est ni un intermédiaire de vente, ni
un dépôt-vente, et ne prélève aucune commission sur vos ventes.</p>

<h2>Prix</h2>
<p>La génération d'une annonce coûte <strong>0,99 €</strong>, débités de votre
cagnotte au moment où vous validez l'annonce — jamais avant. Chaque compte dispose
de <strong>3 annonces gratuites par mois</strong>. La cagnotte se recharge par
carte bancaire (paiement traité par Stripe) par montants de 5, 10, 20 ou 50 €.</p>

<h2>Remboursements</h2>
<p>Le débit n'intervient qu'à la validation de l'annonce. En cas d'échec technique
de la génération ou d'annulation de l'annonce depuis l'application, le montant est
automatiquement recrédité sur votre cagnotte, intégralement.</p>

<h2>Estimations de prix</h2>
<p>Les prix proposés par l'IA sont des estimations indicatives, non des expertises.
Vous fixez librement le prix final de vente.</p>

<h2>Compte et résiliation</h2>
<p>La création d'un compte requiert une adresse email valide. Vous pouvez demander
la clôture du compte et le remboursement du solde de cagnotte restant à
[EMAIL_CONTACT].</p>

<h2>Droit de rétractation</h2>
<p>En validant une annonce, vous demandez l'exécution immédiate du service de
génération et renoncez expressément au droit de rétractation pour cette prestation
(art. L221-28 du Code de la consommation). Le solde non consommé de la cagnotte
reste remboursable à tout moment.</p>

<h2>Litiges</h2>
<p>Droit français. En cas de litige, une solution amiable sera recherchée avant
toute action ; vous pouvez recourir gratuitement au médiateur de la consommation
[MÉDIATEUR À DÉSIGNER].</p>`,
)

const legalRoutes: FastifyPluginAsync = async app => {
  app.get('/privacy', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(PRIVACY_HTML),
  )
  app.get('/cgv', async (_req, reply) => reply.type('text/html; charset=utf-8').send(CGV_HTML))
}

export default legalRoutes
