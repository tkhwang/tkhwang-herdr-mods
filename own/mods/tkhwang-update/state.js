// tkhwang-update: the state the pill and its window share, and what changes it: asking GitHub,
// reading what `./sync.sh apply` recorded, and running an update.
import { shared, setShared, appHome, readTextFile, exec, openOverlay } from "herdr";
import { REPO, BRANCH, EVERY, RUN_LIMIT, headOf, installedOf, changesOf, unknownChanges, offerOf, runOf } from "./model.js";

const KEY = "tkhwang-update";
// No token and nothing about the person: GitHub only asks for a User-Agent.
const HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "tkhwang-herdr-mods" };

// Beside the app's own files: what apply installed, and the last update's output.
export const stampPath = () => `${appHome()}/tkhwang-herdr-mods.json`;
export const logPath = () => `${appHome()}/tkhwang-herdr-mods.log`;

// Kept in shared state, so it lasts across restarts and the pill and its window see the same:
// - installed: what apply recorded (see installedOf), read again every minute.
// - checked: when GitHub was last asked; head: the branch's newest commit then (see headOf);
//   changes: what it has over the installed commit (see changesOf); error: why a check failed.
// - dismissed: the commit put off with Later; off: checking stopped (Check now starts it again).
// - run: the update running, { sha, tree, at, from, changes }; result: how the last one ended,
//   until the pill is closed.
// State saved for another repository (a fork's) counts as never checked.
export const state = () => {
  const s = shared(KEY) ?? {};
  return s.repo === REPO ? s : { off: s.off === true };
};
export const save = (change) => setShared(KEY, { ...state(), ...change, repo: REPO });

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Reads what apply recorded, saving it when it changed. Returns it.
export async function readInstalled() {
  let installed = null;
  try {
    installed = installedOf(await readTextFile(stampPath()));
  } catch {
    // Unreadable counts as none.
  }
  if (!same(installed, state().installed)) save({ installed });
  return installed;
}

async function getJSON(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers: HEADERS });
  return { status: r.status, json: r.ok ? await r.json() : null };
}

// Asks GitHub for the branch's newest commit, and for what it has over the installed commit when
// that pair is new. At most every EVERY, unless `now` (the installed commit moved) or `manual`
// (Check now, which also starts checking again after Stop checking).
export async function check({ now = false, manual = false } = {}) {
  const s = state();
  if (s.off && !manual) return;
  if (!now && !manual && Date.now() - (s.checked ?? 0) < EVERY) return;
  // Saved before asking, so a second look meanwhile doesn't ask too.
  save({ checked: Date.now(), ...(manual ? { off: false } : {}) });
  const installed = await readInstalled();
  try {
    const answer = await getJSON(`commits/${BRANCH}`);
    if (!answer.json) return save({ error: `GitHub answered ${answer.status}` });
    const head = headOf(answer.json);
    if (!head) return save({ error: "GitHub's answer had no commit" });
    const base = installed?.commit;
    let changes = state().changes ?? null;
    if (!base || base === head.sha) changes = null;
    else if (changes?.base !== base || changes?.head !== head.sha) {
      const compared = await getJSON(`compare/${base}...${head.sha}`);
      // 404: GitHub doesn't have the installed commit, so that pair can't be compared. Any other
      // failure is asked again on the next check.
      changes = compared.json ? changesOf(compared.json, base, head.sha) : compared.status === 404 ? unknownChanges(base, head.sha) : null;
    }
    save({ head, changes, error: null });
  } catch (e) {
    save({ error: String(e?.message ?? e) });
  }
}

// The downloader, run detached by LAUNCH, so it finishes whatever happens to the copy that started
// it (a window closed, this mod reloaded by the update itself, Herdr restarting). It downloads the
// commit from GitHub, runs that copy's ./sync.sh apply against this app folder, and says in the
// log which mod folders apply made (Herdr loads a new one at its next start) and how it ended.
// Arguments: the app folder, the repository, the commit, its tree.
const WORKER = String.raw`home="$1" repo="$2" sha="$3" tree="$4"
[ -n "$TMPDIR" ] || TMPDIR=/tmp
(
  set -eu
  tmp="$(mktemp -d "$TMPDIR/tkhwang-herdr-mods.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  { ls "$home/mods" 2>/dev/null || :; } | LC_ALL=C sort >"$tmp/before"
  echo "[*] downloading $repo@$(printf %.7s "$sha")"
  curl -fsSL -H "User-Agent: tkhwang-herdr-mods" -o "$tmp/src.tar.gz" "https://codeload.github.com/$repo/tar.gz/$sha"
  mkdir "$tmp/src"
  tar -xzf "$tmp/src.tar.gz" -C "$tmp/src" --strip-components 1
  HERDR_APP_HOME="$home" TKHWANG_HERDR_MODS_COMMIT="$sha" TKHWANG_HERDR_MODS_TREE="$tree" bash "$tmp/src/sync.sh" apply
  ls "$home/mods" | LC_ALL=C sort >"$tmp/after"
  fresh="$(LC_ALL=C comm -13 "$tmp/before" "$tmp/after" | tr '\n' ' ')"
  if [ -n "$fresh" ]; then echo "# new mods: $fresh"; fi
)
echo "# exit $?"`;

// Starts a fresh log and the worker in the background, its output in the log and nothing left on
// the pipes exec reads, so exec returns at once. Arguments: those of WORKER, then WORKER itself.
const LAUNCH = String.raw`log="$1/tkhwang-herdr-mods.log"
printf '# update %s\n' "$3" >"$log" || exit 1
nohup sh -c "$5" tkhwang-update "$1" "$2" "$3" "$4" </dev/null >>"$log" 2>&1 &`;

// Starts updating to the branch's newest commit known. settle() ends the run from its log.
export async function startUpdate() {
  const s = state();
  const head = s.head;
  if (s.run || !head) return;
  save({ run: { sha: head.sha, tree: head.tree, at: Date.now(), from: s.installed?.commit ?? null, changes: offerOf(s, { all: true })?.changes ?? null }, result: null });
  try {
    const r = await exec("sh", ["-c", LAUNCH, "tkhwang-update", appHome(), REPO, head.sha, head.tree, WORKER], { timeout: 15000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  } catch (e) {
    save({ run: null, result: { sha: head.sha, ok: false, at: Date.now(), tail: `Couldn't start the update: ${e?.message ?? e}` } });
  }
}

// Ends the running update once its log says it exited, or once it has run past RUN_LIMIT (stuck,
// or stopped by a restart of the machine): its outcome becomes `result`, which the pill shows
// until closed. True when nothing runs any more.
export async function settle() {
  const run = state().run;
  if (!run) return true;
  let text = null;
  try {
    text = await readTextFile(logPath());
  } catch {
    // Not there yet.
  }
  const r = runOf(text, run.sha);
  if (!r?.done && Date.now() - run.at < RUN_LIMIT) return false;
  // Another copy may have ended it meanwhile.
  if (state().run?.at !== run.at) return true;
  await readInstalled();
  save({
    run: null,
    result: { sha: run.sha, ok: Boolean(r?.ok), unfinished: !r?.done, at: Date.now(), from: run.from, changes: run.changes, newMods: r?.newMods ?? [], backup: r?.backup ?? null, tail: r?.tail ?? "" },
  });
  return true;
}

// What the pill's copy looks at every minute: the install record, then GitHub when due, or at
// once when the installed commit moved (an apply from a checkout).
export async function look() {
  const before = state().installed?.commit ?? null;
  const installed = await readInstalled();
  const moved = (installed?.commit ?? null) !== before;
  await check({ now: moved && Boolean(state().head) });
}

export function openWindow() {
  openOverlay({ mod: "tkhwang-update", kind: "dialog", width: 560, height: 480 });
}
