// markdown tab: a Markdown file opens as a markdown-browser pane in a tab of its own, one per
// space and reused in place like the Changes diff tab. The tab bar (tabs-dev) opens it; files-dev
// and better-changes only ask which tab it is. The same file lives in all three mod folders:
// keep the copies the same.
import { spaces, panes, run, shared, setShared } from "herdr";

export const MARKDOWN = /\.(md|mdx|markdown)$/i;

// { space id: { tab, slot, cwd, on, pending } }: the space's viewer tab, the markdown-browser
// slot its pane shows, and the folder it was opened from (the panels keep showing that folder
// while the viewer tab is the shown one). `pending`: when tab.new was sent and the pane hasn't
// appeared yet.
const TABS = "markdown-tab.tabs";
// markdown-browser's own shared state: what each slot shows, and which pane holds which slot
// (the latter lets its preview tell it's focused, for its cmd-shift-o key).
const SHOW = "markdown-browser.show";
const SLOTS = "markdown-browser.slots";
const OPEN_TIMEOUT_MS = 3000;

const entries = () => shared(TABS) ?? {};
const tabIds = (space) => new Set((spaces().find((s) => s.id === space)?.tabs ?? []).map((t) => t.id));

// This space's live viewer tab, or null when it was closed (or never opened).
export function markdownTab(space) {
  const entry = space ? entries()[space] : null;
  if (!entry?.tab) return null;
  const live = tabIds(space).has(entry.tab) && panes().some((p) => p.tab === entry.tab && p.mod === "markdown-browser");
  return live ? entry : null;
}

// The file this space's viewer tab shows now, or null.
export function markdownShown(space) {
  const live = markdownTab(space);
  return live ? (shared(SHOW) ?? {})[live.slot]?.file ?? null : null;
}

// Shows `file` (absolute, on machine `on`) in the active space's viewer tab, opening one when
// there is none. `cwd`: the folder the panels were showing, kept for them while the tab is shown.
export function showMarkdown({ file, on = null, cwd = null }, cx) {
  const space = spaces().find((s) => s.active);
  if (!space) return;
  const name = file.split(/[\\/]/).pop();
  const old = entries()[space.id];
  const live = markdownTab(space.id);
  if (live) {
    setShared(SHOW, { ...(shared(SHOW) ?? {}), [live.slot]: { file, on } });
    setShared(TABS, { ...entries(), [space.id]: { ...live, cwd: cwd ?? live.cwd, on } });
    run("tab.rename", { id: live.tab, name });
    run("tab.select", { id: live.tab });
    return;
  }
  // A click while the last tab.new is still landing would open a second tab.
  if (old?.pending && Date.now() - old.pending < OPEN_TIMEOUT_MS) return;
  const slot = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const before = new Set(panes().map((p) => p.pane));
  setShared(SHOW, { ...(shared(SHOW) ?? {}), [slot]: { file, on } });
  setShared(TABS, { ...entries(), [space.id]: { slot, cwd, on, pending: Date.now() } });
  run("tab.new", { space: space.id, name, mod: "markdown-browser", props: { file, on, slot } });
  // run() doesn't wait: look for the new pane, then record its tab and slot.
  cx.spawn(async (cx) => {
    let pane = null;
    for (let i = 0; i < 40 && !pane; i++) {
      await cx.sleep(25);
      const ids = tabIds(space.id);
      pane = panes().find((p) => !before.has(p.pane) && p.mod === "markdown-browser" && ids.has(p.tab)) ?? null;
    }
    const current = entries()[space.id];
    if (current?.slot !== slot) return;
    if (!pane) return void setShared(TABS, { ...entries(), [space.id]: { ...current, pending: null } });
    setShared(TABS, { ...entries(), [space.id]: { tab: pane.tab, slot, cwd, on, pending: null } });
    const alive = new Set(panes().map((p) => p.pane));
    const slots = Object.fromEntries(Object.entries(shared(SLOTS) ?? {}).filter(([p]) => alive.has(p)));
    setShared(SLOTS, { ...slots, [pane.pane]: slot });
    cx.notify();
  });
}
