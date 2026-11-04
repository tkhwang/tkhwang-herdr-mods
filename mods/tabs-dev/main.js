import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings } from "herdr";
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

// view mode: Desktop shows a tab's panes side by side (agent | shell | file panel); Mobile shows
// one pane per tab, its agent (else the focused pane) zoomed, so the shell column folds away and
// the file panel keeps its room. Shared, so it survives restarts; the panes Mobile zoomed are
// remembered so Desktop unzooms exactly those.
const VIEW = "tabs-dev.view";
const VIEW_ZOOMED = "tabs-dev.view-zoomed";
const viewMode = () => (shared(VIEW) === "mobile" ? "mobile" : "desktop");

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

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  // view mode: acts when the mode or the shown tab changes, never on a zoom the person did by hand.
  syncView(space) {
    const tab = space?.tabs?.find(c => c.active)?.id, mode = viewMode();
    if (!tab || (mode === this.viewMode && tab === this.viewTab)) return;
    const inTab = panes().filter(p => p.tab === tab), zoomed = inTab.find(p => p.zoomed);
    if (!inTab.length) return; // panes not in yet (a fresh start): look again on the next render
    this.viewMode = mode; this.viewTab = tab;
    const alive = new Set(panes().map(p => p.pane));
    const ours = (shared(VIEW_ZOOMED) ?? []).filter(p => alive.has(p));
    if (mode === "mobile") {
      if (inTab.length < 2 || zoomed) return;
      const target = inTab.find(p => p.program?.agent || p.status) ?? inTab.find(p => p.focused) ?? inTab[0];
      run("pane.zoom", { pane: target.pane });
      run("pane.focus", { pane: target.pane });
      setShared(VIEW_ZOOMED, [...ours, target.pane]);
    } else if (zoomed && ours.includes(zoomed.pane)) {
      run("pane.zoom", { pane: zoomed.pane });
      setShared(VIEW_ZOOMED, ours.filter(p => p !== zoomed.pane));
    }
  }

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
    // view mode: a 3-column | 2-column switch left of + (Desktop | Mobile inside), the mode you are in
    // lit; the other one switches.
    const mobile = viewMode() === "mobile";
    const viewChoice = (id, icon, label, on, mode) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(5)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.dim)
      .when(!on, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(label).on_mouse_down("left", stop).on_click(() => { if (!on) setShared(VIEW, mode); })
      .child(svg(`mods/tabs-dev/${icon}.svg`).size(15));
    const viewButton = h_flex().id("view-mode").h(26).p(1).gap(1).flex_none().items_center().rounded(6).border_1().border_color(t.border)
      .child(viewChoice("view-desktop", "columns-3", "3 columns: agent | shell | file panel", !mobile, "desktop"))
      .child(viewChoice("view-mobile", "columns-2", "2 columns: agent | file panel", mobile, "mobile"));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(viewButton) // view mode
      // open with zed: the + menu with an "Open with Zed" row (mods/herdr-open-with-zed), one row taller.
      .child(button("tab-new", "+", () => openOverlay({ mod: "herdr-open-with-zed", kind: "popup", width: 250, height: 543 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(panelButton("graph", "Git", "mods/git-graph/icons/graph.svg")) // git graph
      .child(markdownButton) // markdown browser
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-dev/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-dev/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-dev/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
