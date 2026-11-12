// tkhwang-update: tells when this repository's main branch (github.com/tkhwang/tkhwang-herdr-mods)
// has commits the app doesn't, and installs them. It is a pill floating at the bottom of the window
// (the layout's `mods-update` floating block), drawn only when it has something to say, as Herdr's
// own "Updated to …" pill:
//
//   ● Update for tkhwang-herdr-mods  3 new commits  What changed  Update  ×
//   ◌ Updating tkhwang-herdr-mods…
//   ● Updated tkhwang-herdr-mods to 0b3513b  What changed  ×
//   ● tkhwang-herdr-mods update failed  Details  Retry  ×
//
// What is installed is what `./sync.sh apply` recorded in the app folder (tkhwang-herdr-mods.json):
// the commit it was built from and its tree. Every 3 hours the pill asks GitHub's public API for
// the branch's newest commit, and, when that is new, for the commits since the installed one. ×
// on an offer puts that version off (Later); the next commit brings the pill back. Update downloads
// the commit from GitHub and runs that copy's ./sync.sh apply, which moves every file it replaces
// to ~/.config/herdr-app.bak-<time>-<pid>/ first; Herdr reloads changed mods at once, and a new
// mod folder at its next start. What changed opens the window (dialog.js) with the pull requests
// and commits, Later, Stop checking and GitHub's compare page.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, placement, nextCommand } from "herdr";
import { pillOf } from "./model.js";
import { state, save, look, check, startUpdate, settle, openWindow } from "./state.js";
import { Dialog } from "./dialog.js";

// The first look waits a moment after a start, so `herdr-app check` (which loads a mod once, as
// ./sync.sh apply does for each changed one) asks GitHub nothing.
const FIRST_LOOK = 5000;
// The install record is read every minute; GitHub is asked only when due (EVERY in model.js).
const LOOK_EVERY = 60000;
// While an update runs, its log is read this often.
const WATCH_EVERY = 2000;

export default class Update extends View {
  init(_props, cx) {
    // Opened over the window (the pill's What changed, `mod.open`), it is the window; in the
    // layout, the pill.
    this.part = props()?.overlay ? new Dialog() : new Pill();
    this.part.init(cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}

class Pill {
  init(cx) {
    // No guard against overlapping looks: check() saves when it asked before asking, so a slow
    // answer (or one that never comes) doesn't make the next look ask again.
    cx.timer.after(FIRST_LOOK, (cx) => cx.spawn(() => look()));
    cx.timer.every(LOOK_EVERY, (cx) => cx.spawn(() => look()));
    // `herdr-app do tkhwang-update.check` (or a key in keys.json) asks GitHub now and starts
    // checking again after Stop checking; `.open` opens the window; `.update` installs the offer.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "check") await check({ manual: true });
        else if (command === "open") openWindow();
        else if (command === "update") await startUpdate();
        cx.notify();
      }
    });
  }

  // Reads the running update's log until it ends, also when this copy started fresh mid-update
  // (the update reloaded this mod, or Herdr restarted).
  watch(cx) {
    this.watchQueued = false;
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        while (!(await settle())) await cx.sleep(WATCH_EVERY);
      } finally {
        this.watching = false;
      }
    });
  }

  render(cx) {
    const s = state();
    // Shared state must not change during a render: the watch starts right after it.
    if (s.run && !this.watching && !this.watchQueued) {
      this.watchQueued = true;
      cx.timer.after(0, (cx) => this.watch(cx));
    }
    const pill = pillOf(s);
    if (!pill) return div();
    const t = theme();
    const vertical = Boolean(placement()?.vertical);
    const later = (work) => (_e, cx) => cx.spawn(async () => { await work(); });
    const link = (id, label, action, strong = false) =>
      div().id(id).flex_none().text_color(t.accent).when(strong, (el) => el.font_semibold())
        .cursor_pointer().hover((st) => st.opacity(0.75)).on_click(action).child(label);
    const close = (action) =>
      div().id("tu-close").flex_none().px(3).text_size(14).text_color(t.dim).cursor_pointer()
        .hover((st) => st.text_color(t.foreground)).on_click(action).child("×");
    const lead = pill.kind === "running"
      ? svg("mods/tkhwang-update/spinner.svg").size(12).flex_none().text_color(t.accent).spin(900)
      : div().size(6).rounded(3).flex_none().bg(pill.kind === "failed" ? t.blocked : pill.kind === "done" ? t.done : t.accent);
    const parts = [h_flex().gap(8).items_center().child(lead).child(div().flex_none().child(pill.text))];
    if (pill.note) parts.push(div().flex_none().text_color(t.muted).child(pill.note));
    if (pill.kind === "offer") {
      parts.push(link("tu-changes", "What changed", () => openWindow()));
      parts.push(link("tu-update", "Update", later(startUpdate), true));
      parts.push(close(() => save({ dismissed: s.head?.sha })));
    } else if (pill.kind === "done") {
      parts.push(link("tu-changes", "What changed", () => openWindow()));
      parts.push(close(() => save({ result: null })));
    } else if (pill.kind === "failed") {
      parts.push(link("tu-details", "Details", () => openWindow()));
      parts.push(link("tu-retry", "Retry", later(startUpdate), true));
      parts.push(close(() => save({ result: null })));
    }
    // On a side edge (dragged there) the parts stack.
    return (vertical ? v_flex().py(4).items_start().gap(6) : h_flex().h(22).items_center().gap(12))
      .id("tkhwang-update").px(10).text_size(12.5).text_color(t.foreground).children(parts);
  }
}
