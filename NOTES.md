# Écosystème « Mes Outils » — note d'architecture (à lire en premier)

> Ce fichier existe pour qu'un nouvel intervenant (humain ou IA) comprenne
> l'intention du projet sans avoir à la redécouvrir. **Lis-le avant de modifier
> le backend `convex/` ou les permissions.**

## L'idée

On construit un **écosystème de plusieurs applications qui partagent une seule
base de données Convex** (un seul déploiement). Les applications sont
**séparées** (chacune son frontend, son URL, son périmètre métier) mais
**liées** :

- **Mêmes utilisateurs** partout (comptes Clerk uniques).
- **Droits / confidentialité / administration gérés depuis Mes Outils** : la
  page Admin de Mes Outils pilote les permissions de **toutes** les apps via la
  table `crmPermissions` (source de vérité unique).
- **Certaines données sont partagées / liées** entre apps. Exemple cible : les
  véhicules / camions de la recyclerie (Recycapp) et ceux de Mes Outils
  (Gotravaux / réservations) doivent référencer la **même** flotte (table
  `vehicles`), pas des copies.

Donc : **apps distinctes, données dans la même base, certaines tables communes,
d'autres dédiées à une app.**

## Les trois applications

| App | Frontend | Périmètre | Données |
|-----|----------|-----------|---------|
| **Mes Outils** | ce dépôt (`src/`) | portail interne : espace partage, réservations salles/véhicules, Gotravaux (flotte), messagerie, admin | `posts`, `rooms`, `roomReservations`, `vehicleReservations`, `vehicles`, `directMessages`, … |
| **Recyclerie (Recycapp)** | dépôt séparé | CRM : demandes, clients, articles boutique, caisse, ateliers, arrivages, sorties, tournées, flotte | `requests`, `articles`, `clients` (via Clerk), `ventes`, `arrivages`, `tournees`, `vehicles`, … |
| **Klyd** | dépôt séparé (`/Users/salem/klyde`) | boutique textile haut de gamme : stock, mise en ligne, commandes | `klydeItems`, `klydeOrders`, `klydeWishlists` |

## Règles structurantes

1. **Un seul backend Convex partagé.** Tous les frontends pointent leur
   `VITE_CONVEX_URL` vers le **même** déploiement. Le dossier `convex/` de **ce
   dépôt** est la **source de vérité canonique** (il contient les fonctions des
   3 apps). Les autres dépôts ne doivent **pas** déployer un `convex/` divergent,
   sinon ils écraseraient des fonctions. Si on ajoute des fonctions pour Klyd ou
   Recycapp, on les ajoute ici.

2. **Séparation des données par table, pas par base.** Quand deux apps ne
   doivent pas se mélanger, on utilise des **tables dédiées** plutôt qu'un champ
   filtre. Exemple : les vêtements Klyd vivent dans `klydeItems`, **séparés** des
   `articles` de la recyclerie → aucun article Klyd n'apparaît dans la boutique
   recyclerie et inversement, tout en partageant la base.

3. **Partage explicite quand c'est voulu.** Quand une donnée est commune (ex.
   `vehicles` : flotte partagée recyclerie ↔ Mes Outils), on garde **une seule
   table** et on lie par référence. Ne pas dupliquer.

4. **Permissions : `crmPermissions` est la seule source de vérité.**
   - Chaque page a une `pageKey` et une liste d'actions
     (`read`, `create`, `update`, `delete`, `manage`, `analyze`, …).
   - Conventions de clés : recyclerie = clés simples (`articles`, `caisse`,
     `flotte`, `equipe`, `tournees`, …) ; Mes Outils = `mesoutils:*` ; Klyd =
     `klyde:*`.
   - Côté serveur, **toute** query/mutation staff appelle
     `requireCrmPermission(ctx, pageKey, action)` (ou `requireAnyCrmPermission`).
     Les queries publiques (boutique, soumission de demande client) n'en mettent
     volontairement pas.
   - Les admins (`role === "admin"` ou `ADMIN_EMAILS`) ont tout. Le catalogue
     des pages/actions affiché dans l'admin est dans
     [`src/lib/permissions.ts`](src/lib/permissions.ts).

5. **Auth.** Clerk fournit l'identité ; Convex la lit via `ctx.auth`. Le profil
   (nom, photo) se modifie côté Mes Outils sur `/compte` (API Clerk), ce qui se
   propage à toutes les apps.

## IA (OpenAI)

- Clé dans l'env Convex : `OPENAI_API_KEY`. Modèle de l'assistant CRM
  configurable via `OPENAI_REQUEST_ANALYSIS_MODEL` (défaut de secours : `gpt-4o`).
- Fonctionnalités : génération d'annonce + valorisation (`convex/ai.ts`
  `analyzeArticleImage`, gpt-4o + recherche web avec repli gpt-4o), détourage /
  fond produit (`gpt-image-1`, via job `bgJobs` pour éviter le timeout 60 s),
  analyse de lots (`analyzePotentialLots`), analyse photos livraison
  (`convex/livraison.ts`), assistant manager (`convex/requestAnalysis.ts`),
  analyse textile Klyd (`convex/klyde.ts` `analyzePhotos`).
- Si l'IA « ne marche plus » alors que la clé est posée : regarder le message
  d'erreur OpenAI renvoyé. `insufficient_quota` / `invalid_api_key` /
  `model_not_found` = problème **compte/clé/modèle OpenAI**, pas le code.
  `gpt-image-1` exige une organisation OpenAI **vérifiée**.

## Déploiement

- SPA sur Vercel : `vercel.json` réécrit toutes les routes vers `/index.html`
  (sinon 404 au refresh d'une route profonde).
- Backend : `npx convex deploy` (prod) **depuis ce dépôt** pour publier les
  fonctions des 3 apps sur le déploiement partagé.
