> ⚠️ **BACKEND CONVEX PARTAGÉ — LIS CECI AVANT TOUTE CHOSE.**
>
> Les 4 apps (Mes Outils, Recyclerie/Recycapp, Klyde, Cycle en Bray) partagent
> **un seul déploiement Convex**. Le dossier `convex/` **canonique** (sur-ensemble
> des 4 apps) vit dans **`~/mesoutils`** — c'est la SEULE source de vérité. Les
> `convex/` des autres dépôts ne sont que des copies pour le typecheck local.
>
> **🔁 Lance ce script AVANT *et* APRÈS toute intervention sur n'importe quelle app :**
>
> ```
> bash ~/mesoutils/scripts/sync-convex.sh
> ```
>
> Il réaligne les 4 dossiers `convex/` sur le canonique.
>
> **Règles impératives :**
> - Toute fonction ou table backend — **même pour CETTE app** — s'écrit dans `~/mesoutils/convex/`, jamais ailleurs.
> - On **déploie le backend uniquement depuis Mes Outils** : `cd ~/mesoutils && npx convex deploy`.
> - Ne lance **jamais** `npx convex dev` ni `npx convex deploy` depuis un autre dépôt.

---

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
