#!/usr/bin/env bash
#
# sync-convex.sh — Propage le backend Convex CANONIQUE (Mes Outils) et les
# instructions IA (CLAUDE.md/AGENTS.md) vers toutes les apps de l'écosystème
# (Recycapp, Klyde, Cycle en Bray, Bennes Pro, Pointeuse, Feedback).
#
# Pourquoi : les 7 apps partagent UN seul déploiement Convex. Le dossier
# `convex/` de Mes Outils (`~/mesoutils`) est la SEULE source de vérité ; c'est
# un sur-ensemble qui contient les fonctions des 7 apps. Les copies dans les
# autres dépôts servent uniquement au typecheck local de leur frontend.
#
# ⚠️ Toute NOUVELLE app de l'écosystème doit être ajoutée à SIBLINGS ci-dessous,
#    sinon sa copie `convex/` dérive en silence du canonique.
#
# 👉 À lancer AVANT et APRÈS toute intervention sur N'IMPORTE QUELLE app, pour
#    garder les dossiers `convex/` et les instructions identiques au canonique.
#
# Règles : on n'édite le backend QUE dans ~/mesoutils/convex, et on déploie
# UNIQUEMENT depuis Mes Outils (`cd ~/mesoutils && npx convex deploy`).
#
# Usage : bash ~/mesoutils/scripts/sync-convex.sh
set -uo pipefail

CANON="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = ~/mesoutils
SIBLINGS=( "$HOME/recycapp" "$HOME/klyde" "$HOME/cycleenbray" "$HOME/bennepro" "$HOME/pointeuselsdb" "$HOME/feedback" )

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

# 3) Propage les instructions IA canoniques (CLAUDE.md → CLAUDE.md + AGENTS.md
#    partout, y compris dans Mes Outils).
cp "$CANON/CLAUDE.md" "$CANON/AGENTS.md"
for sib in "${SIBLINGS[@]}"; do
  if [ -d "$sib" ]; then
    cp "$CANON/CLAUDE.md" "$sib/CLAUDE.md"
    cp "$CANON/CLAUDE.md" "$sib/AGENTS.md"
    echo "✓ $sib instructions IA synchronisées"
  fi
done

echo "✓ Terminé. Déploie le backend UNIQUEMENT depuis Mes Outils (npx convex deploy)."
