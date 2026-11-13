// tkhwang-update: the state the pill and its window share, and what changes it: asking GitHub,
// reading what `./sync.sh apply` recorded, and running an update.
import { shared, setShared, appHome, readTextFile, exec, openOverlay } from "herdr";
import { REPO, BRANCH, EVERY, headOf, installedOf, changesOf, unknownChanges, offerOf, runOf } from "./model.js";

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
// - run: the update running, { sha, tree, at, from, changes }, until its process is gone (`at`, its
//   start, names it in its log and its process's command line); result: how the last one ended,
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
    let error = null;
    if (!base || base === head.sha) changes = null;
    else if (changes?.base !== base || changes?.head !== head.sha) {
      const compared = await getJSON(`compare/${base}...${head.sha}`);
      // 404: GitHub doesn't have the installed commit, so that pair can never be compared. Any
      // other failure is asked again on the next check. Neither is offered (see offerOf).
      if (compared.json) changes = changesOf(compared.json, base, head.sha);
      else if (compared.status === 404) changes = unknownChanges(base, head.sha);
      else {
        changes = null;
        error = `GitHub answered ${compared.status} to the comparison`;
      }
    }
    save({ head, changes, error });
  } catch (e) {
    save({ error: String(e?.message ?? e) });
  }
}

// The downloader, run detached by LAUNCH, so it finishes whatever happens to the copy that started
// it (a window closed, this mod reloaded by the update itself, Herdr restarting). It downloads the
// commit from GitHub, runs that copy's ./sync.sh apply against this app folder, and says in the
// log which mod folders apply made (Herdr loads a new one at its next start) and how it ended.
// The download has a time limit: the run lasts as long as this process (see settle).
// Arguments: the app folder, the repository, the commit, its tree, and the run's start (unused
// here, but in the process's command line, where settle() looks for it).
const WORKER = String.raw`home="$1" repo="$2" sha="$3" tree="$4"
[ -n "$TMPDIR" ] || TMPDIR=/tmp
(
  set -eu
  tmp="$(mktemp -d "$TMPDIR/tkhwang-herdr-mods.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  { ls "$home/mods" 2>/dev/null || :; } | LC_ALL=C sort >"$tmp/before"
  echo "[*] downloading $repo@$(printf %.7s "$sha")"
  curl -fsSL --connect-timeout 30 --max-time 300 -H "User-Agent: tkhwang-herdr-mods" -o "$tmp/src.tar.gz" "https://codeload.github.com/$repo/tar.gz/$sha"
  mkdir "$tmp/src"
  tar -xzf "$tmp/src.tar.gz" -C "$tmp/src" --strip-components 1
  HERDR_APP_HOME="$home" TKHWANG_HERDR_MODS_COMMIT="$sha" TKHWANG_HERDR_MODS_TREE="$tree" bash "$tmp/src/sync.sh" apply
  ls "$home/mods" | LC_ALL=C sort >"$tmp/after"
  fresh="$(LC_ALL=C comm -13 "$tmp/before" "$tmp/after" | tr '\n' ' ')"
  if [ -n "$fresh" ]; then echo "# new mods: $fresh"; fi
)
echo "# exit $?"`;

// Starts the run's log and the worker in the background, its output in the log and nothing left
// on the pipes exec reads, so exec returns at once, then names the worker's process in the log.
// The log is a new file, not the last one emptied: a process that still has the last one open
// writes there, never into this run's. Arguments: those of WORKER, then WORKER itself.
const LAUNCH = String.raw`log="$1/tkhwang-herdr-mods.log"
rm -f "$log" && printf '# update %s %s\n' "$3" "$5" >"$log" || exit 1
nohup sh -c "$6" tkhwang-update "$1" "$2" "$3" "$4" "$5" </dev/null >>"$log" 2>&1 &
printf '# pid %s\n' "$!" >>"$log"`;

// Starts installing the update offerOf offers, also one put off with Later or with checking
// stopped (the person asked for it), and nothing else: not a commit already installed, nor one
// GitHub's comparison hasn't shown to be ahead. settle() ends the run from its log.
export async function startUpdate() {
  const s = state();
  const offer = offerOf(s, { all: true });
  if (s.run || !offer) return;
  const { head } = offer;
  const run = { sha: head.sha, tree: head.tree, at: Date.now(), from: s.installed?.commit ?? null, changes: offer.changes };
  save({ run, result: null });
  try {
    const r = await exec("sh", ["-c", LAUNCH, "tkhwang-update", appHome(), REPO, head.sha, head.tree, String(run.at), WORKER], { timeout: 15000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  } catch (e) {
    save({ run: null, result: { sha: head.sha, ok: false, at: Date.now(), tail: `Couldn't start the update: ${e?.message ?? e}` } });
  }
}

// A run whose log doesn't name its process this long after it started never got going.
const START_LIMIT = 60 * 1000;

// Whether the run's worker still runs: the process its log names, if that is still this run's
// worker (a process that ended leaves its pid free for another). Until the log names one, a run
// that just started counts as running.
async function running(pid, run) {
  if (!pid) return Date.now() - run.at < START_LIMIT;
  try {
    const r = await exec("ps", ["-ww", "-o", "command=", "-p", String(pid)], { timeout: 5000 });
    return r.code === 0 && r.stdout.includes(" tkhwang-update ") && r.stdout.includes(` ${run.at}`);
  } catch {
    // ps didn't answer: asked again on the next look.
    return true;
  }
}

// The update's log, or null while it can't be read (not there yet).
async function readLog() {
  try {
    return await readTextFile(logPath());
  } catch {
    return null;
  }
}

// Ends the running update once its log says how it exited, or once its process is gone without
// saying (killed, or the machine restarted): the outcome becomes `result`, which the pill shows
// until closed. While the process runs, however long apply takes, the run stays, so Retry can't
// start a second one beside it. True when nothing runs any more.
export async function settle() {
  const run = state().run;
  if (!run) return true;
  let r = runOf(await readLog(), run);
  if (!r?.done) {
    if (await running(r?.pid, run)) return false;
    // The worker writes how it ended before it exits, which may have happened since the log was
    // read: read it again now that the process is gone.
    r = runOf(await readLog(), run) ?? r;
  }
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
