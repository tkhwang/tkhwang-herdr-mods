// tkhwang-update: the window over Herdr that the pill's What changed and Details open (and
// `herdr-app do mod.open --name tkhwang-update`, through mod.json's overlay). It shows what
// model.js's windowOf says for the shared state, and follows it live: an update offered (the pull
// requests and commits since the installed commit, Later, Stop checking, Update now), running,
// done (what it brought, where apply put the files it replaced, new mods to restart for), failed
// (what it printed, Retry), or nothing to update (what is installed, when GitHub was asked).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, settings, closeOverlay, home } from "herdr";
import { windowOf, offerOf, short, WEB } from "./model.js";
import { state, save, check, startUpdate } from "./state.js";

export class Dialog {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  render() {
    const t = theme();
    const s = state();
    const w = windowOf(s, { home: home() });
    const mono = settings().font_family ?? "JetBrains Mono";
    const close = () => closeOverlay(props().overlay);
    // An action that waits (exec, fetch) runs in its own task, then closes the window or redraws it.
    const then = (work, closing) => (_e, cx) => cx.spawn(async (cx) => {
      await work();
      if (closing) close();
      else cx.notify();
    });
    const button = (id, label, primary, action) =>
      h_flex().id(id).h(30).px(12).flex_none().items_center().rounded(7).border_1()
        .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
        .cursor_pointer().hover((st) => st.opacity(0.88)).on_click(action).child(label);
    const quiet = (id, label, action) =>
      div().id(id).flex_none().text_size(12).text_color(t.dim).cursor_pointer()
        .hover((st) => st.text_color(t.foreground)).on_click(action).child(label);
    const label = (text) => div().pt(10).pb(2).text_size(11.5).text_color(t.dim).child(text);

    const body = [];
    if (w.kind === "offer" || w.kind === "done") {
      body.push(label("What changed"));
      body.push(this.list(w, t, mono));
    } else if (w.kind === "failed") {
      body.push(
        v_flex().id("tu-tail").flex_1().min_h(0).mt(6).p(10).rounded(8).overflow_y_scrollbar()
          .bg(t.background).border_1().border_color(t.border).font_family(mono).text_size(11.5).text_color(t.muted)
          .children(w.tail.split("\n").map((line) => div().child(line || " "))),
      );
    } else {
      body.push(div().flex_1());
    }

    const footer = [];
    if (w.kind === "offer") {
      footer.push(quiet("tu-stop", "Stop checking", () => { save({ off: true }); close(); }));
      footer.push(div().flex_1());
      if (s.dismissed !== s.head?.sha) footer.push(button("tu-later", "Later", false, () => { save({ dismissed: s.head?.sha }); close(); }));
      footer.push(button("tu-github", "GitHub", false, (_e, cx) => cx.open_url(w.url)));
      footer.push(button("tu-update", "Update now", true, then(startUpdate, true)));
    } else if (w.kind === "done") {
      footer.push(div().flex_1());
      footer.push(button("tu-github", "GitHub", false, (_e, cx) => cx.open_url(w.url)));
      footer.push(button("tu-close", "Close", true, close));
    } else if (w.kind === "failed") {
      footer.push(quiet("tu-copy", this.copied ? "Copied" : "Copy output", (_e, cx) => { cx.write_to_clipboard(w.tail); this.copied = true; cx.notify(); }));
      footer.push(div().flex_1());
      footer.push(button("tu-close", "Close", false, close));
      if (offerOf(s, { all: true })) footer.push(button("tu-retry", "Retry", true, then(startUpdate, true)));
    } else if (w.kind === "status") {
      footer.push(div().flex_1());
      footer.push(button("tu-check", this.checking ? "Checking…" : "Check now", false, (_e, cx) => {
        if (this.checking) return;
        this.checking = true;
        cx.spawn(async (cx) => {
          try {
            await check({ manual: true });
          } finally {
            this.checking = false;
            cx.notify();
          }
        });
        cx.notify();
      }));
      footer.push(button("tu-close", "Close", true, close));
    } else {
      footer.push(div().flex_1());
      footer.push(button("tu-close", "Close", true, close));
    }

    return v_flex().id("tkhwang-update-window").track_focus(this.handle).size_full().min_h(0).p(18).gap(4)
      .bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().items_center().gap(8).pb(4)
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(w.title))
        .child(div().id("tu-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click(close).child("Esc")))
      .children(w.lines.map((line) => div().text_color(t.muted).child(line)))
      .children(body)
      .child(h_flex().pt(14).gap(8).items_center().children(footer));
  }

  // The pull requests and commits, newest first: a request's line opens it on GitHub, a commit's
  // opens the commit.
  list(w, t, mono) {
    if (!w.commits) return div().flex_1().text_color(t.muted).child("GitHub couldn't list the commits in between: it may not have the installed one. GitHub shows what it can.");
    if (!w.commits.length) return div().flex_1().text_color(t.muted).child("No commits to list.");
    const rows = w.commits.map((c, i) => c.pr != null
      ? h_flex().id(`tu-c${i}`).when(i > 0, (el) => el.mt(6)).px(4).py(2).gap(8).items_start().rounded(5).cursor_pointer()
          .hover((st) => st.bg(t.hover)).on_click((_e, cx) => cx.open_url(`${WEB}/pull/${c.pr}`))
          .child(div().flex_none().text_color(t.accent).font_semibold().child(`#${c.pr}`))
          .child(div().flex_1().min_w(0).font_semibold().child(c.title))
      : h_flex().id(`tu-c${i}`).pl(16).pr(4).py(1).gap(8).items_start().rounded(5).cursor_pointer()
          .hover((st) => st.bg(t.hover)).on_click((_e, cx) => cx.open_url(`${WEB}/commit/${c.sha}`))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(c.subject))
          .child(div().flex_none().font_family(mono).text_size(11).text_color(t.dim).child(short(c.sha))));
    if (w.more > 0) rows.push(div().pt(8).px(4).text_color(t.dim).child(`and ${w.more} more on GitHub`));
    return v_flex().id("tu-commits").flex_1().min_h(0).overflow_y_scrollbar().children(rows);
  }
}
