# mes-outils

Portail interne MES : accès aux applications, espace partage, réservations de
salles/véhicules et administration des droits.

## Architecture

Ce dépôt pilote l'application frontend `mesoutils` et le backend Convex partagé.
La base Convex mère est :

```txt
https://sensible-gull-961.eu-west-1.convex.cloud
```

Les fonctions et le schéma Convex vivent dans `convex/`. Les autres applications
comme `recycapp` consommeront cette base partagée.

## Développement

```bash
npm install
npm run dev
```

Pour pousser le backend Convex depuis ce dépôt :

```bash
npx convex dev
```

## Vérification

```bash
npm run build
npx convex dev --once --typecheck enable
```
