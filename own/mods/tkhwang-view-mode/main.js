// tkhwang-view-mode: what the [1] | [1|2] | [1|2/3] window switch does to the shown tab's windows.
// Moved out of tabs-dev (its `view mode` lines). It draws nothing and sits in an empty 0px block of
// the layout: the tab bar draws the switch (better-tabs' `view mode` lines, between + and Files)
// and sends the mode chosen as `tkhwang-view-mode.1`, `2` or `3`; it lights the mode kept in the
// shared "tkhwang-view-mode.view".
//
// 1 ("mobile") shows a tab's main window, its first pane, alone and zoomed, so the secondary
// windows fold away (they keep running) and the side panel keeps its room. 2 ("desktop") shows
// main and one secondary window side by side, and a click on 2 in a tab with only its main window
// splits it to make the secondary one. 3 ("triple") shows main and two secondary windows stacked
// on its right, and a click on 3 makes the ones a tab lacks (main split down the middle, then the
// right half split across). 2 puts a tab's third window away, its terminal still running without
// a pane (terminal.park), and 3 puts it back under the second (terminal.keep), so 3 -> 2 -> 3
// keeps the same shell. 1 folds a tab with an agent, or a tab of main and one or two secondary
// windows (what 2 and 3 make); others (herdr-dev.sh's four-pane dev tab) keep all their panes.
// The mode is shared, so it survives restarts; the panes 1 zoomed are remembered so 2 and 3
// unzoom exactly those on their own (a click on 2 or 3 unzooms any).
import { View, div } from "gpui-kit";
import { spaces, panes, terminals, machines, run, shared, setShared, nextCommand } from "herdr";

const VIEW = "tkhwang-view-mode.view";
const VIEW_ZOOMED = "tkhwang-view-mode.zoomed";
// tab id → the terminals of the third windows 2 put away from it, oldest first.
const VIEW_PARKED = "tkhwang-view-mode.parked";
// tabs-dev kept the same state under these keys: taken over once, so its mode and zooms carry on.
const FROM_TABS_DEV = [[VIEW, "tabs-dev.view"], [VIEW_ZOOMED, "tabs-dev.view-zoomed"], [VIEW_PARKED, "tabs-dev.view-parked"]];
// How many windows a click on each mode gives a tab.
const VIEW_WINDOWS = { mobile: 1, desktop: 2, triple: 3 };
// The switch's buttons send these (`run("tkhwang-view-mode.1")`), and so can `herdr-app do` or a key.
const COMMANDS = { 1: "mobile", 2: "desktop", 3: "triple", mobile: "mobile", desktop: "desktop", triple: "triple" };
// How long a window asked for, or one being put away, is waited on.
const WAIT_MS = 10000;

const viewMode = () => { const mode = shared(VIEW); return mode === "mobile" || mode === "triple" ? mode : "desktop"; };
const shownTab = () => spaces().find(s => s.active)?.tabs?.find(c => c.active)?.id ?? null;
const panesOf = (tab) => tab ? panes().filter(p => p.tab === tab) : [];
// A tab's windows (terminal panes) in pane order, the first being its main window.
const windowsOf = (inTab) => inTab.filter(p => p.terminal);
const isAgent = (p) => Boolean(p.program?.agent || p.status);
const agentOf = (inTab) => inTab.find(isAgent) ?? null;
// Whether 1 folds the tab to its main window.
const folds = (inTab) => { const n = windowsOf(inTab).length; return n === 2 || n === 3 || (n > 3 && Boolean(agentOf(inTab))); };
// The window 2 puts away: the third of a tab of three, unless an agent runs there (put away, its
// status would leave the tab and the agent lists).
const thirdOf = (windows) => windows.length === 3 && !isAgent(windows[2]) ? windows[2] : null;
const parkedOf = (tab) => (shared(VIEW_PARKED) ?? {})[tab] ?? [];
// What a look at the shown tab depends on: an agent starting or ending there changes it.
const viewKey = (tab, mode, inTab) => `${mode}\0${tab}\0${agentOf(inTab)?.pane ?? ""}`;
const liveTerminals = () => new Set(terminals().filter(t => t.state === "live").map(t => t.address));

export default class ViewMode extends View {
  init(_props, cx) {
    for (const [key, old] of FROM_TABS_DEV) if (shared(key) == null && shared(old) != null) setShared(key, shared(old));
    // tab id → a window 2 or 3 asked for: when, how many windows the tab had, whether a click
    // asked (the next window it wants follows), and the pane to give the focus back to: any pane
    // of the tab, a mod pane such as a Markdown preview too.
    this.opening = new Map();
    // terminal → the tab 2 is putting it away from, and when it asked, until its pane is gone
    // (tidyParked lets go then), or for WAIT_MS should it never go.
    this.parking = new Map();
    cx.spawn(async (cx) => {
      for (;;) {
        const mode = COMMANDS[await nextCommand()];
        if (mode) { this.chooseView(mode); cx.notify(); }
      }
    });
  }

  // Looks at the shown tab again when the mode, the tab, or the agent in it changes (one started
  // in a shell there, or one that ended), never on a zoom the person did by hand. Only a change of
  // tab or mode puts a third window away or back, and a third window gone from the shown tab looks
  // again, so 2 then 3 at once ends in 3.
  syncView() {
    const tab = shownTab(), inTab = panesOf(tab);
    const parked = this.tidyParked();
    // A tab whose window 2 or 3 asked for has it now, or is gone: the next click there may ask
    // again. A click's windows come one at a time: one coming to the shown tab brings the next,
    // and one coming after a click on 2 is put away again.
    for (const [id, asked] of [...this.opening]) {
      const windows = windowsOf(panesOf(id));
      if (windows.length === asked.had) continue;
      this.opening.delete(id);
      if (id !== tab || windows.length < asked.had) continue;
      this.shapeView(id, windows, viewMode(), asked.click);
      if (!asked.click && asked.focus && panesOf(id).some(p => p.pane === asked.focus)) run("pane.focus", { pane: asked.focus });
    }
    if (!inTab.length) return; // panes not in yet (a fresh start): look again on the next render
    const mode = viewMode(), key = viewKey(tab, mode, inTab), at = `${mode}\0${tab}`, moved = at !== this.viewAt;
    if (key !== this.viewKey) {
      this.viewKey = key; this.viewAt = at;
      this.applyView(inTab, mode, false);
    }
    if (moved || parked.has(tab)) this.shapeView(tab, windowsOf(inTab), mode, false);
  }

  // A click on the switch (its command) puts the shown tab in that mode even when the mode is on already (a tab
  // split since it was folded folds then), over a zoom done by hand too: 2 and 3 show their
  // windows, 1 the main window. A click on 2 or 3 also gives the tab the windows it lacks.
  chooseView(mode) {
    if (viewMode() !== mode) setShared(VIEW, mode);
    const tab = shownTab(), inTab = panesOf(tab);
    if (!inTab.length) return;
    this.applyView(inTab, mode, true);
    this.shapeView(tab, windowsOf(inTab), mode, true);
    // The render this causes finds nothing to do.
    this.viewKey = viewKey(tab, mode, inTab); this.viewAt = `${mode}\0${tab}`;
  }

  // 2 puts the third window of the tab whose windows are `windows` away, still running; 2 and 3
  // give it the next window they want (see openWindow).
  shapeView(tab, windows, mode, click) {
    const third = mode === "desktop" ? thirdOf(windows) : null, now = Date.now();
    if (third && !(now - (this.parking.get(third.terminal)?.at ?? 0) < WAIT_MS)) {
      this.parking.set(third.terminal, { tab, at: now });
      const parked = parkedOf(tab);
      if (!parked.includes(third.terminal)) setShared(VIEW_PARKED, { ...(shared(VIEW_PARKED) ?? {}), [tab]: [...parked, third.terminal] });
      run("terminal.park", { terminal: third.terminal });
    }
    this.openWindow(tab, windows, mode, click);
  }

  // Gives the tab whose windows are `windows` the next one `mode` wants. Under the second window,
  // that is the third 2 put away from it, if it still runs; otherwise, only on a click, a new shell
  // in main's folder: main alone split down the middle (2 and 3), the second window, right of
  // main, split across for 3's third. A second click while a window is still on its way doesn't
  // ask for another, in each tab on its own. On another machine it can take a while, so this holds
  // until the window comes (syncView lets go then), or for WAIT_MS should it never come. A window
  // put back on a tab switch leaves the focus where it was.
  openWindow(tab, windows, mode, click) {
    const n = windows.length, asked = this.opening.get(tab), now = Date.now();
    if (!n || n >= VIEW_WINDOWS[mode] || (asked && now - asked.at < WAIT_MS)) return;
    const shown = new Set(panes().map(p => p.terminal)), live = liveTerminals();
    const back = n === 2 ? [...parkedOf(tab)].reverse().find(t => !shown.has(t) && live.has(t)) : null;
    if (!back && !click) return;
    this.opening.set(tab, { at: now, had: n, click, focus: panesOf(tab).find(p => p.focused)?.pane ?? null });
    run("pane.focus", { pane: windows[n === 1 ? 0 : 1].pane });
    if (back) { run("terminal.keep", { terminal: back, place: "down" }); return; }
    const place = n === 1 ? "right" : "down", folder = windows[0].cwd;
    run("terminal.open", folder ? { place, folder } : { place });
  }

  // Lets go of the terminals put away by now, forgets put-away ones that are in a pane again or
  // have ended, and ends those of a closed tab (closing it would have ended them with the rest).
  // Gone ones count only once every machine's tabs are in; one on its way away still has its pane
  // for a moment. Gives the tabs a third window just left.
  tidyParked() {
    const left = new Set();
    if (!this.parking.size && !Object.keys(shared(VIEW_PARKED) ?? {}).length) return left;
    const ready = machines().every(m => m.layout === "ready"), now = Date.now();
    const shown = new Set(panes().map(p => p.terminal)), live = liveTerminals();
    for (const [t, { tab, at }] of [...this.parking]) {
      if (!shown.has(t)) left.add(tab);
      if (!shown.has(t) || now - at >= WAIT_MS) this.parking.delete(t);
    }
    const all = shared(VIEW_PARKED) ?? {}, tabs = new Set(spaces().flatMap(s => s.tabs.map(c => c.id))), next = {};
    for (const [tab, list] of Object.entries(all)) {
      if (ready && !tabs.has(tab)) {
        for (const t of list) if (!shown.has(t) && live.has(t)) run("terminal.kill", { terminal: t });
        continue;
      }
      const kept = list.filter(t => this.parking.has(t) || (!shown.has(t) && (!ready || live.has(t))));
      if (kept.length) next[tab] = kept;
    }
    if (JSON.stringify(next) !== JSON.stringify(all)) setShared(VIEW_PARKED, next);
    return left;
  }

  // Puts the tab whose panes are `inTab` in `mode`. Without `force` (a tab, mode or agent change)
  // only a zoom this mode made comes undone.
  applyView(inTab, mode, force) {
    const zoomed = inTab.find(p => p.zoomed), main = windowsOf(inTab)[0];
    // The panes this mode zoomed; gone ones drop out once every machine's panes are in.
    const ready = machines().every(m => m.layout === "ready"), alive = new Set(panes().map(p => p.pane));
    const ours = (shared(VIEW_ZOOMED) ?? []).filter(p => !ready || alive.has(p));
    if (mode === "mobile" && folds(inTab)) {
      if (zoomed?.pane === main.pane) return;
      if (zoomed && !force) return; // another pane zoomed by hand stays
      if (zoomed) run("pane.zoom", { pane: zoomed.pane });
      run("pane.zoom", { pane: main.pane });
      run("pane.focus", { pane: main.pane });
      setShared(VIEW_ZOOMED, [...ours.filter(p => p !== main.pane && p !== zoomed?.pane), main.pane]);
      return;
    }
    // 2 or 3, or a tab 1 leaves whole (herdr-dev.sh's grid of test watchers and servers): a zoom
    // this mode made comes undone, and a click on 2 or 3 undoes one done by hand too.
    if (!zoomed || !(ours.includes(zoomed.pane) || (force && mode !== "mobile"))) return;
    run("pane.zoom", { pane: zoomed.pane });
    setShared(VIEW_ZOOMED, ours.filter(p => p !== zoomed.pane));
  }

  render(cx) {
    // Commands and shared state must not change during a render: every render (live data or shared
    // state changed) looks at the shown tab right after it instead.
    if (!this.syncQueued) {
      this.syncQueued = true;
      cx.timer.after(0, () => { this.syncQueued = false; this.syncView(); });
    }
    return div();
  }
}
