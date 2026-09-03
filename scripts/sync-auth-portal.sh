#!/usr/bin/env bash
#
# sync-auth-portal.sh — Propage le PORTAIL D'AUTHENTIFICATION canonique
# (« Auth Switch ») de Mes Outils vers toutes les apps web de l'écosystème.
#
# Pourquoi : les 8 apps web partagent la même instance Clerk et doivent offrir
# le même écran de connexion / inscription. Le composant a déjà dérivé une fois
# — Recycapp, Cycle en Bray et Bennes Pro avaient le `.tsx` mais PAS le CSS,
# donc un portail sans mise en page ni animation. Ce script supprime la dérive.
#
# Source de vérité :
#   • ~/mesoutils/src/components/ui/auth-switch.tsx        (copié tel quel)
#   • le bloc entre /* >>> AUTH-PORTAL >>> */ et /* <<< AUTH-PORTAL <<< */
#     dans ~/mesoutils/src/index.css                       (remplacé sur place)
#
# Ce qui reste propre à chaque app, et n'est donc PAS touché :
#   • les props passées à <AuthSwitch> (nom, logo, liens légaux) ;
#   • les variables --auth-page-bg / --auth-circle / --auth-accent, à définir
#     dans le :root de l'app seulement si sa palette --color-brand-* ne suffit
#     pas (c'est le cas de BâtiRe et de Klyde).
#
# `~/recyccaisse` est exclu volontairement : c'est une app Expo/React Native
# (@clerk/clerk-expo), sans DOM ni CSS — ce portail n'y a aucun sens.
#
# Usage : bash ~/mesoutils/scripts/sync-auth-portal.sh
set -uo pipefail

CANON="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = ~/mesoutils
TARGETS=( "$HOME/recycapp" "$HOME/klyde" "$HOME/cycleenbray" "$HOME/bennepro" "$HOME/pointeuselsdb" "$HOME/feedback" "$HOME/batire" )

COMPONENT="$CANON/src/components/ui/auth-switch.tsx"
CSS="$CANON/src/index.css"
BEGIN='/* >>> AUTH-PORTAL >>> */'
END='/* <<< AUTH-PORTAL <<< */'

for f in "$COMPONENT" "$CSS"; do
  [ -f "$f" ] || { echo "✗ source manquante : $f"; exit 1; }
done
grep -qF "$BEGIN" "$CSS" || { echo "✗ marqueurs AUTH-PORTAL absents de $CSS"; exit 1; }

echo "Portail canonique : $COMPONENT"

for app in "${TARGETS[@]}"; do
  name="$(basename "$app")"
  if [ ! -d "$app/src" ]; then echo "⚠ $name ignoré (pas de src/)"; continue; fi

  mkdir -p "$app/src/components/ui"
  cp "$COMPONENT" "$app/src/components/ui/auth-switch.tsx"

  if [ ! -f "$app/src/index.css" ]; then echo "⚠ $name : pas de src/index.css, CSS non propagé"; continue; fi

  CANON_CSS="$CSS" TARGET_CSS="$app/src/index.css" python3 - <<'PY'
import os

begin = "/* >>> AUTH-PORTAL >>> */"
end = "/* <<< AUTH-PORTAL <<< */"

canon = open(os.environ["CANON_CSS"], encoding="utf-8").read()
block = canon[canon.index(begin) : canon.index(end) + len(end)]

path = os.environ["TARGET_CSS"]
css = open(path, encoding="utf-8").read()
if begin in css and end in css:
    css = css[: css.index(begin)] + block + css[css.index(end) + len(end) :]
else:
    css = css.rstrip("\n") + "\n\n" + block + "\n"
open(path, "w", encoding="utf-8").write(css)
PY
  echo "✓ $name"
done

echo
echo "Pense à typechecker les apps touchées (npx tsc -p tsconfig.app.json --noEmit)."
