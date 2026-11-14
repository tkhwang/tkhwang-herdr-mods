#!/usr/bin/env bash
# Build the Herdr app's mods from other people's code and my changes to it, and keep the app in step.
#
#   ./sync.sh build                   upstream + my patches + my shared files -> build/mods
#   ./sync.sh apply                   build, then install it and config/ into ~/.config/herdr-app
#   ./sync.sh backup                  ~/.config/herdr-app -> patches/, own/, config/
#   ./sync.sh status                  each mod: where it's from, my patch's size, whether the app has it
#   ./sync.sh update [--dry-run]      every upstream to its newest version, keeping my patches; one my
#                                     patch doesn't go onto is left as it is, and it says why; a dry
#                                     run only fetches the upstream repositories into work/.cache
#   ./sync.sh update NAME [REF]       one mod or themes/FILE, to REF (tag, branch or full commit) or its
#                                     newest; a merge that needs a hand waits in work/NAME
#   ./sync.sh update NAME --continue  finish it after fixing what waits in work/NAME
#   ./sync.sh update NAME --abort     drop it
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
# Beside the app's own files: what apply installed last (see record_install), which the
# tkhwang-update mod compares with this repository on GitHub.
RECORD=tkhwang-herdr-mods.json

# Marks on what a run prints: [*] news along the way, [+] something done, [-] something wrong.
# A mark is colored when its own line goes to a terminal (stderr for die), unless NO_COLOR is
# set (no-color.org) or TERM is dumb.
mark() { # color mark message
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    printf '\033[%sm%s\033[0m %s\n' "$1" "$2" "$3"
  else
    printf '%s %s\n' "$2" "$3"
  fi
}
info() { mark '1;34' '[*]' "$*"; }
ok() { mark '1;32' '[+]' "$*"; }
bad() { mark '1;31' '[-]' "$*"; }
die() { bad "$*" >&2; exit 1; }
for tool in jq git rsync curl shasum perl; do command -v "$tool" >/dev/null 2>&1 || die "needs $tool"; done

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

# Rewrites sources.json through jq, keeping its layout: a list of plain values stays on one line.
edit_sources() { # jq arguments...
  jq "$@" "$src" | perl -0777 -pe 's{\[\n\s*((?:"[^"\\\n]*"|-?[0-9.]+)(?:,\n\s*(?:"[^"\\\n]*"|-?[0-9.]+))*)\n\s*\]}{my $x = $1; $x =~ s/,\n\s*/, /g; "[$x]"}ge' >"$src.new"
  mv "$src.new" "$src"
}

# ── building ──────────────────────────────────────────────────────────────────

# Other people's code for a mod: its upstream, then single files taken from elsewhere.
pristine() { # mod dest [upstream dir] [extras dir]
  local up="${3:-$here/upstream/$1}" ex="${4:-$here/upstream/$1.extra}"
  rm -rf "${2:?}"; mkdir -p "$2"
  rsync -a "$up/" "$2/"
  if [ -d "$ex" ]; then rsync -a "$ex/" "$2/"; fi
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

# A patch from the tree `base` to the tree `final`, written to `out`; removed when they're the same.
diff_trees() { # base final out
  local t="$TMP/diff" rc=0
  rm -rf "$t"; mkdir -p "$t"
  rsync -a "$1/" "$t/a/"
  rsync -a "$2/" "$t/b/"
  (cd "$t" && git -c core.quotepath=false diff --no-index --no-color --no-ext-diff --no-renames --binary --no-prefix a b) >"$t/p" || rc=$?
  [ "$rc" -le 1 ] || die "could not diff $2"
  if [ -s "$t/p" ]; then cp "$t/p" "$3"; else rm -f "$3"; fi
}

# patches/<mod>.patch: from the mod's upstream to `final` (which has no shared files).
# Removed when the mod is its upstream as is.
make_patch() { # mod final
  pristine "$1" "$TMP/pristine-$1"
  diff_trees "$TMP/pristine-$1" "$2" "$here/patches/$1.patch"
}

# A patch's size as lines added and removed, or "none".
patch_size() { # file
  if [ -f "$1" ]; then
    awk '/^(\+\+\+|---) /{next} /^\+/{a++} /^-/{d++} END{printf "+%d -%d", a, d}' "$1"
  else echo none; fi
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
      bad "$f differs between the mods that share it:" >&2
      users_of "$f" | while IFS= read -r m; do echo "    $(shasum -a 256 "$live/mods/$m/$f" | cut -c1-12)  mods/$m/$f" >&2; done
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
    # Its shared files go back to own/shared/ (below), not into own/mods/.
    local shared=()
    while IFS= read -r f; do shared+=(--exclude "/$f"); done < <(shared_of "$m")
    rsync -a --delete "${EXCLUDE[@]}" ${shared[@]+"${shared[@]}"} "$live/mods/$m/" "$here/own/mods/$m/"
  done < <(own_mods)
  while IFS= read -r f; do cp "$TMP/shared/$f" "$here/own/shared/$f"; done < <(all_shared)
  while IFS= read -r f; do
    [ -f "$live/$f" ] || die "missing file: $live/$f"
    mkdir -p "$here/config/$(dirname "$f")"
    cp "$live/$f" "$here/config/$f"
  done < <(q '.config[]')
  ok "backed up $live -> $here"
  git -C "$here" status --short -- . || true
}

# ── apply ─────────────────────────────────────────────────────────────────────

# Moves `path` (relative to the app folder) into this run's backup folder.
stash() {
  local dest="$live.bak-$stamp/$1"
  mkdir -p "$(dirname "$dest")"
  mv "$live/$1" "$dest"
  info "backed up $1 -> $dest"
}

# Moves the staged copy of `path` into place, stashing the live one. Both moves stay on one disk.
swap() {
  if [ -e "$live/$1" ]; then stash "$1"; fi
  mkdir -p "$(dirname "$live/$1")"
  mv "$stage/$1" "$live/$1"
}

raw() { echo "https://raw.githubusercontent.com/$1/$2/$3"; } # repo commit path

# Records what this run installed, for tkhwang-update: the commit it was built from and that
# commit's tree (the same files under another commit, such as the merge of the pull request they
# came from, count as installed), the checkout's branch, and whether it had changes of its own.
# A copy tkhwang-update downloaded has no .git: its commit and tree come in
# TKHWANG_HERDR_MODS_COMMIT and TKHWANG_HERDR_MODS_TREE.
record_install() {
  local commit="${TKHWANG_HERDR_MODS_COMMIT:-}" tree="${TKHWANG_HERDR_MODS_TREE:-}" branch="" dirty=false what
  if [ -z "$commit" ] && [ -e "$here/.git" ]; then
    commit="$(git -C "$here" rev-parse -q --verify HEAD || true)"
    tree="$(git -C "$here" rev-parse -q --verify 'HEAD^{tree}' || true)"
    branch="$(git -C "$here" symbolic-ref -q --short HEAD || true)"
    if [ -n "$(git -C "$here" status --porcelain)" ]; then dirty=true; fi
  fi
  jq -n --arg commit "$commit" --arg tree "$tree" --arg branch "$branch" --argjson dirty "$dirty" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    'def opt: if . == "" then null else . end;
     {commit: ($commit | opt), tree: ($tree | opt), branch: ($branch | opt), dirty: $dirty, applied_at: $at}' \
    >"$stage/$RECORD"
  mv "$stage/$RECORD" "$live/$RECORD"
  what="${commit:0:7}"
  if [ -z "$what" ]; then what="no commit (not a git checkout)"; fi
  if [ -n "$branch" ]; then what="$what on $branch"; fi
  if [ "$dirty" = true ]; then what="$what, with local changes"; fi
  ok "recorded $RECORD: $what"
}

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
    if [ -d "$live/mods/$m" ] && same_tree "$TMP/mods/$m" "$live/mods/$m"; then info "same: mods/$m"; continue; fi
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
    if [ "$whole" = 1 ] && [ "$(cat "$live/mods/$m/.revision" 2>/dev/null)" = "$commit" ]; then info "same: mods/$m"; continue; fi
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
      info "checking mods/$m"
      herdr-app check "$stage/mods/$m" || die "herdr-app check rejected mods/$m; nothing was installed"
    done
  fi
  for m in $changed; do swap "mods/$m"; ok "installed mods/$m"; done
  # Themes go in before the config, so the layout never names a missing one.
  while IFS=$'\t' read -r repo commit path sum; do
    f="themes/$(basename "$path")"
    if [ -f "$live/$f" ] && [ "$(shasum -a 256 "$live/$f" | cut -d' ' -f1)" = "$sum" ]; then info "same: $f"; continue; fi
    mkdir -p "$stage/themes"
    curl -fsSL "$(raw "$repo" "$commit" "$path")" -o "$stage/$f" || die "could not fetch $f from $repo"
    [ "$(shasum -a 256 "$stage/$f" | cut -d' ' -f1)" = "$sum" ] || die "$f from $repo does not match its pinned sha256"
    swap "$f"
    ok "installed $f ($repo@${commit:0:7})"
  done < <(q '.themes[] | [.repo, .commit, .path, .sha256] | @tsv')
  while IFS= read -r f; do
    if [ -f "$live/$f" ] && cmp -s "$here/config/$f" "$live/$f"; then info "same: $f"; continue; fi
    mkdir -p "$stage/$(dirname "$f")"
    cp "$here/config/$f" "$stage/$f"
    swap "$f"
    ok "installed $f"
  done < <(q '.config[]')
  # Last, so a run that stopped part way keeps the record of the install before it.
  record_install
  info "restart Herdr if a mod folder was new, then pick the layout with ⌘⇧L"
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
      *) from="$(origin_of "$m")"; patch="$(patch_size "$here/patches/$m.patch")" ;;
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
  if [ -f "$live/$RECORD" ]; then
    info "last apply: $(jq -r '(if .commit then .commit[0:7] else "no commit" end)
      + (if .branch then " on \(.branch)" else "" end) + (if .dirty then ", with local changes" else "" end)
      + ", \(.applied_at // "at an unknown time")"' "$live/$RECORD")"
  fi
}

# ── upstream repositories ─────────────────────────────────────────────────────

# Each upstream repository is kept in work/.cache as a blobless clone: its whole history, with a
# file's contents downloaded only when something reads them. Each is fetched once a run.
cache="$work/.cache"
fetched=" "
repo_dir() { echo "$cache/$(echo "$1" | tr / _).git"; }

open_repo() { # repo
  local d head
  d="$(repo_dir "$1")"
  case "$fetched" in *" $1 "*) return 0 ;; esac
  if [ -d "$d" ]; then
    git -C "$d" fetch -q --prune --tags --force origin 2>/dev/null || return 1
  else
    mkdir -p "$cache"
    git clone -q --bare --filter=blob:none "https://github.com/$1.git" "$d" 2>/dev/null || { rm -rf "$d"; return 1; }
    git -C "$d" config remote.origin.fetch '+refs/heads/*:refs/heads/*'
  fi
  # HEAD follows the default branch, which upstream can rename.
  head="$(git -C "$d" ls-remote --symref origin HEAD 2>/dev/null | awk '$1 == "ref:" {print $2; exit}' || true)"
  if [ -n "$head" ]; then git -C "$d" symbolic-ref HEAD "$head"; fi
  fetched="$fetched$1 "
}

# The commit `ref` names in repository `d`: a tag, a branch, HEAD or a commit.
commit_of() { # d ref
  git -C "$1" rev-parse -q --verify "$2^{commit}" 2>/dev/null ||
    { git -C "$1" fetch -q origin "$2" 2>/dev/null && git -C "$1" rev-parse -q --verify 'FETCH_HEAD^{commit}'; }
}

# The version of Herdr installed here, which the clones of its mods follow ("" when it isn't).
app_version() {
  if command -v herdr-app >/dev/null 2>&1; then herdr-app --version 2>/dev/null | awk '{print $NF; exit}' || true; fi
}

# What a pin moves to when no REF is given: a Herdr clone to the version of Herdr installed here
# (else Herdr's newest release), a pin on a tag to the newest release tag, any other pin to the head
# of the default branch.
newest() { # d kind ref
  local t=""
  if [ "$2" = herdr ] && [ -n "$herdr_version" ] && git -C "$1" show-ref -q --verify "refs/tags/v$herdr_version"; then
    echo "v$herdr_version"; return 0
  fi
  if [ "$2" = herdr ] || [ -n "$3" ]; then
    t="$(git -C "$1" tag -l --sort=-v:refname | grep -E '^v?[0-9]+(\.[0-9]+)*$' | head -n 1 || true)"
  fi
  echo "${t:-HEAD}"
}

# The files of `path` at `commit` in repository `d`, into `dest`.
extract() { # d commit path dest
  local depth
  depth="$(echo "$3" | tr '/' '\n' | grep -c .)"
  rm -rf "${4:?}"; mkdir -p "$4"
  git -C "$1" archive "$2" "$3" 2>/dev/null | tar -x -C "$4" --strip-components="$depth" && [ -n "$(ls -A "$4")" ]
}

# Where upstream moved the folder `path` between two commits: the mod folder (the one with a
# mod.json) most of its files went to.
moved_to() { # d old new path
  local to
  to="$(git -C "$1" diff -M --name-status "$2" "$3" 2>/dev/null |
    awk -F '\t' -v p="$4/" '$1 ~ /^R/ && index($2, p) == 1 {
      rest = substr($2, length(p) + 1); cut = length($3) - length(rest)
      if (cut > 1 && substr($3, cut + 1) == rest) print substr($3, 1, cut - 1) }' |
    sort | uniq -c | sort -rn | awk 'NR == 1 {print $2}' || true)"
  # Files can also move deeper in the mod (into an icons/ folder, say).
  while [ -n "$to" ] && ! git -C "$1" cat-file -e "$3:$to/mod.json" 2>/dev/null; do
    case "$to" in */*) to="${to%/*}" ;; *) to="" ;; esac
  done
  echo "$to"
}

# A mod's upstream as it runs under its name here. Herdr's mod.clone (clone_mod_at in Herdr's
# src/mods.rs) points a clone's own asset paths and overlay names at the clone's name and records
# cloned_from in its mod.json; my patch carries those changes. Made on both sides of an update, it
# lets the merge see only what I changed, and renames new upstream code too. A mod kept under
# another name than its upstream folder's gets the same renames.
as_named() { # mod dir from version
  local f json
  if [ "$3" != "$1" ]; then
    { grep -rlIF -e "$3" "$2" || true; } | while IFS= read -r f; do
      FROM="$3" TO="$1" perl -0777 -pi -e '
        my ($f, $t) = @ENV{qw(FROM TO)};
        my @swap = (["mods/$f/", "mods/$t/"], ["\"mods/$f\"", "\"mods/$t\""], ["\x27mods/$f\x27", "\x27mods/$t\x27"]);
        for my $k ("mod", "\"mod\"", "\x27mod\x27") { for my $s ("", " ") { for my $q ("\"", "\x27") {
          push @swap, ["$k:$s$q$f$q", "$k:$s$q$t$q"];
        } } }
        for my $r (@swap) { my ($x, $y) = @$r; s/\Q$x\E/$y/g }' "$f"
    done
  fi
  if [ "$(kind_of "$1")" = herdr ]; then
    if [ -f "$2/mod.json" ]; then json="$(jq --arg n "$3" --arg v "$4" '. + {cloned_from: {name: $n, version: $v}}' "$2/mod.json")"
    else json="$(jq -n --arg n "$3" --arg v "$4" '{cloned_from: {name: $n, version: $v}}')"; fi
    printf '%s' "$json" >"$2/mod.json"
  fi
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

dry=0          # --dry-run: say what would happen, write nothing
alone=0        # one NAME given: a merge that needs a hand waits in work/NAME
herdr_version=""
rc=0
# jq: moves .mods[$m].upstream to commit $c and tag $t (none when ""), its keys in the same order.
repin='.mods[$m].upstream |= ({repo} + (if $t == "" then {} else {ref: $t} end) + {commit: $c} + del(.repo, .ref, .commit))'

# Runs a command in a subshell with errexit in force and leaves its status in rc, for a caller that
# goes on either way: errexit is off inside anything an if, || or && tests.
attempt() { set +e; ( set -e; "$@" ); rc=$?; set -e; }

pin_name() { if [ -n "$1" ]; then echo "$1"; else echo "${2:0:7}"; fi; } # ref commit
stays() { if [ "$dry" = 1 ]; then echo "would stay on"; else echo "left on"; fi; }

# Ends an update that changed nothing: says why, then each hint on a line of its own.
left() { # name pin why [hint...]
  local h
  bad "$1: $(stays) $2: $3"
  shift 3
  for h in "$@"; do echo "      $h"; done
  exit 1
}

# How far `new` is from `old` in `path`: "3 commits in path", or "3 commits back in path".
span() { # d old new path
  local n
  if [ "$2" != "$3" ] && git -C "$1" merge-base --is-ancestor "$3" "$2" 2>/dev/null; then
    n="$(git -C "$1" rev-list --count "$3..$2" -- "$4")"
    echo "$n commit$([ "$n" = 1 ] || echo s) back in $4"
  else
    n="$(git -C "$1" rev-list --count "$2..$3" -- "$4")"
    echo "$n commit$([ "$n" = 1 ] || echo s) in $4"
  fi
}

# The upstream commits that changed `path` from `old` to `new`, a few at most.
came_in() { # d old new path
  local n
  n="$(git -C "$1" rev-list --count "$2..$3" -- "$4" 2>/dev/null || echo 0)"
  git -C "$1" log --format='%h %<(72,trunc)%s' "$2..$3" -- "$4" 2>/dev/null | head -n 5 | sed -e 's/ *$//' -e 's/^/      /' || true
  if [ "$n" -gt 5 ]; then echo "      and $((n - 5)) more"; fi
}

# Says when a source's license files changed between two commits: licenses/ keeps them as shipped.
license_note() { # d repo old new license
  local files
  [ -n "$5" ] && [ "$3" != "$4" ] || return 0
  files="$(git -C "$1" diff --name-only --no-renames "$3" "$4" -- 'LICENSE*' 'NOTICE*' 'COPYING*' 2>/dev/null | tr '\n' ' ' || true)"
  files="${files% }"
  [ -z "$files" ] || info "licenses/$5/: $2 changed $files since ${3:0:7} (git -C work/.cache/${1##*/} diff ${3:0:7} ${4:0:7} -- $files)"
}

# Says which README lines name an old pin (any of `tokens`): in the section about `name`, or beside
# its name for a commit (a version such as 0.1.11 can be another mod's there).
readme_note() { # name token...
  local name="$1" lines
  shift
  lines="$(awk -v name="$name" -v toks="$*" '
    BEGIN { n = split(toks, tok, " ") }
    /<summary>/ { mine = index($0, ">" name "<") > 0 }
    { for (i = 1; i <= n; i++)
        if (index($0, tok[i]) && (mine || (index($0, name) && tok[i] ~ /^[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]$/))) {
          out = out (out == "" ? "" : ", ") NR; break } }
    /<\/details>/ { mine = 0 }
    END { print out }' "$here/README.md")"
  [ -z "$lines" ] || info "README.md still names the old version on lines $lines"
}

# What an update merged from: my patch and the mod's entry in sources.json, as one hash.
baseline_of() { # mod
  { if [ -f "$here/patches/$1.patch" ]; then cat "$here/patches/$1.patch"; else echo "no patch"; fi
    q -c --arg m "$1" '.mods[$m]'; } | shasum -a 256 | cut -d' ' -f1
}

# A merge that needs a hand waits in work/: the merged files (with any conflict markers) in
# work/NAME, the new upstream and extras beside them, and what to pin once it's done, with the
# baseline it was merged from.
wait_in_work() { # mod w commit tag extras-json
  local m="$1"
  mkdir -p "$work"
  rm -rf "${work:?}/${m:?}" "$work/$m.upstream" "$work/$m.extra"
  mv "$2/out" "$work/$m"
  mv "$2/up" "$work/$m.upstream"
  if [ -d "$2/extra" ]; then mv "$2/extra" "$work/$m.extra"; fi
  jq -n --arg c "$3" --arg t "$4" --argjson ex "$5" --arg b "$(baseline_of "$m")" \
    '{commit: $c, ref: $t, extras: $ex, baseline: $b}' >"$work/$m.json"
}

# Takes a merged mod when it holds up: my patch against the new upstream builds exactly the merged
# files, and herdr-app check passes the mod with its shared files. Then its new upstream, extras,
# patch and pins are written together.
take_mod() { # mod upstream extras merged commit tag extras-json
  local m="$1" up="$2" ex="$3" out="$4" new="$5" tag="$6" exj="$7" w="$TMP/take-$1"
  local f repo old ref p lic g size extras_before erepo eold epath elic tokens=""
  repo="$(q --arg m "$m" '.mods[$m].upstream.repo')"
  old="$(q --arg m "$m" '.mods[$m].upstream.commit')"
  ref="$(q --arg m "$m" '.mods[$m].upstream.ref // ""')"
  p="$(q --arg m "$m" '.mods[$m].upstream.path')"
  lic="$(q --arg m "$m" '.mods[$m].license // ""')"
  g="$(repo_dir "$repo")"
  rm -rf "$w"; mkdir -p "$w"
  pristine "$m" "$w/raw" "$up" "$ex"
  diff_trees "$w/raw" "$out" "$w/patch"
  pristine "$m" "$w/mod" "$up" "$ex"
  if [ -f "$w/patch" ]; then apply_patch "$w/patch" "$w/mod" || die "$m: its new patch doesn't apply to the new upstream"; fi
  same_tree "$w/mod" "$out" || die "$m: its new patch doesn't build what was merged"
  while IFS= read -r f; do cp "$here/own/shared/$f" "$w/mod/$f"; done < <(shared_of "$m")
  if command -v herdr-app >/dev/null 2>&1; then
    info "checking mods/$m"
    if ! herdr-app check "$w/mod" >"$w/check.log" 2>&1; then
      bad "$m: $(stays) $(pin_name "$ref" "$old"): herdr-app check rejects it with my patch on top:"
      sed "s|$w/mod|mods/$m|g" "$w/check.log" | grep -v '^[[:space:]]*$' | tail -n 20 | sed 's/^/      /'
      return 1
    fi
  fi
  size="$(patch_size "$here/patches/$m.patch") -> $(patch_size "$w/patch")"
  if [ "$size" = "none -> none" ]; then size="no patch of mine"; else size="my patch $size"; fi
  if [ "$dry" = 1 ]; then ok "$m: would move to $repo@$(pin_name "$tag" "$new"), $size"; return 0; fi
  extras_before="$(q --arg m "$m" --argjson ex "$exj" '.mods[$m].extras // [] | .[] | select($ex[.file]) | [.file, .repo, .commit, .path, (.license // "")] | @tsv')"
  # Written all together: a Ctrl-C waits until it's done.
  trap '' INT TERM HUP
  rsync -a --delete "$up/" "$here/upstream/$m/"
  for f in $(jq -r 'keys[]' <<<"$exj"); do cp "$ex/$f" "$here/upstream/$m.extra/$f"; done
  if [ -f "$w/patch" ]; then cp "$w/patch" "$here/patches/$m.patch"; else rm -f "$here/patches/$m.patch"; fi
  edit_sources --arg m "$m" --arg c "$new" --arg t "$tag" --argjson ex "$exj" \
    "$repin"' | if .mods[$m].extras then .mods[$m].extras |= map(.commit = ($ex[.file] // .commit)) else . end'
  trap - INT TERM HUP
  ok "$m: on $repo@$(pin_name "$tag" "$new") now, $size"
  if [ "$new" != "$old" ]; then
    came_in "$g" "$old" "$new" "$p"
    license_note "$g" "$repo" "$old" "$new" "$lic"
    tokens="${old:0:7} $ref ${ref#v}"
  fi
  while IFS=$'\t' read -r f erepo eold epath elic; do
    [ -n "$f" ] || continue
    license_note "$(repo_dir "$erepo")" "$erepo" "$eold" "$(jq -r --arg f "$f" '.[$f]' <<<"$exj")" "$elic"
    tokens="$tokens ${eold:0:7}"
  done <<<"$extras_before"
  # shellcheck disable=SC2086 # one word a token
  readme_note "$m" $tokens
}

# One mod built on an upstream: a three-way merge of its old upstream, its old upstream with my
# patch, and its new upstream, both upstreams as they run under its name here (as_named).
update_mod() { # mod [ref]
  local m="$1" given="${2:-}" repo old p ref from g to new tag w pin f erepo eold epath eg enew
  local exj="{}" changed=0 moved oldver="" newver="" conflicts
  repo="$(q --arg m "$m" '.mods[$m].upstream.repo')"
  old="$(q --arg m "$m" '.mods[$m].upstream.commit')"
  p="$(q --arg m "$m" '.mods[$m].upstream.path')"
  ref="$(q --arg m "$m" '.mods[$m].upstream.ref // ""')"
  from="${p##*/}" pin="$(pin_name "$ref" "$old")"
  [ ! -e "$work/$m" ] || left "$m" "$pin" "an update waits in work/$m" "./sync.sh update $m --continue finishes it, --abort drops it"
  open_repo "$repo" || left "$m" "$pin" "could not fetch $repo"
  g="$(repo_dir "$repo")"
  to="${given:-$(newest "$g" "$(kind_of "$m")" "$ref")}"
  new="$(commit_of "$g" "$to")" || left "$m" "$pin" "$repo has no $to"
  if git -C "$g" show-ref -q --verify "refs/tags/$to"; then tag="$to"; else tag=""; fi
  commit_of "$g" "$old" >/dev/null || left "$m" "$pin" "$repo no longer has ${old:0:7}"
  w="$TMP/update-$m"
  rm -rf "$w"; mkdir -p "$w"
  # The merge starts from upstream/, so it has to be what upstream ships: what differs would be lost.
  if git -C "$g" cat-file -e "$old:$p" 2>/dev/null; then
    extract "$g" "$old" "$p" "$w/pinned" || left "$m" "$pin" "could not read $p at ${old:0:7}"
    same_tree "$w/pinned" "$here/upstream/$m" ||
      left "$m" "$pin" "upstream/$m isn't $repo@${old:0:7} as shipped" "put back what $repo ships there, and keep my change in patches/$m.patch"
  fi
  # Its extras follow the head of their default branches.
  if [ -d "$here/upstream/$m.extra" ]; then mkdir -p "$w/extra"; rsync -a "$here/upstream/$m.extra/" "$w/extra/"; fi
  while IFS=$'\t' read -r f erepo eold epath; do
    open_repo "$erepo" || left "$m" "$pin" "could not fetch $erepo, which $f comes from"
    eg="$(repo_dir "$erepo")"
    commit_of "$eg" "$eold" >/dev/null || left "$m" "$pin" "$erepo no longer has ${eold:0:7}, which $f is pinned at"
    git -C "$eg" show "$eold:$epath" 2>/dev/null | cmp -s - "$here/upstream/$m.extra/$f" ||
      left "$m" "$pin" "upstream/$m.extra/$f isn't $erepo@${eold:0:7}:$epath as shipped"
    enew="$(commit_of "$eg" HEAD)" || left "$m" "$pin" "could not read $erepo"
    if [ "$enew" = "$eold" ] || git -C "$eg" diff --quiet --no-renames "$eold" "$enew" -- "$epath" 2>/dev/null; then continue; fi
    git -C "$eg" show "$enew:$epath" >"$w/extra/$f" 2>/dev/null ||
      left "$m" "$pin" "$erepo@${enew:0:7} has no $epath, which $f comes from (moved or removed upstream)"
    exj="$(jq -c --arg f "$f" --arg c "$enew" '. + {($f): $c}' <<<"$exj")"
    info "$m: $f from $erepo ${eold:0:7} -> ${enew:0:7}"
  done < <(q --arg m "$m" '.mods[$m].extras // [] | .[] | [.file, .repo, .commit, .path] | @tsv')
  if ! git -C "$g" cat-file -e "$new:$p" 2>/dev/null; then
    moved="$(moved_to "$g" "$old" "$new" "$p")"
    [ -z "$moved" ] || left "$m" "$pin" "$repo moved $p to $moved at $(pin_name "$tag" "$new")" \
      "to follow it, set its upstream path in sources.json to \"$moved\", then ./sync.sh update $m"
    left "$m" "$pin" "$repo@$(pin_name "$tag" "$new") has no $p (removed upstream?)"
  fi
  if [ "$new" != "$old" ] && ! git -C "$g" diff --quiet --no-renames "$old" "$new" -- "$p" 2>/dev/null; then changed=1; else new="$old" tag="$ref"; fi
  if [ "$changed" = 0 ] && [ "$exj" = "{}" ]; then
    if [ "$alone" = 1 ]; then info "$m is already on $pin: nothing in $p changed upstream since"; fi
    exit 10
  fi
  if [ "$changed" = 1 ] && [ -z "$given" ] && ! git -C "$g" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    left "$m" "$pin" "$to (${new:0:7}) isn't ahead of it" "./sync.sh update $m REF takes another version"
  fi
  if [ "$changed" = 1 ]; then
    info "$m: $repo $pin -> $(pin_name "$tag" "$new"), $(span "$g" "$old" "$new" "$p")"
    extract "$g" "$new" "$p" "$w/up" || left "$m" "$pin" "could not read $p at ${new:0:7}"
  else
    mkdir -p "$w/up"; rsync -a "$here/upstream/$m/" "$w/up/"
  fi
  build_mod "$m" "$w/mine" noshared
  if [ "$(kind_of "$m")" = herdr ]; then
    oldver="$(jq -r '.cloned_from.version // empty' "$w/mine/mod.json" 2>/dev/null || true)"
    newver="$(git -C "$g" show "$new:Cargo.toml" 2>/dev/null | awk -F '"' '/^version *=/ {print $2; exit}' || true)"
    oldver="${oldver:-${ref#v}}" newver="${newver:-${tag#v}}"
  fi
  pristine "$m" "$w/old"; as_named "$m" "$w/old" "$from" "$oldver"
  pristine "$m" "$w/new" "$w/up" "$w/extra"; as_named "$m" "$w/new" "$from" "$newver"
  conflicts="$(merge_trees "$w/old" "$w/mine" "$w/new" "$w/out")"
  if [ -n "$conflicts" ]; then
    if [ "$alone" = 1 ] && [ "$dry" = 0 ]; then
      wait_in_work "$m" "$w" "$new" "$tag" "$exj"
      bad "$m: my patch doesn't go onto $repo@$(pin_name "$tag" "$new") by itself. Fix these in work/$m/:"
      printf '%s\n' "$conflicts" | sed 's/^/      /'
      info "then ./sync.sh update $m --continue, or --abort to drop it"
      exit 1
    fi
    bad "$m: $(stays) $pin: my patch doesn't go onto $(pin_name "$tag" "$new") by itself, in:"
    printf '%s\n' "$conflicts" | sed 's/^/      /'
    if [ "$dry" = 0 ]; then echo "      ./sync.sh update $m${given:+ $given} leaves them in work/$m to merge by hand"; fi
    exit 1
  fi
  attempt take_mod "$m" "$w/up" "$w/extra" "$w/out" "$new" "$tag" "$exj"
  if [ "$rc" != 0 ] && [ "$dry" = 0 ]; then
    if [ "$alone" = 1 ]; then
      wait_in_work "$m" "$w" "$new" "$tag" "$exj"
      info "fix it in work/$m/, then ./sync.sh update $m --continue, or --abort to drop it"
    else
      echo "      ./sync.sh update $m${given:+ $given} leaves it in work/$m to fix by hand"
    fi
  fi
  exit "$rc"
}

# A mod apply downloads: only its pin moves, once its files are there and herdr-app check passes them.
update_fetch() { # mod [ref]
  local m="$1" given="${2:-}" repo old p ref g to new tag pin f added w="$TMP/update-$1" files=()
  repo="$(q --arg m "$m" '.mods[$m].upstream.repo')"
  old="$(q --arg m "$m" '.mods[$m].upstream.commit')"
  p="$(q --arg m "$m" '.mods[$m].upstream.path')"
  ref="$(q --arg m "$m" '.mods[$m].upstream.ref // ""')"
  pin="$(pin_name "$ref" "$old")"
  open_repo "$repo" || left "$m" "$pin" "could not fetch $repo"
  g="$(repo_dir "$repo")"
  to="${given:-$(newest "$g" fetch "$ref")}"
  new="$(commit_of "$g" "$to")" || left "$m" "$pin" "$repo has no $to"
  if git -C "$g" show-ref -q --verify "refs/tags/$to"; then tag="$to"; else tag=""; fi
  commit_of "$g" "$old" >/dev/null || left "$m" "$pin" "$repo no longer has ${old:0:7}"
  while IFS= read -r f; do files+=("$p/$f"); done < <(q --arg m "$m" '.mods[$m].upstream.files[]')
  if [ "$new" = "$old" ] || git -C "$g" diff --quiet --no-renames "$old" "$new" -- ${files[@]+"${files[@]}"} 2>/dev/null; then
    if [ "$alone" = 1 ]; then info "$m is already on $pin: none of its files changed upstream since"; fi
    exit 10
  fi
  if [ -z "$given" ] && ! git -C "$g" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    left "$m" "$pin" "$to (${new:0:7}) isn't ahead of it" "./sync.sh update $m REF takes another version"
  fi
  info "$m: $repo $pin -> $(pin_name "$tag" "$new"), $(span "$g" "$old" "$new" "$p")"
  rm -rf "$w"; mkdir -p "$w/mod"
  while IFS= read -r f; do
    mkdir -p "$(dirname "$w/mod/$f")"
    git -C "$g" show "$new:$p/$f" >"$w/mod/$f" 2>/dev/null || left "$m" "$pin" "$repo@$(pin_name "$tag" "$new") has no $p/$f"
  done < <(q --arg m "$m" '.mods[$m].upstream.files[]')
  if command -v herdr-app >/dev/null 2>&1; then
    info "checking mods/$m"
    if ! herdr-app check "$w/mod" >"$w/check.log" 2>&1; then
      bad "$m: $(stays) $pin: herdr-app check rejects $repo@$(pin_name "$tag" "$new"):"
      sed "s|$w/mod|mods/$m|g" "$w/check.log" | grep -v '^[[:space:]]*$' | tail -n 20 | sed 's/^/      /'
      exit 1
    fi
  fi
  # Files upstream added beside them, but not the ones the app writes into every mod folder.
  added="$(comm -13 <(git -C "$g" ls-tree -r --name-only "$old" -- "$p/" | sort) <(git -C "$g" ls-tree -r --name-only "$new" -- "$p/" | sort) |
    grep -vE '(\.d\.ts|/jsconfig\.json|/\.DS_Store)$' | tr '\n' ' ' || true)"
  if [ "$dry" = 1 ]; then
    ok "$m: would move to $repo@$(pin_name "$tag" "$new")"
  else
    edit_sources --arg m "$m" --arg c "$new" --arg t "$tag" "$repin"
    ok "$m: on $repo@$(pin_name "$tag" "$new") now"
    came_in "$g" "$old" "$new" "$p"
    # shellcheck disable=SC2086 # no ref, no token
    readme_note "$m" "${old:0:7}" $ref
  fi
  if [ -n "$added" ]; then info "$repo added ${added% }: put in $m's files in sources.json what it needs"; fi
  exit 0
}

# A theme apply downloads: its commit and sha256 move, once the new file is JSON.
update_theme() { # file [ref]
  local file="$1" given="${2:-}" name="themes/$1" i repo old p g to new sum w="$TMP/theme-$1"
  i="$(q --arg f "$file" '[.themes[].path | split("/") | last] | index($f) // empty')"
  [ -n "$i" ] || die "sources.json has no theme $file"
  repo="$(q --argjson i "$i" '.themes[$i].repo')"
  old="$(q --argjson i "$i" '.themes[$i].commit')"
  p="$(q --argjson i "$i" '.themes[$i].path')"
  open_repo "$repo" || left "$name" "${old:0:7}" "could not fetch $repo"
  g="$(repo_dir "$repo")"
  to="${given:-HEAD}"
  new="$(commit_of "$g" "$to")" || left "$name" "${old:0:7}" "$repo has no $to"
  commit_of "$g" "$old" >/dev/null || left "$name" "${old:0:7}" "$repo no longer has ${old:0:7}"
  if [ "$new" = "$old" ] || git -C "$g" diff --quiet --no-renames "$old" "$new" -- "$p" 2>/dev/null; then
    if [ "$alone" = 1 ]; then info "$name is already on ${old:0:7}: it hasn't changed upstream since"; fi
    exit 10
  fi
  if [ -z "$given" ] && ! git -C "$g" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    left "$name" "${old:0:7}" "$to (${new:0:7}) isn't ahead of it" "./sync.sh update $name REF takes another version"
  fi
  info "$name: $repo ${old:0:7} -> ${new:0:7}, $(span "$g" "$old" "$new" "$p")"
  git -C "$g" show "$new:$p" >"$w" 2>/dev/null || left "$name" "${old:0:7}" "$repo@${new:0:7} has no $p"
  jq empty "$w" 2>/dev/null || left "$name" "${old:0:7}" "$p isn't JSON at ${new:0:7}"
  sum="$(shasum -a 256 "$w" | cut -d' ' -f1)"
  if [ "$dry" = 1 ]; then ok "$name: would move to $repo@${new:0:7}"; exit 0; fi
  edit_sources --argjson i "$i" --arg c "$new" --arg s "$sum" '.themes[$i].commit = $c | .themes[$i].sha256 = $s'
  ok "$name: on $repo@${new:0:7} now"
  came_in "$g" "$old" "$new" "$p"
  readme_note "$file" "${old:0:7}"
  exit 0
}

# Ends with status 0 when it moved, 10 when it was already up to date, anything else when it stayed.
update_target() { # name [ref]
  case "$1" in
    themes/*) update_theme "${1#themes/}" "${2:-}" ;;
    *)
      case "$(kind_of "$1")" in
        herdr | oss) update_mod "$1" "${2:-}" ;;
        fetch) update_fetch "$1" "${2:-}" ;;
        own) die "$1 is mine: it has no upstream" ;;
        *) die "sources.json has no mod or theme named $1" ;;
      esac
      ;;
  esac
}

# Every upstream in sources.json, each on its own: one that can't move is left as it is.
update_all() {
  local r t repos taken="" stayed="" current=""
  repos="$(q '[.mods[] | .upstream.repo // empty, (.extras // [] | .[].repo)] + [.themes[].repo] | unique | .[]')"
  info "fetching $(echo "$repos" | grep -c .) upstream repositories into work/.cache"
  # Each target fetches its own again if this fails, and says so.
  for r in $repos; do open_repo "$r" || true; done
  for t in $(q '.mods | to_entries[] | select(.value.kind == "herdr" or .value.kind == "oss" or .value.kind == "fetch") | .key') \
    $(q '.themes[] | "themes/" + (.path | split("/") | last)'); do
    attempt update_target "$t"
    case "$rc" in
      0) taken="$taken $t" ;;
      10) current="$current $t" ;;
      *) stayed="$stayed $t" ;;
    esac
  done
  if [ "$dry" = 1 ]; then
    if [ -n "$taken" ]; then ok "would update:$taken"; fi
    if [ -n "$stayed" ]; then bad "would stay as they are:$stayed"; fi
  else
    if [ -n "$taken" ]; then ok "updated:$taken"; fi
    if [ -n "$stayed" ]; then bad "left as they are:$stayed"; fi
  fi
  if [ -n "$current" ]; then info "already up to date:$current"; fi
  if [ -n "$taken" ] && [ "$dry" = 0 ]; then info "next: ./sync.sh apply, check the app, then commit upstream/, patches/ and sources.json"; fi
  [ -z "$stayed" ]
}

# --continue: takes an update that waited in work/NAME, once what needed a hand is fixed.
finish_update() { # name
  local m="$1" st="$work/$1.json" marks
  [ -d "$work/$m" ] && [ -f "$st" ] || die "no update of $m waits in work/$m"
  marks="$(grep -rlE '^(<<<<<<<|>>>>>>>) ' "$work/$m" || true)"
  # shellcheck disable=SC2086 # one line
  [ -z "$marks" ] || die "conflict markers are still in: $(echo $marks | sed "s|$work/||g")"
  # A backup or a checkout meanwhile changed my patch or the pin the merge started from: taking the
  # merge would write over that change, so it stays waiting.
  [ "$(jq -r '.baseline // ""' "$st")" = "$(baseline_of "$m")" ] ||
    die "patches/$m.patch or sources.json changed since work/$m was merged; ./sync.sh update $m --abort, then update it again"
  attempt take_mod "$m" "$work/$m.upstream" "$work/$m.extra" "$work/$m" "$(jq -r .commit "$st")" "$(jq -r .ref "$st")" "$(jq -c .extras "$st")"
  [ "$rc" = 0 ] || die "$m still waits in work/$m: fix it there, then ./sync.sh update $m --continue"
  rm -rf "${work:?}/${m:?}" "$work/$m.upstream" "$work/$m.extra" "$st"
}

# --abort: drops an update that waits in work/NAME; upstream/, patches/ and sources.json never changed.
abort_update() { # name
  local m="$1"
  [ -e "$work/$m" ] || [ -e "$work/$m.json" ] || [ -e "$work/$m.ref" ] || die "no update of $m waits in work/$m"
  rm -rf "${work:?}/${m:?}" "$work/$m.upstream" "$work/$m.extra" "$work/$m.json" "$work/$m.ref"
  ok "dropped the update of $m: upstream/$m, its patch and sources.json are as they were"
}

update() {
  local a args=()
  for a in "$@"; do
    case "$a" in --dry-run) dry=1 ;; *) args+=("$a") ;; esac
  done
  set -- ${args[@]+"${args[@]}"}
  [ $# -le 2 ] || die "usage: ./sync.sh update [--dry-run] [NAME [REF | --continue | --abort]]"
  case "${2:-}" in
    --continue | --abort)
      [ "$dry" = 0 ] || die "--dry-run doesn't go with $2"
      if [ "$2" = --abort ]; then abort_update "$1"; return; fi
      attempt finish_update "$1"
      return "$rc"
      ;;
  esac
  herdr_version="$(app_version)"
  if [ $# -eq 0 ]; then
    if [ "$dry" = 1 ]; then info "a dry run: upstream/, patches/ and sources.json stay as they are; only work/.cache is fetched"; fi
    if [ -n "$herdr_version" ]; then info "Herdr $herdr_version is installed, so its clones follow v$herdr_version"; fi
    update_all
  else
    alone=1
    attempt update_target "$@"
    [ "$rc" = 0 ] || [ "$rc" = 10 ]
  fi
}

case "${1:-}" in
  build) build_all "$here/build/mods"; ok "built $(built_mods | wc -l | tr -d ' ') mods into build/mods" ;;
  apply) apply ;;
  backup) backup ;;
  status) status ;;
  update) shift; update "$@" ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
