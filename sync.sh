#!/usr/bin/env bash
# Build the Herdr app's mods from other people's code and my changes to it, and keep the app in step.
#
#   ./sync.sh build                   upstream + my patches + my shared files -> build/mods
#   ./sync.sh apply                   build, then install it and config/ into ~/.config/herdr-app
#   ./sync.sh backup                  ~/.config/herdr-app -> patches/, own/, config/
#   ./sync.sh status                  each mod: where it's from, my patch's size, whether the app has it
#   ./sync.sh update MOD REF          move MOD's upstream to REF (tag, branch or full commit), keeping my patch
#   ./sync.sh update MOD --continue   finish an update after fixing its conflicts in work/MOD
#
# sources.json says where each mod comes from. upstream/ holds that code as it was at the pinned
# commit and is never edited by hand; patches/ holds what I changed in it; own/ holds what I wrote.
# The app (herdr.dev/core) keeps its layout and mods in ~/.config/herdr-app (HERDR_APP_HOME picks
# another): apply copies into it and backup copies out of it, never links, since the app rewrites
# the layout file as the window is used. Mods sources.json doesn't name are left alone.
set -euo pipefail

# Real paths: git apply won't write past a symbolic link (macOS's /var and /tmp are links).
here="$(cd "$(dirname "$0")" && pwd -P)"
live="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
src="$here/sources.json"
work="$here/work"
# Files the app writes into every mod folder.
EXCLUDE=(--exclude '*.d.ts' --exclude jsconfig.json --exclude .DS_Store)

die() { echo "$*" >&2; exit 1; }
for tool in jq git rsync curl shasum; do command -v "$tool" >/dev/null 2>&1 || die "needs $tool"; done

TMP="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/herdr-mods.XXXXXX")" && pwd -P)"
stage=""
# A second Ctrl-C would cut the removal short and leave half a stage beside the app folder.
cleanup() { trap '' INT TERM HUP; rm -rf "$TMP"; if [ -n "$stage" ]; then rm -rf "$stage"; fi; }
trap cleanup EXIT

# ── sources.json ──────────────────────────────────────────────────────────────

q() { jq -r "$@" "$src"; }
kind_of() { q --arg m "$1" '.mods[$m].kind // ""'; }
# Mods built here (from upstream and patches, or from own/), and mods fetched at apply.
built_mods() { q '.mods | to_entries[] | select(.value.kind != "fetch") | .key'; }
patched_mods() { q '.mods | to_entries[] | select(.value.kind == "herdr" or .value.kind == "oss") | .key'; }
own_mods() { q '.mods | to_entries[] | select(.value.kind == "own") | .key'; }
fetched_mods() { q '.mods | to_entries[] | select(.value.kind == "fetch") | .key'; }
shared_of() { q --arg m "$1" '.mods[$m].shared // [] | .[]'; }
all_shared() { q '[.mods[].shared // [] | .[]] | unique | .[]'; }
users_of() { q --arg f "$1" '.mods | to_entries[] | select((.value.shared // []) | index($f)) | .key'; }
origin_of() { q --arg m "$1" '.mods[$m].upstream | "\(.repo)@\(.ref // .commit[0:7])"'; }

# ── building ──────────────────────────────────────────────────────────────────

# Other people's code for a mod: its upstream, then single files taken from elsewhere.
pristine() { # mod dest [upstream dir]
  local up="${3:-$here/upstream/$1}"
  rm -rf "${2:?}"; mkdir -p "$2"
  rsync -a "$up/" "$2/"
  if [ -d "$here/upstream/$1.extra" ]; then rsync -a "$here/upstream/$1.extra/" "$2/"; fi
}

apply_patch() { # patch dest
  # Run outside the repo, so git takes the absolute directory as given.
  (cd / && git apply -p1 --unsafe-paths --whitespace=nowarn --directory="$2" "$1")
}

# One mod as the app gets it. Shared files are left out when $3 is "noshared".
build_mod() { # mod dest [noshared]
  local m="$1" dest="$2" f
  case "$(kind_of "$m")" in
    own)
      rm -rf "${dest:?}"; mkdir -p "$dest"
      rsync -a "${EXCLUDE[@]}" "$here/own/mods/$m/" "$dest/"
      ;;
    herdr | oss)
      pristine "$m" "$dest"
      if [ -f "$here/patches/$m.patch" ]; then
        apply_patch "$here/patches/$m.patch" "$dest" || die "patches/$m.patch no longer applies to upstream/$m"
      fi
      ;;
    *) die "sources.json: $m has no known kind" ;;
  esac
  if [ "${3:-}" != noshared ]; then
    while IFS= read -r f; do cp "$here/own/shared/$f" "$dest/$f"; done < <(shared_of "$m")
  fi
}

build_all() { # dest
  local m
  rm -rf "${1:?}"; mkdir -p "$1"
  while IFS= read -r m; do build_mod "$m" "$1/$m"; done < <(built_mods)
}

same_tree() { diff -rq "${EXCLUDE[@]/--exclude/-x}" "$1" "$2" >/dev/null 2>&1; }

# ── patches ───────────────────────────────────────────────────────────────────

# patches/<mod>.patch: from the mod's upstream to `final` (which has no shared files).
# Removed when the mod is its upstream as is.
make_patch() { # mod final
  local m="$1" t="$TMP/patch-$1" out="$here/patches/$1.patch" rc=0
  rm -rf "$t"; mkdir -p "$t"
  pristine "$m" "$t/a"
  rsync -a "$2/" "$t/b/"
  (cd "$t" && git -c core.quotepath=false diff --no-index --no-color --no-ext-diff --no-renames --binary --no-prefix a b) >"$t/p" || rc=$?
  [ "$rc" -le 1 ] || die "could not diff $m"
  if [ -s "$t/p" ]; then cp "$t/p" "$out"; else rm -f "$out"; fi
}

# ── backup ────────────────────────────────────────────────────────────────────

backup() {
  local m f v versions
  [ -d "$live/mods" ] || die "no Herdr app folder: $live"
  # Shared files first: every copy in the app must agree before anything here changes.
  mkdir -p "$TMP/shared"
  while IFS= read -r f; do
    versions=""
    while IFS= read -r m; do
      [ -f "$live/mods/$m/$f" ] || die "missing: $live/mods/$m/$f"
      v="$(shasum -a 256 "$live/mods/$m/$f" | cut -d' ' -f1)"
      case " $versions " in *" $v "*) ;; *) versions="$versions $v" ;; esac
      cp "$live/mods/$m/$f" "$TMP/shared/$f"
    done < <(users_of "$f")
    if [ "$(echo $versions | wc -w)" -gt 1 ]; then
      echo "$f differs between the mods that share it:" >&2
      users_of "$f" | while IFS= read -r m; do echo "  $(shasum -a 256 "$live/mods/$m/$f" | cut -c1-12)  mods/$m/$f" >&2; done
      die "make the copies the same in the app, then back up again"
    fi
  done < <(all_shared)
  while IFS= read -r m; do
    [ -d "$live/mods/$m" ] || die "missing mod: $live/mods/$m"
    rm -rf "$TMP/final"; mkdir -p "$TMP/final"
    rsync -a "${EXCLUDE[@]}" "$live/mods/$m/" "$TMP/final/"
    while IFS= read -r f; do rm -f "$TMP/final/$f"; done < <(shared_of "$m")
    make_patch "$m" "$TMP/final"
  done < <(patched_mods)
  while IFS= read -r m; do
    [ -d "$live/mods/$m" ] || die "missing mod: $live/mods/$m"
    mkdir -p "$here/own/mods/$m"
    rsync -a --delete "${EXCLUDE[@]}" "$live/mods/$m/" "$here/own/mods/$m/"
  done < <(own_mods)
  while IFS= read -r f; do cp "$TMP/shared/$f" "$here/own/shared/$f"; done < <(all_shared)
  while IFS= read -r f; do
    [ -f "$live/$f" ] || die "missing file: $live/$f"
    mkdir -p "$here/config/$(dirname "$f")"
    cp "$live/$f" "$here/config/$f"
  done < <(q '.config[]')
  echo "backed up $live -> $here"
  git -C "$here" status --short -- . || true
}

# ── apply ─────────────────────────────────────────────────────────────────────

# Moves `path` (relative to the app folder) into this run's backup folder.
stash() {
  local dest="$live.bak-$stamp/$1"
  mkdir -p "$(dirname "$dest")"
  mv "$live/$1" "$dest"
  echo "  backed up $1 -> $dest"
}

# Moves the staged copy of `path` into place, stashing the live one. Both moves stay on one disk.
swap() {
  if [ -e "$live/$1" ]; then stash "$1"; fi
  mkdir -p "$(dirname "$live/$1")"
  mv "$stage/$1" "$live/$1"
}

raw() { echo "https://raw.githubusercontent.com/$1/$2/$3"; } # repo commit path

apply() {
  local m f changed="" repo commit path sum
  build_all "$TMP/mods"
  # The process id keeps two runs in the same second apart.
  stamp="$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$live/mods" "$live/layouts"
  # Copies are staged beside the app folder, so the app never loads a partial mod.
  stage="$(mktemp -d "$live.new-XXXXXX")"
  mkdir -p "$stage/mods"
  while IFS= read -r m; do
    if [ -d "$live/mods/$m" ] && same_tree "$TMP/mods/$m" "$live/mods/$m"; then echo "same: mods/$m"; continue; fi
    rsync -a "$TMP/mods/$m/" "$stage/mods/$m/"
    changed="$changed $m"
  done < <(built_mods)
  # A fetched mod counts as installed only with all its files and `.revision` naming the
  # pinned commit. `.revision` moves in with the files, so a failed install never has it.
  while IFS= read -r m; do
    repo="$(q --arg m "$m" '.mods[$m].upstream.repo')"
    commit="$(q --arg m "$m" '.mods[$m].upstream.commit')"
    path="$(q --arg m "$m" '.mods[$m].upstream.path')"
    local whole=1
    while IFS= read -r f; do [ -f "$live/mods/$m/$f" ] || whole=0; done < <(q --arg m "$m" '.mods[$m].upstream.files[]')
    if [ "$whole" = 1 ] && [ "$(cat "$live/mods/$m/.revision" 2>/dev/null)" = "$commit" ]; then echo "same: mods/$m"; continue; fi
    mkdir -p "$stage/mods/$m"
    while IFS= read -r f; do
      curl -fsSL "$(raw "$repo" "$commit" "$path/$f")" -o "$stage/mods/$m/$f" || die "could not fetch $m/$f from $repo"
    done < <(q --arg m "$m" '.mods[$m].upstream.files[]')
    echo "$commit" >"$stage/mods/$m/.revision"
    changed="$changed $m"
  done < <(fetched_mods)
  # Every changed mod is checked before any goes in, so one the check rejects changes nothing.
  # Right after a restart the first check can take minutes, so each one names its mod first.
  if command -v herdr-app >/dev/null 2>&1; then
    for m in $changed; do
      echo "checking mods/$m"
      herdr-app check "$stage/mods/$m" || die "herdr-app check rejected mods/$m; nothing was installed"
    done
  fi
  for m in $changed; do swap "mods/$m"; echo "installed mods/$m"; done
  # Themes go in before the config, so the layout never names a missing one.
  while IFS=$'\t' read -r repo commit path sum; do
    f="themes/$(basename "$path")"
    if [ -f "$live/$f" ] && [ "$(shasum -a 256 "$live/$f" | cut -d' ' -f1)" = "$sum" ]; then echo "same: $f"; continue; fi
    mkdir -p "$stage/themes"
    curl -fsSL "$(raw "$repo" "$commit" "$path")" -o "$stage/$f" || die "could not fetch $f from $repo"
    [ "$(shasum -a 256 "$stage/$f" | cut -d' ' -f1)" = "$sum" ] || die "$f from $repo does not match its pinned sha256"
    swap "$f"
    echo "installed $f ($repo@${commit:0:7})"
  done < <(q '.themes[] | [.repo, .commit, .path, .sha256] | @tsv')
  while IFS= read -r f; do
    if [ -f "$live/$f" ] && cmp -s "$here/config/$f" "$live/$f"; then echo "same: $f"; continue; fi
    mkdir -p "$stage/$(dirname "$f")"
    cp "$here/config/$f" "$stage/$f"
    swap "$f"
    echo "installed $f"
  done < <(q '.config[]')
  echo "restart Herdr if a mod folder was new, then pick the layout with ⌘⇧L"
}

# ── status ────────────────────────────────────────────────────────────────────

status() {
  local m k from patch app f
  build_all "$TMP/mods"
  printf '%-20s %-6s %-40s %-14s %s\n' MOD KIND FROM "MY PATCH" APP
  while IFS= read -r m; do
    k="$(kind_of "$m")"
    case "$k" in
      own) from="own/mods/$m"; patch="-" ;;
      *)
        from="$(origin_of "$m")"
        if [ -f "$here/patches/$m.patch" ]; then
          patch="$(awk '/^(\+\+\+|---) /{next} /^\+/{a++} /^-/{d++} END{printf "+%d -%d", a, d}' "$here/patches/$m.patch")"
        else patch="none"; fi
        ;;
    esac
    if [ ! -d "$live/mods/$m" ]; then app="missing"
    elif same_tree "$TMP/mods/$m" "$live/mods/$m"; then app="same"
    else app="differs (backup or apply)"; fi
    printf '%-20s %-6s %-40s %-14s %s\n' "$m" "$k" "$from" "$patch" "$app"
  done < <(built_mods)
  while IFS= read -r m; do
    if [ "$(cat "$live/mods/$m/.revision" 2>/dev/null)" = "$(q --arg m "$m" '.mods[$m].upstream.commit')" ]; then app="same"; else app="missing or other version"; fi
    printf '%-20s %-6s %-40s %-14s %s\n' "$m" fetch "$(origin_of "$m")" "-" "$app"
  done < <(fetched_mods)
  while IFS= read -r f; do
    if cmp -s "$here/config/$f" "$live/$f"; then app="same"; else app="differs (backup or apply)"; fi
    printf '%-20s %-6s %-40s %-14s %s\n' "$(basename "$f")" config "config/$f" "-" "$app"
  done < <(q '.config[]')
}

# ── update ────────────────────────────────────────────────────────────────────

# Three-way merge of two trees: base (old upstream), ours (old upstream + my patch) and theirs
# (new upstream), into out. Prints each file that needs a hand.
merge_trees() { # base ours theirs out
  local base="$1" ours="$2" theirs="$3" out="$4" rel b o t rc
  rm -rf "${out:?}"; mkdir -p "$out"
  while IFS= read -r rel; do
    b="$base/$rel" o="$ours/$rel" t="$theirs/$rel"
    mkdir -p "$out/$(dirname "$rel")"
    if [ -f "$o" ] && [ -f "$t" ]; then
      if cmp -s "$o" "$t"; then cp "$o" "$out/$rel"
      elif [ -f "$b" ] && cmp -s "$o" "$b"; then cp "$t" "$out/$rel"
      elif [ -f "$b" ] && cmp -s "$t" "$b"; then cp "$o" "$out/$rel"
      else
        [ -f "$b" ] || b=/dev/null
        rc=0
        git merge-file -p -L mine -L "old upstream" -L "new upstream" "$o" "$b" "$t" >"$out/$rel" || rc=$?
        if [ "$rc" -ne 0 ]; then echo "$rel"; fi
      fi
    elif [ -f "$o" ]; then
      # Mine alone (kept), or gone upstream: dropped when I hadn't changed it.
      if [ -f "$b" ] && cmp -s "$o" "$b"; then :; else cp "$o" "$out/$rel"; if [ -f "$b" ]; then echo "$rel (gone upstream, changed by me)"; fi; fi
    elif [ -f "$t" ]; then
      # New upstream (taken), or one I removed: stays removed unless upstream changed it.
      if [ -f "$b" ] && cmp -s "$t" "$b"; then :; else cp "$t" "$out/$rel"; if [ -f "$b" ]; then echo "$rel (removed by me, changed upstream)"; fi; fi
    fi
  done < <( (cd "$base" && find . -type f; cd "$ours" && find . -type f; cd "$theirs" && find . -type f) | sed 's|^\./||' | sort -u)
}

update() {
  local m="${1:-}" ref="${2:-}" repo path depth commit conflicts tag
  [ -n "$m" ] && [ -n "$ref" ] || die "usage: ./sync.sh update MOD REF | update MOD --continue"
  case "$(kind_of "$m")" in herdr | oss) ;; *) die "$m isn't built on an upstream" ;; esac
  if [ "$ref" = --continue ]; then finish_update "$m"; return; fi
  [ ! -e "$work/$m" ] || die "work/$m exists: finish it with './sync.sh update $m --continue', or delete work/$m*"
  repo="$(q --arg m "$m" '.mods[$m].upstream.repo')"
  path="$(q --arg m "$m" '.mods[$m].upstream.path')"
  depth="$(echo "$path" | tr '/' '\n' | grep -c .)"
  # A tag, branch or full commit comes in one shallow fetch; anything else needs the history.
  git init -q "$TMP/repo"
  git -C "$TMP/repo" remote add origin "https://github.com/$repo.git"
  if git -C "$TMP/repo" fetch -q --depth 1 origin "$ref" 2>/dev/null; then
    commit="$(git -C "$TMP/repo" rev-parse 'FETCH_HEAD^{commit}')"
  else
    git -C "$TMP/repo" fetch -q --tags origin || die "could not fetch $repo"
    commit="$(git -C "$TMP/repo" rev-parse --verify -q "$ref^{commit}" || git -C "$TMP/repo" rev-parse --verify -q "origin/$ref^{commit}")" || die "$repo has no $ref"
  fi
  if [ "$commit" = "$(q --arg m "$m" '.mods[$m].upstream.commit')" ]; then echo "$m is already on $repo@${commit:0:7}"; return; fi
  mkdir -p "$work/$m.upstream"
  if ! git -C "$TMP/repo" archive "$commit" "$path" 2>/dev/null | tar -x -C "$work/$m.upstream" --strip-components="$depth" ||
    [ -z "$(ls -A "$work/$m.upstream")" ]; then
    rm -rf "${work:?}/${m:?}.upstream"; rmdir "$work" 2>/dev/null || true
    die "$repo@${commit:0:7} has no $path (moved or removed upstream: change its path in sources.json first)"
  fi
  # Only a tag names a version; a branch moves on, so the commit alone is kept for it.
  if git -C "$TMP/repo" ls-remote --exit-code --tags origin "refs/tags/$ref" >/dev/null 2>&1; then tag="$ref"; else tag=""; fi
  printf '%s\t%s\n' "$commit" "$tag" >"$work/$m.ref"
  pristine "$m" "$TMP/old"
  pristine "$m" "$TMP/new" "$work/$m.upstream"
  build_mod "$m" "$TMP/mine" noshared
  conflicts="$(merge_trees "$TMP/old" "$TMP/mine" "$TMP/new" "$work/$m")"
  if [ -z "$conflicts" ]; then finish_update "$m"; return; fi
  echo "$m: my patch doesn't go onto $repo@${commit:0:7} by itself. Fix these in work/$m/:"
  printf '%s\n' "$conflicts" | sed 's/^/  /'
  echo "then run ./sync.sh update $m --continue"
}

finish_update() { # mod
  local m="$1" commit tag left
  [ -d "$work/$m" ] && [ -d "$work/$m.upstream" ] && [ -f "$work/$m.ref" ] || die "no update of $m in progress"
  left="$(grep -rlE '^(<<<<<<<|>>>>>>>) ' "$work/$m" || true)"
  [ -z "$left" ] || die "conflict markers are still in: $(echo $left | sed "s|$work/||g")"
  IFS=$'\t' read -r commit tag <"$work/$m.ref" || true
  rm -rf "${here:?}/upstream/${m:?}"
  mv "$work/$m.upstream" "$here/upstream/$m"
  make_patch "$m" "$work/$m"
  jq --arg m "$m" --arg c "$commit" --arg t "$tag" \
    '.mods[$m].upstream.commit = $c | if $t == "" then del(.mods[$m].upstream.ref) else .mods[$m].upstream.ref = $t end' \
    "$src" >"$TMP/sources.json"
  mv "$TMP/sources.json" "$src"
  rm -rf "${work:?}/${m:?}" "${work:?}/${m:?}.ref"
  echo "$m is on $(origin_of "$m") with my patch on top. ./sync.sh apply installs it; check it in the app."
}

case "${1:-}" in
  build) build_all "$here/build/mods"; echo "built $(built_mods | wc -l | tr -d ' ') mods into build/mods" ;;
  apply) apply ;;
  backup) backup ;;
  status) status ;;
  update) shift; update "$@" ;;
  *) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
