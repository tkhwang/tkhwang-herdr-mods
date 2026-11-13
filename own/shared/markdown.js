// markdown tab: a file opens in a tkhwang-markdown pane in a tab of its own (the file tab), with
// View | Diff | Edit in its header, one per space and reused in place like the Changes diff tab.
// Files (file-icons) opens any file there on a click, on View (file tab); Changes (better-changes) a
// Markdown file, on Diff; the fallback tab bar (tabs-dev) a Markdown file from its Markdown icon.
// files-dev, file-icons and better-changes also ask which tab it is, so they keep showing the folder
// it was opened from while it is the shown tab. The same file lives in all these mod folders: keep
// the copies the same.
import { spaces, panes, run, shared, setShared } from "herdr";

export const MARKDOWN = /\.(md|mdx|markdown)$/i;

const MOD = "tkhwang-markdown";
// { space id: { tab, slot, cwd, on, pending } }: the space's file tab, the slot its pane shows, and
// the folder it was opened from (the panels keep showing that folder while the tab is the shown
// one; panel-folder.js reads it too). `pending`: when tab.new was sent and the pane hasn't appeared
// yet.
const TABS = "markdown-tab.tabs";
// What each slot shows: { slot: { file, on, mode, at, icon } }. `mode`: "view", "diff" or "edit"
// (null keeps the tab's); `at`: when it was asked, so the same file asked again still reaches the
// pane; `icon`: the file's Material icon as { dark, light } paths (file-icons' lookup, which a mod
// can't import from another), for the tab's header.
const SHOW = "tkhwang-markdown.show";
const OPEN_TIMEOUT_MS = 3000;

const entries = () => shared(TABS) ?? {};
const tabIds = (space) => new Set((spaces().find((s) => s.id === space)?.tabs ?? []).map((t) => t.id));

// This space's live file tab, or null when it was closed (or never opened).
export function markdownTab(space) {
  const entry = space ? entries()[space] : null;
  if (!entry?.tab) return null;
  const live = tabIds(space).has(entry.tab) && panes().some((p) => p.tab === entry.tab && p.mod === MOD);
  return live ? entry : null;
}

// The file this space's file tab shows now, or null.
export function markdownShown(space) {
  const live = markdownTab(space);
  return live ? (shared(SHOW) ?? {})[live.slot]?.file ?? null : null;
}

// The slots still in use, plus `slot` with `show`: slots of closed tabs are dropped.
function shows(slot, show) {
  const used = new Set(Object.values(entries()).map((e) => e?.slot).filter(Boolean));
  const kept = Object.entries(shared(SHOW) ?? {}).filter(([s]) => used.has(s));
  return { ...Object.fromEntries(kept), [slot]: show };
}

// Shows `file` (absolute, on machine `on`) in the active space's file tab, on `mode`, opening one
// when there is none. `cwd`: the folder the panels were showing, kept for them while the tab is
// shown; `icon`: { dark, light }, the file's icon for the tab's header.
export function showMarkdown({ file, on = null, cwd = null, mode = null, icon = null }, cx) {
  const space = spaces().find((s) => s.active);
  if (!space) return;
  const name = file.split(/[\\/]/).pop();
  const show = { file, on, mode, at: Date.now(), icon };
  const old = entries()[space.id];
  const live = markdownTab(space.id);
  if (live) {
    setShared(TABS, { ...entries(), [space.id]: { ...live, cwd: cwd ?? live.cwd, on } });
    setShared(SHOW, shows(live.slot, show));
    run("tab.rename", { id: live.tab, name });
    run("tab.select", { id: live.tab });
    return;
  }
  // A click while the last tab.new is still landing would open a second tab.
  if (old?.pending && Date.now() - old.pending < OPEN_TIMEOUT_MS) return;
  const slot = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const before = new Set(panes().map((p) => p.pane));
  setShared(TABS, { ...entries(), [space.id]: { slot, cwd, on, pending: Date.now() } });
  setShared(SHOW, shows(slot, show));
  run("tab.new", { space: space.id, name, mod: MOD, props: { slot, file, on, mode } });
  // run() doesn't wait: look for the new pane, then record its tab.
  cx.spawn(async (cx) => {
    let pane = null;
    for (let i = 0; i < 40 && !pane; i++) {
      await cx.sleep(25);
      const ids = tabIds(space.id);
      pane = panes().find((p) => !before.has(p.pane) && p.mod === MOD && ids.has(p.tab)) ?? null;
    }
    const current = entries()[space.id];
    if (current?.slot !== slot) return;
    if (!pane) return void setShared(TABS, { ...entries(), [space.id]: { ...current, pending: null } });
    setShared(TABS, { ...entries(), [space.id]: { tab: pane.tab, slot, cwd, on, pending: null } });
    cx.notify();
  });
}
