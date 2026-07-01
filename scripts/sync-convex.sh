#!/usr/bin/env bash
#
# sync-convex.sh — Propage le backend Convex CANONIQUE (Mes Outils) vers toutes
# les apps de l'écosystème (Recyclerie/Recycapp, Klyde, Cycle en Bray).
#
# Pourquoi : les 4 apps partagent UN seul déploiement Convex. Le dossier
# `convex/` de Mes Outils (`~/mesoutils`) est la SEULE source de vérité ; c'est
# un sur-ensemble qui contient les fonctions des 4 apps. Les copies dans les
# autres dépôts servent uniquement au typecheck local de leur frontend.
#
# 👉 À lancer AVANT et APRÈS toute intervention sur N'IMPORTE QUELLE app, pour
#    garder les 4 dossiers `convex/` identiques au canonique.
#
# Règles : on n'édite le backend QUE dans ~/mesoutils/convex, et on déploie
# UNIQUEMENT depuis Mes Outils (`cd ~/mesoutils && npx convex deploy`).
#
# Usage : bash ~/mesoutils/scripts/sync-convex.sh
set -uo pipefail

CANON="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = ~/mesoutils
SIBLINGS=( "$HOME/recycapp" "$HOME/klyde" "$HOME/cycleenbray" "$HOME/bennepro" )

echo "Backend canonique : $CANON/convex"

# 1) Régénère les types du canonique (best-effort) pour que les copies aient
#    des _generated à jour. Sans réseau, on garde les _generated existants.
if ( cd "$CANON" && npx convex codegen >/dev/null 2>&1 ); then
  echo "✓ types canoniques régénérés"
else
  echo "⚠ codegen ignoré (hors-ligne ?) — copie des _generated existants"
fi

# 2) Recopie convex/ à l'identique dans chaque app.
for sib in "${SIBLINGS[@]}"; do
  if [ -d "$sib/convex" ] || [ -d "$sib" ]; then
    mkdir -p "$sib/convex"
    rsync -a --delete "$CANON/convex/" "$sib/convex/"
    echo "✓ $sib/convex synchronisé"
  else
    echo "⚠ $sib introuvable — ignoré"
  fi
done

echo "✓ Terminé. Déploie le backend UNIQUEMENT depuis Mes Outils (npx convex deploy)."
