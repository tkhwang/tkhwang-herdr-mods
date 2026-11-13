// tkhwang-update: what the update pill and its window show, worked out from data alone (no herdr
// calls), so it can be checked with plain node.

// What the installed mods are checked against: this repository's main branch. A fork changes REPO.
export const REPO = "tkhwang/tkhwang-herdr-mods";
export const BRANCH = "main";
export const WEB = `https://github.com/${REPO}`;

// GitHub is asked at most this often (its public API takes 60 requests an hour without a token).
export const EVERY = 3 * 60 * 60 * 1000;
// The window lists at most this many lines; GitHub's compare page has them all.
export const MAX_LISTED = 40;
// Lines of an update's output kept to show when it fails.
export const TAIL_LINES = 40;

const SHA = /^[0-9a-f]{40}$/;
export const isSha = (value) => typeof value === "string" && SHA.test(value);
export const short = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : "");
const linesOf = (text) => String(text ?? "").split(/\r?\n/);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The branch's newest commit, from GitHub's GET /repos/{repo}/commits/{branch}:
// { sha, tree, date, subject }, or null for an answer without one.
export function headOf(json) {
  const sha = json?.sha;
  const tree = json?.commit?.tree?.sha;
  if (!isSha(sha) || !isSha(tree)) return null;
  return { sha, tree, date: String(json.commit?.committer?.date ?? ""), subject: linesOf(json.commit?.message)[0].trim() };
}

// What `./sync.sh apply` recorded in the app folder (tkhwang-herdr-mods.json): the commit and tree
// it installed, the checkout's branch, whether it had changes of its own, and when. null without one.
export function installedOf(text) {
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return {
    commit: isSha(json.commit) ? json.commit : null,
    tree: isSha(json.tree) ? json.tree : null,
    branch: typeof json.branch === "string" && json.branch ? json.branch : null,
    dirty: json.dirty === true,
    at: typeof json.applied_at === "string" ? json.applied_at : null,
  };
}

// One line of the window's list: a pull request's merge as { sha, pr, title }, another commit as
// { sha, subject }. A merge that isn't a pull request's (a branch merged by hand) is left out:
// the commits it brought are listed on their own.
function entryOf(commit) {
  const lines = linesOf(commit?.commit?.message);
  const sha = String(commit?.sha ?? "");
  const pr = /^Merge pull request #(\d+) from (\S+)/.exec(lines[0]);
  if (pr) return { sha, pr: Number(pr[1]), title: lines.slice(1).map((line) => line.trim()).find(Boolean) ?? pr[2] };
  if ((commit?.parents?.length ?? 0) > 1) return null;
  return { sha, subject: lines[0].trim() };
}

// What the branch has that the installed commit lacks, from GitHub's
// GET /repos/{repo}/compare/{base}...{head}: { base, head, ahead, commits, count, more }.
// - commits: the list's lines, newest first, so a pull request's merge comes before its commits.
// - ahead: commits the branch has over base; 0 when base has everything already (work applied
//   before it was merged sits on top of the branch).
// - count: those commits less the merges. more: lines past MAX_LISTED, and commits past the 250
//   GitHub lists.
export function changesOf(json, base, head) {
  const all = Array.isArray(json?.commits) ? json.commits : [];
  const total = Number.isInteger(json?.total_commits) ? json.total_commits : all.length;
  const unlisted = Math.max(0, total - all.length);
  const entries = all.map(entryOf).filter(Boolean).reverse();
  return {
    base,
    head,
    ahead: Number.isInteger(json?.ahead_by) ? json.ahead_by : all.length,
    commits: entries.slice(0, MAX_LISTED),
    count: all.filter((c) => (c?.parents?.length ?? 0) <= 1).length + unlisted,
    more: Math.max(0, entries.length - MAX_LISTED) + unlisted,
  };
}

// GitHub can't compare: it doesn't have the installed commit (applied from one never pushed).
export const unknownChanges = (base, head) => ({ base, head, ahead: null, commits: null, count: 0, more: 0 });

// The comparison saved for exactly the installed commit and the saved head (see changesOf), or
// null: none was made for this pair (GitHub didn't answer, or the installed commit moved since).
function comparisonOf(s) {
  const c = s?.changes;
  const base = s?.installed?.commit;
  return c && base && s.head && c.base === base && c.head === s.head.sha ? c : null;
}

// Whether what is installed has everything the saved head has: it is that commit, the same files
// under another commit (a branch applied before its pull request was merged), or the comparison
// shows the branch nothing ahead (work on top of it, not merged yet).
function current(s) {
  const { head, installed } = s ?? {};
  if (!head) return false;
  return installed?.commit === head.sha || (Boolean(installed?.tree) && installed.tree === head.tree) || comparisonOf(s)?.ahead === 0;
}

// The update to offer, { head, changes }, or null. Only one GitHub's comparison confirms: the
// branch has commits the installed one lacks. Without it (no install recorded, GitHub doesn't
// have the installed commit, or it didn't answer) the branch may be behind what is installed,
// and installing it would go back. Nothing either once the person stopped checking or (unless
// `all`) put this version off with Later.
export function offerOf(s, { all = false } = {}) {
  const { head, dismissed, off } = s ?? {};
  if (!head || (off && !all) || current(s)) return null;
  if (!all && dismissed === head.sha) return null;
  const known = comparisonOf(s);
  return known?.ahead > 0 ? { head, changes: known } : null;
}

// What the pill says, or null to hide it:
// { kind: "running" | "done" | "failed" | "offer", text, note? }.
export function pillOf(s) {
  if (s?.run) return { kind: "running", text: "Updating tkhwang-herdr-mods…" };
  const r = s?.result;
  if (r) {
    if (r.ok) {
      const note = r.newMods?.length ? "restart Herdr for the new mods" : null;
      return { kind: "done", text: `Updated tkhwang-herdr-mods to ${short(r.sha)}`, note };
    }
    return { kind: "failed", text: r.unfinished ? "tkhwang-herdr-mods update didn't finish" : "tkhwang-herdr-mods update failed" };
  }
  const offer = offerOf(s);
  if (!offer) return null;
  const note = offer.changes?.count > 0 ? `${plural(offer.changes.count, "new commit")}` : short(offer.head.sha);
  return { kind: "offer", text: "Update for tkhwang-herdr-mods", note };
}

// A run's log, as LAUNCH and the downloader write it: "# update <sha> <at>" first (the run's
// commit and start, which tell runs apart), "# pid <n>" (the downloader's process), "# new mods: …"
// when apply made mod folders that weren't there, "# exit <code>" last. null when the log is
// another run's (or none); { done: false, pid } while it runs. backup is the folder apply moved
// replaced files to, tail the last lines it printed.
export function runOf(text, run) {
  if (typeof text !== "string" || !isSha(run?.sha) || !Number.isInteger(run?.at)) return null;
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines[0] !== `# update ${run.sha} ${run.at}`) return null;
  const last = (pattern) => lines.map((line) => pattern.exec(line)).filter(Boolean).pop() ?? null;
  const exit = last(/^# exit (\d+)$/);
  const pid = last(/^# pid (\d+)$/);
  const fresh = last(/^# new mods: (.*)$/);
  const backup = lines.map((line) => / -> (.+?\.bak-[^/]+)\//.exec(line)).find(Boolean);
  return {
    done: Boolean(exit),
    ok: exit?.[1] === "0",
    pid: pid ? Number(pid[1]) : null,
    newMods: fresh ? fresh[1].trim().split(/\s+/).filter(Boolean) : [],
    backup: backup ? backup[1] : null,
    tail: lines.filter((line) => !line.startsWith("# ")).slice(-TAIL_LINES).join("\n"),
  };
}

// `~/…` for a path under the home folder.
export function tildePath(path, home) {
  const h = String(home ?? "").replace(/[\\/]+$/, "");
  return h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
}

export const dayOf = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "");

export function ago(ms, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

// "0b3513b (feat/update, with local changes)": what is installed, for people.
export function installedText(installed) {
  if (!installed?.commit) return "a copy without a recorded commit";
  const notes = [installed.branch, installed.dirty ? "with local changes" : null].filter(Boolean);
  return notes.length ? `${short(installed.commit)} (${notes.join(", ")})` : short(installed.commit);
}

// The list a window shows and where GitHub shows all of it.
function listOf(changes, from, to) {
  return {
    commits: changes?.commits ?? null,
    more: changes?.more ?? 0,
    url: from && to ? `${WEB}/compare/${from}...${to}` : `${WEB}/commits/${BRANCH}`,
  };
}

// What the window shows: { kind, title, lines, commits?, more?, url?, tail? }, kind being
// "running", "done", "failed", "offer" (an update, also one put off with Later) or "status".
export function windowOf(s, { home = "", now = Date.now() } = {}) {
  if (s?.run) {
    return { kind: "running", title: "Updating tkhwang-herdr-mods", lines: [`Downloading ${short(s.run.sha)} from GitHub and installing it with its ./sync.sh apply.`] };
  }
  const r = s?.result;
  if (r?.ok) {
    const lines = [r.from ? `From ${short(r.from)} to ${short(r.sha)}.` : `Now on ${short(r.sha)}.`];
    if (r.backup) lines.push(`Files it replaced are in ${tildePath(r.backup, home)}.`);
    if (r.newMods?.length) lines.push(`Restart Herdr to load the new ${r.newMods.length === 1 ? "mod" : "mods"}: ${r.newMods.join(", ")}.`);
    return { kind: "done", title: `Updated tkhwang-herdr-mods to ${short(r.sha)}`, lines, ...listOf(r.changes, r.from, r.sha) };
  }
  if (r) {
    const lines = [r.unfinished ? "Its process ended without saying how (killed, or the machine restarted). What it printed:" : "What it printed:"];
    return { kind: "failed", title: r.unfinished ? "The update didn't finish" : "The update failed", lines, tail: r.tail || "(nothing)" };
  }
  const head = s?.head;
  const offer = offerOf(s, { all: true });
  if (offer) {
    const lines = [`You have ${installedText(s.installed)}; ${BRANCH} is at ${short(head.sha)}, from ${dayOf(head.date)}.`];
    if (s.dismissed === head.sha) lines.push("Put off with Later: the pill shows again for a newer one.");
    return { kind: "offer", title: "Update for tkhwang-herdr-mods", lines, ...listOf(offer.changes, s.installed?.commit, head.sha) };
  }
  const lines = [s?.installed ? `Installed: ${installedText(s.installed)}, applied ${dayOf(s.installed.at)}.` : "No install recorded: ./sync.sh apply records one."];
  if (head) lines.push(`${BRANCH} is at ${short(head.sha)}, from ${dayOf(head.date)}.`);
  if (comparisonOf(s)?.ahead === null) lines.push("GitHub doesn't have the installed commit (applied from one never pushed), so it can't tell which is newer.");
  if (s?.off) lines.push("Checking is off; Check now turns it back on.");
  else if (s?.checked) lines.push(`Checked ${ago(s.checked, now)}; GitHub is asked every ${EVERY / 3600000} hours.`);
  if (s?.error) lines.push(`The last check failed: ${s.error}.`);
  // Not an offer and not current: nothing tells whether the branch is ahead (see offerOf).
  const title = !head ? "tkhwang-herdr-mods hasn't been checked yet" : current(s) ? "tkhwang-herdr-mods is up to date" : `tkhwang-herdr-mods can't be compared with ${BRANCH}`;
  return { kind: "status", title, lines };
}
