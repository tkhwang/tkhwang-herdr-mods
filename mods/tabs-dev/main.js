import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, machines, run, openOverlay, theme, window, shared, setShared, layout, settings } from "herdr";
import { MARKDOWN, markdownTab, showMarkdown } from "./markdown.js"; // markdown browser

// markdown browser: the Markdown file the open panel is on: Files' preview (files-dev publishes it
// as shared "files-dev.shown"), or the Changes selection better-changes keeps per space.
function markdownTarget(space, active) {
  if (!space) return null;
  if (active === "files") {
    const s = shared("files-dev.shown");
    return s?.space === space.id && s.file && MARKDOWN.test(s.file) ? { file: s.file, on: s.on ?? null, cwd: s.cwd ?? null } : null;
  }
  if (active === "changes") {
    const s = (shared("better-changes.diff-tabs") ?? {})[space.id]?.selection;
    return s?.path && s.root && MARKDOWN.test(s.path) ? { file: `${s.root}/${s.path}`, on: s.on ?? null, cwd: s.root } : null;
  }
  return null;
}

// view mode: the switch's 1 ("mobile") shows a tab's main window, its first pane, alone and
// zoomed, so the secondary windows fold away (they keep running) and the file panel keeps its
// room; its 2 ("desktop") shows them side by side, and a click on 2 in a tab with only its main
// window splits it to make the secondary one. 1 folds a tab with an agent, or a tab of main and
// one secondary window; others (herdr-dev.sh's four-pane dev tab) keep all their panes. Shared,
// so it survives restarts; the panes 1 zoomed are remembered so 2 unzooms exactly those on its
// own (a click on 2 unzooms any).
const VIEW = "tabs-dev.view";
const VIEW_ZOOMED = "tabs-dev.view-zoomed";
const viewMode = () => (shared(VIEW) === "mobile" ? "mobile" : "desktop");
// A tab's windows (terminal panes) in pane order, the first being its main window.
const windowsOf = (inTab) => inTab.filter(p => p.terminal);
const agentOf = (inTab) => inTab.find(p => p.program?.agent || p.status) ?? null;
// Whether 1 folds the tab to its main window.
const folds = (inTab) => { const n = windowsOf(inTab).length; return n === 2 || (n > 2 && Boolean(agentOf(inTab))); };
// What a look at the shown tab depends on: an agent starting or ending there changes it.
const viewKey = (tab, mode, inTab) => `${mode}\0${tab}\0${agentOf(inTab)?.pane ?? ""}`;

// tab width: a minimum, so a short name still gives a wide click target.
// A longer name still widens the tab (the name itself caps at 170).
const TAB_MIN_W = 180;

// tab kind: a tab with an agent in any of its panes is tinted yellow, the color that
// stands out most, since agent tabs matter most. Plain shell tabs keep the theme's grey.
const AGENT = "#facc15";
// Alpha suffixes for AGENT: [inactive, active].
const AGENT_BG = ["26", "4d"], AGENT_HOVER = ["40", "5c"], AGENT_BORDER = ["40", "b3"];
// Other tabs are outlined in the theme's foreground at these alphas, [inactive, active],
// so the outline shows in light and dark themes alike. The theme's own `border` (9% white
// in graphite) and `input` (14%) almost vanish against the bar.
const OUTLINE = ["40", "66"];
const withAlpha = (color, aa, fallback) => /^#[0-9a-f]{6}$/i.test(color ?? "") ? color + aa : fallback;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // view mode: looks at the shown tab again when the mode, the tab, or the agent in it changes
  // (one started in a shell there, or one that ended), never on a zoom the person did by hand.
  syncView(space) {
    // The pane a click on 2 opened has come, or its tab has gone: the next click may open one.
    if (this.opening && windowsOf(panes().filter(p => p.tab === this.opening.tab)).length !== 1) this.opening = null;
    const tab = space?.tabs?.find(c => c.active)?.id, inTab = tab ? panes().filter(p => p.tab === tab) : [];
    if (!inTab.length) return; // panes not in yet (a fresh start): look again on the next render
    const key = viewKey(tab, viewMode(), inTab);
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.applyView(inTab, viewMode(), false);
  }

  // view mode: a click on the switch puts the shown tab in that mode even when the mode is on
  // already (a tab split since it was folded folds then), over a zoom done by hand too: 2 shows
  // every pane, 1 the main window. A click on 2 in a tab with only its main window gives it its
  // secondary window: main split down the middle, the new shell starting in main's folder.
  chooseView(space, mode) {
    if (viewMode() !== mode) setShared(VIEW, mode);
    const tab = space?.tabs?.find(c => c.active)?.id, inTab = tab ? panes().filter(p => p.tab === tab) : [];
    if (!inTab.length) return;
    this.applyView(inTab, mode, true);
    // A second click while the new pane is still on its way doesn't open another. On another
    // machine it can take a while, so this holds until the pane comes (syncView lets go then),
    // or for 10 s should it never come.
    const windows = windowsOf(inTab), now = Date.now();
    if (mode === "desktop" && windows.length === 1 && !(this.opening?.tab === tab && now - this.opening.at < 10000)) {
      this.opening = { tab, at: now };
      run("pane.focus", { pane: windows[0].pane });
      run("terminal.open", windows[0].cwd ? { place: "right", folder: windows[0].cwd } : { place: "right" });
    }
    this.viewKey = viewKey(tab, mode, inTab); // the render this causes finds nothing to do
  }

  // view mode: puts the tab whose panes are `inTab` in `mode`. Without `force` (a tab, mode or
  // agent change) only a zoom this mode made comes undone.
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
    // 2, or a tab 1 leaves whole (herdr-dev.sh's grid of test watchers and servers): a zoom this
    // mode made comes undone, and a click on 2 undoes one done by hand too.
    if (!zoomed || !(ours.includes(zoomed.pane) || (force && mode === "desktop"))) return;
    run("pane.zoom", { pane: zoomed.pane });
    setShared(VIEW_ZOOMED, ours.filter(p => p !== zoomed.pane));
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const inTab = panes().filter(p => p.tab === c.id);
      const agent = inTab.find(p => p.program?.agent);
      const program = (agent ?? inTab[0])?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const a = c.active ? 1 : 0; // tab kind
      return h_flex().id(`tab-${c.id}`).h(29).min_w(TAB_MIN_W).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // Other tabs are always outlined (inactive ones used to match the bar and read as
        // bare text); the active one is also filled.
        .border(1).border_color(agent ? AGENT + AGENT_BORDER[a] : withAlpha(t.foreground, OUTLINE[a], t.dim))
        .bg(agent ? AGENT + AGENT_BG[a] : c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(agent ? AGENT + AGENT_HOVER[a] : t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        // flex_grow (not flex_1) keeps the name's own width as its base, so the spare
        // width goes to the name and the status dot and close button sit at the right edge.
        .child(div().flex_grow(1).max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "graph"]; // git graph
    this.syncPanel(space, panel, body, enabled);
    this.syncView(space); // view mode
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    // markdown browser: the Markdown button renders the file picked in the open panel (Files'
    // preview, or the Changes selection) in this space's viewer tab; lit while that tab is shown.
    const md = markdownTarget(space, body?.active), mdTab = markdownTab(space?.id)?.tab;
    const mdOn = Boolean(mdTab) && Boolean(space?.tabs?.some(c => c.id === mdTab && c.active));
    const markdownButton = h_flex().id("panel-markdown").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(mdOn ? t.selected : t.chrome).text_color(mdOn ? t.foreground : md ? t.muted : t.dim)
      .tooltip(md ? `Render ${md.file.split("/").pop()}` : "Pick a Markdown file in Files or Changes first")
      .on_mouse_down("left", stop)
      .when(Boolean(md), el => el.hover(s => s.bg(t.hover)).on_click((_e, cx) => showMarkdown(md, cx)))
      .child(svg("mods/markdown-browser/markdown.svg").size(14)).child("Markdown");
    // view mode: a [1] | [1|2] switch right of + (Mobile | Desktop inside): a little picture of the
    // tab's windows, numbered as the folder bar numbers them: 1 the main window alone, 2 the
    // secondary window beside it. The mode you are in is lit; a click on either puts the shown tab
    // in that mode. The picture's lines take the digits' color, so hover is tracked here.
    const mobile = viewMode() === "mobile";
    const viewChoice = (id, cells, label, on, mode) => {
      const hot = on || this.viewHover === id, ink = hot ? t.foreground : t.dim;
      return div().id(id).h(24).px(5).flex_none().flex().items_center().justify_center().rounded(5)
        .bg(on ? t.selected : hot ? t.hover : t.chrome).text_color(ink)
        .tooltip(label).accessibility_label(label)
        .on_hover((hovered, cx) => {
          const next = hovered ? id : this.viewHover === id ? null : this.viewHover;
          if (next !== this.viewHover) { this.viewHover = next; cx.notify(); }
        })
        .on_mouse_down("left", stop).on_click(() => this.chooseView(space, mode))
        .child(h_flex().h(15).flex_none().rounded(3).border_1().border_color(ink).children(cells.map((digit, i) =>
          div().w(cells.length === 1 ? 13 : 11).h_full().flex().items_center().justify_center().text_size(10).font_semibold()
            .when(i > 0, el => el.border_l(1).border_color(ink)).child(digit))));
    };
    const viewButton = h_flex().id("view-mode").h(26).p(1).gap(1).flex_none().items_center().rounded(6).border_1().border_color(t.border)
      .child(viewChoice("view-mobile", ["1"], "1: the main window alone", mobile, "mobile"))
      .child(viewChoice("view-desktop", ["1", "2"], "2: the main and secondary windows (a tab with one window gets a second)", !mobile, "desktop"));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      // open with zed: the + menu with an "Open with Zed" row (mods/herdr-open-with-zed), one row taller.
      .child(button("tab-new", "+", () => openOverlay({ mod: "herdr-open-with-zed", kind: "popup", width: 250, height: 543 })))
      .child(viewButton) // view mode
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(panelButton("graph", "Git", "mods/git-graph/icons/graph.svg")) // git graph
      .child(markdownButton) // markdown browser
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-dev/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-dev/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-dev/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
