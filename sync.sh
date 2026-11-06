#!/usr/bin/env bash
# Keep the Herdr app (herdr.dev/core) layout and mods in this repo.
#
#   ./sync.sh backup   copy the live mods and files listed below into this folder
#   ./sync.sh apply    restore them into ~/.config/herdr-app
#
# Files are copied, not linked: the app rewrites the layout file as you use the window
# (panel shown, sizes), so a link would keep the repo dirty. Other mods in the app folder
# are neither backed up nor replaced.
#
# apply copies each changed mod or file next to the app folder first, then moves the one it
# replaces to ~/.config/herdr-app.bak-<time>-<pid>/ (outside the app folder, so the app never
# loads a backup as a mod) and the copy into place. It installs copy-on-select and the Catppuccin
# themes from their own repos at pinned commits (they have no license, so they aren't copied
# here), and runs `herdr-app check` on every changed mod before any goes in. The app sees
# a new mod folder only when it starts, so restart Herdr after a first apply, then pick the
# layout with ⌘⇧L or `herdr-app do layout.switch '{"name":"tkhwang-herdr"}'`.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
live="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

# Mods kept here, each with a small patch: clones of Herdr's own mods (Apache-2.0, see
# LICENSE-herdr), and better-changes and better-spaces from munza/herdr-mods (Apache-2.0, see
# LICENSE-herdr-mods and NOTICE-herdr-mods), herdr-open-with-zed from atleugim/herdr-open-with-zed
# (Apache-2.0, see LICENSE-herdr-open-with-zed), git-graph from rabeeh-ta/herdr-git-graph (lines marked "review fixes")
# (MIT, see LICENSE-herdr-git-graph; its icons follow Lucide, ISC, see mods/git-graph/icons/LICENSE-lucide.txt),
# and markdown-browser from ohneda/herdr-markdown-browser (MIT, see LICENSE-herdr-markdown-browser), whose
# mod.json "place" is "none" here.
mods="spaces-dev agents-dev changes-dev files-dev better-changes better-spaces tabs-dev herdr-open-with-zed git-graph markdown-browser"
files="layouts/tkhwang-herdr.json settings.json keys.json"
# Third-party mod installed from its repo instead of kept here.
cos_repo="jspoynor/herdr-copy-on-select"
cos_sha="ea2304a28e3bda6812048ee556c592a558320aa2"
# Catppuccin themes that layouts/tkhwang-herdr.json names (Mocha dark, Latte light), installed from
# their repo, each checked against its sha256. Only the themes: that repo's own layout swaps the
# tab bar, spaces, agents and changes blocks for its own mods.
cat_repo="MarcozVD/herdr-layout-catppuccin"
cat_sha="b58f43478fbf874c8be989b3336793f7c98b6d10"
cat_themes="herdr-catppuccin.json:946e2d08b250cf4cb8bd603a838f441fe848535f9d62ee88c84a5f508ad0bbf1
herdr-catppuccin-latte.json:d9f8ce130ad4bf8241e898449f9447c6c4f32290863ff5c5ed5b5ab5850f79f4"

die() { echo "$*" >&2; exit 1; }

backup() {
  local m f
  [ -d "$live" ] || die "no Herdr app folder: $live"
  for m in $mods; do
    [ -d "$live/mods/$m" ] || die "missing mod: $live/mods/$m"
    mkdir -p "$here/mods/$m"
    # gpui-kit.d.ts (800 KB of editor types) and jsconfig.json are written by the app.
    rsync -a --delete --exclude '*.d.ts' --exclude jsconfig.json "$live/mods/$m/" "$here/mods/$m/"
  done
  for f in $files; do
    [ -f "$live/$f" ] || die "missing file: $live/$f"
    mkdir -p "$here/$(dirname "$f")"
    cp "$live/$f" "$here/$f"
  done
  [ -f /Applications/Herdr.app/Contents/Resources/LICENSE ] &&
    cp /Applications/Herdr.app/Contents/Resources/LICENSE "$here/LICENSE-herdr"
  echo "backed up $live -> $here"
  git -C "$here" status --short -- . || true
}

# Moves `path` (relative to the app folder) into this run's backup folder.
stash() {
  local dest="$live.bak-$stamp/$1"
  mkdir -p "$(dirname "$dest")"
  mv "$live/$1" "$dest"
  echo "  backed up $1 -> $dest"
}

# Moves the staged copy of `path` (relative to the app folder) into place, stashing the live
# one. Both moves stay on one disk, so a failed copy never gets this far.
swap() {
  if [ -e "$live/$1" ]; then stash "$1"; fi
  mkdir -p "$(dirname "$live/$1")"
  mv "$stage/$1" "$live/$1"
}

apply() {
  local m f cos="$live/mods/copy-on-select"
  # The process id keeps two runs in the same second apart.
  stamp="$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$live/mods" "$live/layouts"
  # Copies are staged beside the app folder, not in it, so the app never loads a partial mod.
  stage="$(mktemp -d "$live.new-XXXXXX")"
  trap 'rm -rf "$stage"' EXIT
  # Every changed mod is staged and checked before any goes in, so one the check rejects
  # leaves the app folder as it was.
  local changed=""
  for m in $mods; do
    if [ -d "$live/mods/$m" ]; then
      diff -rq -x '*.d.ts' -x jsconfig.json "$here/mods/$m" "$live/mods/$m" >/dev/null 2>&1 && { echo "same: mods/$m"; continue; }
    fi
    mkdir -p "$stage/mods"
    rsync -a "$here/mods/$m/" "$stage/mods/$m/"
    changed="$changed $m"
  done
  # copy-on-select counts as installed only with both files and `.revision` naming the
  # pinned commit. `.revision` moves in with the files, so a failed install never has it.
  if [ -f "$cos/main.js" ] && [ -f "$cos/mod.json" ] && [ "$(cat "$cos/.revision" 2>/dev/null)" = "$cos_sha" ]; then
    echo "same: mods/copy-on-select"
  else
    mkdir -p "$stage/mods/copy-on-select"
    for f in main.js mod.json; do
      curl -fsSL "https://raw.githubusercontent.com/$cos_repo/$cos_sha/mods/copy-on-select/$f" -o "$stage/mods/copy-on-select/$f" ||
        die "could not fetch copy-on-select/$f from $cos_repo"
    done
    echo "$cos_sha" >"$stage/mods/copy-on-select/.revision"
    changed="$changed copy-on-select"
  fi
  if command -v herdr-app >/dev/null 2>&1; then
    for m in $changed; do
      herdr-app check "$stage/mods/$m" || die "herdr-app check rejected mods/$m; nothing was installed"
    done
  fi
  for m in $changed; do
    swap "mods/$m"
    if [ "$m" = copy-on-select ]; then echo "installed mods/$m ($cos_repo@${cos_sha:0:7})"; else echo "installed mods/$m"; fi
  done
  # Themes go in before the layout, so it never names a missing one.
  local entry name sum
  for entry in $cat_themes; do
    name="${entry%%:*}" sum="${entry#*:}"
    if [ -f "$live/themes/$name" ] && [ "$(shasum -a 256 "$live/themes/$name" | cut -d' ' -f1)" = "$sum" ]; then
      echo "same: themes/$name"; continue
    fi
    mkdir -p "$stage/themes"
    curl -fsSL "https://raw.githubusercontent.com/$cat_repo/$cat_sha/themes/$name" -o "$stage/themes/$name" ||
      die "could not fetch themes/$name from $cat_repo"
    [ "$(shasum -a 256 "$stage/themes/$name" | cut -d' ' -f1)" = "$sum" ] ||
      die "themes/$name from $cat_repo does not match its pinned sha256"
    swap "themes/$name"
    echo "installed themes/$name ($cat_repo@${cat_sha:0:7})"
  done
  for f in $files; do
    if [ -f "$live/$f" ]; then
      cmp -s "$here/$f" "$live/$f" && { echo "same: $f"; continue; }
    fi
    mkdir -p "$stage/$(dirname "$f")"
    cp "$here/$f" "$stage/$f"
    swap "$f"
    echo "installed $f"
  done
  echo "restart Herdr if a mod folder was new, then switch to the tkhwang-herdr layout (⌘⇧L)"
}

case "${1:-}" in
  backup) backup ;;
  apply) apply ;;
  *) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
