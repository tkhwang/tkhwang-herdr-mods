// panel folder: the one folder the side panels (Files, Changes, Git) show, so the three never
// part ways and none of them jumps with the focus. In a tab it is the main pane's folder: the
// tab's first pane, window 1 of the tab bar's 1 | 2 switch, whichever pane runs the agent.
// The folder bar under each panel's header picks another of the tab's panes, or any folder on
// this machine, for that tab; a pick holds until another one is made, and a picked pane that
// closes hands back to the main pane. A tab with no terminal (the Changes diff tab, the file
// tab) keeps the folder it was opened from. The same file lives in files-dev,
// better-changes and git-graph: keep the copies the same.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, machines, shared, setShared, pickFolder, home } from "herdr";

// { tab id: { pane } | { cwd } }: the pane, or the folder on this machine, picked for a tab.
// A tab without an entry shows its main pane's folder.
export const PICKS = "panel-folder.picks";

// Drops a folder's trailing separators, but not a root's: "/" stays, and so does a drive root
// such as "C:\" (bare "C:" is that drive's current folder, not its root).
const trim = (cwd) => (/^[A-Za-z]:[\\/]+$/.test(cwd) ? cwd : cwd.replace(/(.)[\\/]+$/, "$1"));
const nameOf = (cwd, on) => (!on && cwd === home() ? "~" : trim(cwd).split(/[\\/]/).pop() || cwd);
const tilde = (cwd, on) => (!on && cwd.startsWith(home() + "/") ? "~" + cwd.slice(home().length) : cwd);
const stop = (_e, cx) => cx.stop_propagation();

// The shown space and tab, and the tab's terminal panes in pane order (a mod pane, such as a
// diff or the file tab, has no folder).
function shown() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs?.find((t) => t.active) ?? null;
  const terms = tab ? panes().filter((p) => p.tab === tab.id && p.terminal && p.cwd) : [];
  return { space, tab, terms };
}

// A tab's main pane: its first pane (window 1 of the tab bar's 1 | 2 switch).
export const mainPane = (terms) => terms[0] ?? null;

// Where a tab with no terminal was opened from: the file tab's folder (markdown.js), or the
// repository of the Changes diff tab (better-changes).
function viewerFolder(space, tab) {
  const md = (shared("markdown-tab.tabs") ?? {})[space.id];
  if (md?.tab === tab.id && md.cwd) return { cwd: md.cwd, on: md.on ?? null };
  if (!panes().some((p) => p.tab === tab.id && p.mod === "better-changes")) return null;
  const source = (shared("better-changes.diff-tabs") ?? {})[space.id]?.source;
  return source?.cwd ? { cwd: source.cwd, on: source.on ?? null } : null;
}

// What the panels show now: { cwd, on, tab, pane, viewer }. `pane` is the pane whose folder it
// is (null for a picked folder or a viewer tab); `viewer` marks a tab with no terminal. Null when
// no space is shown, or for a tab with neither a terminal nor a record of where it came from.
export function panelFolder() {
  const { space, tab, terms } = shown();
  if (!space || !tab) return null;
  if (!terms.length) {
    const from = viewerFolder(space, tab);
    return from ? { ...from, tab: tab.id, pane: null, viewer: true } : null;
  }
  const on = space.machine ?? null;
  const pick = (shared(PICKS) ?? {})[tab.id];
  // A picked folder comes from the system's folder picker, which only sees this machine.
  if (pick?.cwd && !on) return { cwd: pick.cwd, on: null, tab: tab.id, pane: null, viewer: false };
  const pane = (pick?.pane && terms.find((p) => p.pane === pick.pane)) || mainPane(terms);
  return { cwd: pane.cwd, on, tab: tab.id, pane: pane.pane, viewer: false };
}

// Sets a tab's pick (null: back to its main pane) and drops the picks of tabs that are gone,
// only once every machine's tabs are in, so a machine still loading keeps its picks.
export function setPick(tab, pick) {
  const picks = { ...(shared(PICKS) ?? {}) };
  if (machines().every((m) => m.layout === "ready")) {
    const live = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
    for (const id of Object.keys(picks)) if (!live.has(id)) delete picks[id];
  }
  if (pick) picks[tab] = pick;
  else delete picks[tab];
  setShared(PICKS, picks);
}

// The folder bar under a panel's header, or null in a tab with no terminal. One chip per folder
// the tab's panes are in, numbered by the first pane there (pane order) and showing that pane's
// branch; a chip for a picked folder none of them is in; and, in a space on this machine,
// "Folder…" to pick any folder. The lit chip is what all three panels show, and a click on
// another lights it in all of them. `id` keeps each panel's elements apart.
// The bar's height, for a panel that budgets the room under it.
export const FOLDER_BAR_H = 34;
export function folderBar(t, id) {
  const { space, tab, terms } = shown();
  const now = panelFolder();
  if (!space || !tab || !terms.length || !now) return null;
  const on = space.machine ?? null;
  const main = mainPane(terms);
  const chips = [];
  terms.forEach((p, i) => {
    if (!chips.some((c) => c.cwd === p.cwd)) chips.push({ cwd: p.cwd, n: i + 1, pane: p.pane, branch: p.branch ?? null });
  });
  if (!chips.some((c) => c.cwd === now.cwd)) chips.push({ cwd: now.cwd, n: null, pane: null, branch: null });
  const chip = (c, i) => {
    const lit = c.cwd === now.cwd;
    return h_flex().id(`${id}-${i}`).h(24).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
      .bg(lit ? t.selected : t.background).text_color(lit ? t.foreground : t.muted)
      .when(lit, (el) => el.font_semibold())
      .when(!lit && Boolean(c.pane), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(c.n === null ? tilde(c.cwd, on) : `Pane ${c.n} · ${tilde(c.cwd, on)}`)
      .on_mouse_down("left", stop)
      // The main pane's folder is no pick: choosing it clears the tab's pick.
      .on_click(() => { if (!lit && c.pane) setPick(tab.id, c.cwd === main.cwd ? null : { pane: c.pane }); })
      .when(c.n !== null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(c.n))))
      .child(div().max_w(150).truncate().child(nameOf(c.cwd, on)))
      .when(Boolean(c.branch), (el) => el.child(div().max_w(120).truncate().text_size(11).text_color(t.dim).child(c.branch)));
  };
  const bar = h_flex().id(id).h(FOLDER_BAR_H).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
    .overflow_x_scrollbar().children(chips.map(chip));
  if (on) return bar;
  const at = tab.id;
  return bar.child(div().flex_1()).child(
    h_flex().id(`${id}-other`).h(24).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).text_color(t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Show another folder on this machine in Files, Changes and Git")
      .on_mouse_down("left", stop)
      .on_click(() => {
        pickFolder({ prompt: "Show" }).then((folder) => { if (folder) setPick(at, { cwd: trim(folder) }); }).catch(() => {});
      })
      .child(svg("mods/files/folder.svg").size(13).flex_none())
      .child("Folder…"),
  );
}
