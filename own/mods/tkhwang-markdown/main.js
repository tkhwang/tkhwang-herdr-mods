// tkhwang-markdown: a Markdown file in the center, in a tab of its own, with View | Diff | Edit in
// its header. View draws the file formatted; Diff shows what changed since the last commit (HEAD to
// the file on disk); Edit opens the whole file as Markdown source, saved 0.7 s after typing stops
// and on ⌘S, never over a change made to the file meanwhile: a bar asks which one stays.
//
// One tab per space, reused in place. A click on a Markdown file in Files (file-icons) opens it on
// View, one in Changes (better-changes) on Diff, through markdown.js, which those mods carry: it
// records the tab in the shared "markdown-tab.tabs" and what it shows in "tkhwang-markdown.show"
// ({ slot: { file, on, mode, at } }). This pane reads its slot there; a newer `at` is another
// click. `on` is the machine the file is on (null: this one). A file on another machine is read
// only (writeTextFile writes here only) and read again every 3 s (watchFolder watches here only).
//
// Commands (`herdr-app do tkhwang-markdown.<name>`, or a key in keys.json): view, diff, edit, save.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState, v_virtual_list, Scrollbar } from "gpui-base";
import { props, shared, setShared, readTextFile, writeTextFile, watchFolder, exec, theme, settings, run, home, window, nextCommand } from "herdr";
import { MARKDOWN, MAX_TEXT, dirOf, nameOf, tildePath, prose, linkTarget, diffRows, addedLines, hunks, bounded, counts } from "./model.js";

const SHOW = "tkhwang-markdown.show";
const TABS = "markdown-tab.tabs";
const MODES = [
  ["view", "View"],
  ["diff", "Diff"],
  ["edit", "Edit"],
];
const isMode = (mode) => MODES.some(([m]) => m === mode);
const AUTOSAVE_MS = 700;
const REMOTE_POLL_MS = 3000;
// Reads that take no index lock and start no fsmonitor helper, so the folder watch isn't woken by
// them; non-ASCII names stay as they are.
const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotePath=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color"];
// file-icons' Material icon for .md (it has no light variant), so the header matches Files and
// Changes; file-icons has to stay installed, as better-changes needs too.
const FILE_ICON = "mods/file-icons/icons/markdown.svg";
const CODE_SIZE = 13;

export default class MarkdownTab extends View {
  init(_props, cx) {
    const p = props() ?? _props ?? {};
    this.slot = p.slot ?? null;
    this.gen = 0;
    this.diffToken = 0;
    const entry = this.entry();
    this.applied = entry?.at ?? null;
    this.open(entry?.file ?? p.file ?? null, entry?.on ?? p.on ?? null, entry?.mode ?? p.mode, cx);
    this.listen(cx);
  }

  // What markdown.js asks this tab to show: { file, on, mode, at }, or null.
  entry() {
    return this.slot ? ((shared(SHOW) ?? {})[this.slot] ?? null) : null;
  }

  // This tab's record in "markdown-tab.tabs" ({ tab, slot, cwd, on }), or null.
  record() {
    return Object.values(shared(TABS) ?? {}).find((e) => e?.slot === this.slot && e.tab) ?? null;
  }

  get canEdit() {
    return !this.on && this.saved !== null && !this.big;
  }

  get dirty() {
    return this.text !== null && this.saved !== null && this.text !== this.saved;
  }

  // ── The file ───────────────────────────────────────────────────────────────

  open(file, on, mode, cx) {
    this.gen++;
    this.file = file;
    this.on = on ?? null;
    this.mode = isMode(mode) ? mode : "view";
    this.saved = null; // the file as last read or written: what a save expects to find on disk
    this.text = null; // the text shown: the editor's when it differs from `saved`
    this.disk = null; // the file's newer text, while a conflict is open
    this.conflict = false;
    this.big = false;
    this.error = null;
    this.saving = false;
    /** @type {string | null} */
    this.writing = null; // the text a save is putting on disk, until writeTextFile returns
    this.again = false;
    this.seq = 0;
    this.savedAt = null;
    this.editor?.release();
    this.editor = null;
    this.diff = null;
    this.diffToken++;
    this.diffLoading = false;
    if (file) {
      this.load(cx);
      this.watch(cx);
    }
  }

  load(cx) {
    const file = this.file;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on: this.on });
        if (gen !== this.gen) return;
        if (text === null) {
          this.error = "This file is no longer available.";
          return;
        }
        if (text.includes("\0")) {
          this.error = "Binary file: nothing to show.";
          return;
        }
        this.error = null;
        // This tab's own save can land, and wake the watch, before writeTextFile returns: that
        // isn't a change made under you, and write() records it as saved once it returns.
        if (text === this.saved || text === this.writing) return;
        // The file now holds what you typed (saved elsewhere, or by the same edit): nothing to choose.
        if (this.dirty && text === this.text) {
          this.saved = text;
          return;
        }
        // Yours isn't saved yet and the file moved on: you choose which stays.
        if (this.dirty) {
          this.disk = text;
          this.conflict = true;
          return;
        }
        this.saved = text;
        this.text = text;
        this.big = text.length > MAX_TEXT;
        if (this.editor && this.editor.value() !== text) this.editor.set_value(text);
        if (this.mode === "edit") this.ensureEditor();
        if (this.mode === "diff") this.loadDiff(cx);
      } catch (error) {
        if (gen === this.gen) this.error = `Cannot read this file: ${error?.message ?? error}`;
      } finally {
        if (gen === this.gen) cx.notify();
      }
    });
  }

  // Reads the file again whenever its folder changes; a file on another machine every 3 s.
  watch(cx) {
    const gen = this.gen;
    const file = this.file;
    cx.spawn(async (cx) => {
      try {
        while (gen === this.gen && !this.closed) {
          if (this.on) await cx.sleep(REMOTE_POLL_MS);
          else await watchFolder(dirOf(file));
          if (gen === this.gen && !this.closed) this.load(cx);
        }
      } catch {
        // The folder can't be watched (gone, or too big on Linux): Refresh still reads it again.
      }
    });
  }

  // ── Edit and save ──────────────────────────────────────────────────────────

  // The editor is made the first time Edit shows, from an event or a task (never in render).
  ensureEditor() {
    if (this.editor || this.text === null) return;
    const t = theme();
    this.editor = EditorState.new({
      language: "markdown",
      value: this.text,
      readonly: !this.canEdit,
      soft_wrap: true,
      font_family: settings().font_family,
      font_size: CODE_SIZE,
      // Herdr colors only code scopes (its syntax.rs), so in Markdown just the marks (# ** ` - > [ ]
      // and fences) are "punctuation"; headings, emphasis, inline code and URLs stay plain text.
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, punctuation: t.accent },
    });
    this.editor.on("change", (_e, cx) => this.changed(cx));
  }

  changed(cx) {
    const value = this.editor?.value();
    if (value === undefined || value === this.text) return;
    this.text = value;
    const seq = ++this.seq;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      await cx.sleep(AUTOSAVE_MS);
      if (seq === this.seq && gen === this.gen) await this.write(cx);
    });
    cx.notify();
  }

  save(cx) {
    cx.spawn(async (cx) => {
      await this.write(cx);
    });
  }

  // Writes what you typed, only over the file as it was last read. True when nothing is left unsaved.
  async write(cx) {
    if (!this.dirty) return true;
    if (!this.canEdit || this.conflict) return false;
    if (this.saving) {
      this.again = true;
      return false;
    }
    const file = this.file;
    const gen = this.gen;
    const text = this.text;
    const expected = this.saved;
    this.saving = true;
    this.writing = text;
    cx.notify();
    let ok = false;
    try {
      await writeTextFile(file, text, expected);
      if (gen === this.gen) {
        this.saved = text;
        this.savedAt = Date.now();
        this.error = null;
      }
      ok = true;
    } catch {
      // The file changed on disk after it was read: show both and let you choose.
      const disk = await readTextFile(file, { on: this.on }).catch(() => null);
      if (gen === this.gen) {
        if (disk !== null && disk !== expected) {
          this.disk = disk;
          this.conflict = true;
        } else this.error = "Cannot save this file.";
      }
    } finally {
      if (gen === this.gen) {
        this.saving = false;
        this.writing = null;
        if (this.again) {
          this.again = false;
          if (!this.conflict) this.save(cx);
        }
        if (ok && this.mode === "diff") this.loadDiff(cx);
        cx.notify();
      }
    }
    return ok && !this.dirty;
  }

  keepMine(cx) {
    const disk = this.disk;
    this.saved = disk;
    this.conflict = false;
    this.disk = null;
    this.save(cx);
    cx.notify();
  }

  takeTheirs(cx) {
    const disk = this.disk;
    this.saved = disk;
    this.text = disk;
    this.big = disk.length > MAX_TEXT;
    this.conflict = false;
    this.disk = null;
    this.seq++;
    if (this.editor) this.editor.set_value(disk);
    if (this.mode === "diff") this.loadDiff(cx);
    cx.notify();
  }

  // ── Modes, commands and links ──────────────────────────────────────────────

  setMode(mode, cx) {
    if (!isMode(mode) || !this.file) return;
    const was = this.mode;
    this.mode = mode;
    if (mode === "edit") this.ensureEditor();
    // Leaving Edit saves first; Diff then shows the file as saved (write() reloads it).
    if (was === "edit" && mode !== "edit" && this.dirty) this.save(cx);
    else if (mode === "diff") this.loadDiff(cx);
    cx.notify();
  }

  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "save") this.save(cx);
        else this.setMode(command, cx);
        cx.notify();
      }
    });
  }

  key(event, cx) {
    const save = window()?.platform === "macos" ? "cmd-s" : "ctrl-s";
    if (event.keystroke === save) {
      cx.stop_propagation();
      this.save(cx);
    }
  }

  // A link to another Markdown file opens it in this tab, on View, as a click in Files would; an
  // http(s) URL opens in the system's browser (open_url takes nothing else).
  link(url, cx) {
    const to = linkTarget(url, this.file);
    if (to?.web) {
      try {
        cx.open_url(to.web);
      } catch {
        // mailto: and the like are refused.
      }
    } else if (to?.file && MARKDOWN.test(to.file)) {
      setShared(SHOW, { ...(shared(SHOW) ?? {}), [this.slot]: { file: to.file, on: this.on, mode: "view", at: Date.now() } });
      const record = this.record();
      if (record) run("tab.rename", { id: record.tab, name: nameOf(to.file) });
    }
  }

  // A newer click (another file, or another mode): yours is saved first. While a conflict is open
  // the tab stays on this file; it moves once that is settled.
  async follow(cx) {
    const entry = this.entry();
    if (!entry || entry.at === this.applied) return;
    if (entry.file === this.file && (entry.on ?? null) === this.on) {
      this.applied = entry.at;
      if (entry.mode) this.setMode(entry.mode, cx);
      return;
    }
    if (this.dirty && !(await this.write(cx))) {
      if (!this.conflict) this.applied = entry.at;
      return;
    }
    this.applied = entry.at;
    this.open(entry.file, entry.on ?? null, entry.mode ?? this.mode, cx);
    cx.notify();
  }

  closeTab() {
    const record = this.record();
    if (record) run("tab.close", { id: record.tab });
  }

  // Closing the tab keeps what you typed.
  async close() {
    this.closed = true;
    if (this.dirty && this.canEdit && !this.conflict) {
      try {
        await writeTextFile(this.file, this.text, this.saved);
      } catch {
        // Changed on disk meanwhile: the file's version stays.
      }
    }
    this.editor?.release();
  }

  // ── Diff ───────────────────────────────────────────────────────────────────

  // HEAD to the file on disk, read with git in the file's folder (the path relative to it).
  loadDiff(cx) {
    if (!this.file) return;
    const file = this.file;
    const on = this.on;
    const gen = this.gen;
    const token = ++this.diffToken;
    this.diffLoading = true;
    cx.spawn(async (cx) => {
      let diff;
      try {
        const cwd = dirOf(file);
        const name = nameOf(file);
        const git = (args) => exec("git", [...GIT, ...args], { cwd, on });
        const top = await git(["rev-parse", "--show-toplevel"]);
        if (top.code !== 0) diff = { note: "Not in a Git repository: there is nothing to compare it with." };
        else {
          const root = top.stdout.trim();
          const tracked = (await git(["--literal-pathspecs", "ls-files", "--error-unmatch", "--", name])).code === 0;
          const head = (await git(["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
          let lines;
          let what;
          if (tracked && head) {
            const r = await git(["--literal-pathspecs", "diff", "HEAD", ...DIFF, "--", name]);
            if (r.code !== 0) throw Error(r.stderr.trim() || "Cannot read the diff");
            lines = hunks(r.stdout);
            what = "HEAD → working tree";
            if (!lines) diff = { root, what, note: "No changes since the last commit." };
          } else {
            const text = await readTextFile(file, { on });
            what = tracked ? "No commit yet: the whole file is new" : "Not in Git yet: the whole file is new";
            lines = text === null ? null : addedLines(text);
            if (text === null) diff = { root, what, note: "This file is no longer available." };
            else if (!lines.length) diff = { root, what, note: "Empty new file." };
          }
          if (!diff) {
            const { lines: shown, cut } = bounded(lines);
            const rows = diffRows(shown);
            const widest = Math.max(0, ...shown.map((line) => line.length));
            diff = { root, what, rows, cut, ...counts(rows), width: Math.max(300, widest * CODE_SIZE * 0.62 + 120) };
          }
        }
      } catch (error) {
        diff = { note: error?.message ?? String(error) };
      }
      if (gen !== this.gen || token !== this.diffToken) return;
      this.diff = diff;
      this.diffLoading = false;
      cx.notify();
    });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  render(cx) {
    const asked = this.entry();
    if (asked && asked.at !== this.applied && !this.conflict && !this.saving && !this.following) {
      this.following = true;
      cx.spawn(async (cx) => {
        try {
          await this.follow(cx);
        } finally {
          this.following = false;
          cx.notify();
        }
      });
    }
    const t = theme();
    const root = v_flex()
      .id("tkhwang-markdown")
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t));
    if (this.conflict) root.child(this.conflictBar(t, asked));
    if (!this.file) return root.child(this.note(t, "Click a Markdown file in Files or Changes to show it here."));
    if (this.error) root.child(div().px(16).py(8).flex_none().text_color(t.blocked).child(this.error));
    if (this.mode === "diff") return root.child(this.diffBody(t));
    if (this.text === null) return root.child(this.error ? div() : this.note(t, "Loading…"));
    return root.child(this.mode === "edit" ? this.editBody(t) : this.viewBody());
  }

  header(t) {
    const folder = this.file ? dirOf(this.file) : "";
    const where = this.on ? `${this.on}: ${folder}` : tildePath(folder, home());
    return h_flex()
      .h(44)
      .flex_none()
      .px(12)
      .gap(10)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(image(FILE_ICON).size(16).flex_none())
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().font_semibold().truncate().child(this.file ? nameOf(this.file) : "Markdown"))
          .when(Boolean(this.file), (el) => el.child(div().id("md-where").text_size(11).text_color(t.dim).truncate().tooltip(this.file).child(where))),
      )
      .when(Boolean(this.file), (el) => el.child(this.modeSwitch(t)))
      .child(div().w(72).flex_none().text_size(11.5).text_color(t.dim).text_right().child(this.state()))
      .when(Boolean(this.file), (el) => el.child(this.icon("md-refresh", "refresh", "Read the file again", (cx) => this.refresh(cx), t)))
      .child(this.icon("md-close", "close", "Close this tab", () => this.closeTab(), t));
  }

  refresh(cx) {
    this.load(cx);
    if (this.mode === "diff") this.loadDiff(cx);
  }

  state() {
    if (!this.file || this.text === null) return "";
    if (this.on) return "Read only";
    if (this.big) return "Too large to edit";
    if (this.conflict) return "Not saved";
    if (this.saving) return "Saving…";
    if (this.dirty) return "Edited";
    return this.savedAt ? "Saved" : "";
  }

  // View | Diff | Edit, as one control: the shown mode lit.
  modeSwitch(t) {
    const row = h_flex().id("md-modes").p(2).gap(2).flex_none().items_center().rounded(7).border_1().border_color(t.border).bg(t.raised);
    for (const [mode, label] of MODES) {
      const active = this.mode === mode;
      row.child(
        div()
          .id(`md-mode-${mode}`)
          .h(24)
          .px(12)
          .flex()
          .items_center()
          .rounded(5)
          .text_size(12)
          .bg(active ? t.selected : t.raised)
          .text_color(active ? t.accent : t.muted)
          .when(active, (el) => el.font_semibold())
          .cursor_pointer()
          .hover((el) => el.bg(active ? t.selected : t.hover))
          .on_click((_e, cx) => this.setMode(mode, cx))
          .child(label),
      );
    }
    return row;
  }

  icon(id, name, label, action, t) {
    return div()
      .id(id)
      .size(26)
      .flex()
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .cursor_pointer()
      .tooltip(label)
      .accessibility_label(label)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx))
      .child(svg(`mods/tkhwang-markdown/${name}.svg`).size(14));
  }

  conflictBar(t, asked) {
    const waiting = asked && asked.at !== this.applied && asked.file !== this.file ? ` ${nameOf(asked.file)} opens after you choose.` : "";
    const button = (id, label, solid, action) =>
      div()
        .id(id)
        .h(24)
        .px(10)
        .flex()
        .flex_none()
        .items_center()
        .rounded(5)
        .text_size(12)
        .cursor_pointer()
        .bg(solid ? t.solid : t.raised)
        .text_color(solid ? t.solid_foreground : t.foreground)
        .border_1()
        .border_color(solid ? t.solid : t.border)
        .hover((el) => el.opacity(0.85))
        .on_click((_e, cx) => action(cx))
        .child(label);
    return h_flex()
      .flex_none()
      .px(12)
      .py(8)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .bg(t.raised)
      .child(div().flex_1().min_w(0).text_color(t.blocked).child(`The file changed on disk while you were editing it.${waiting}`))
      .child(button("md-keep-mine", "Keep mine", true, (cx) => this.keepMine(cx)))
      .child(button("md-take-file", "Take the file's", false, (cx) => this.takeTheirs(cx)));
  }

  note(t, text) {
    return div().p(16).text_size(12.5).text_color(t.dim).child(text);
  }

  viewBody() {
    return h_flex()
      .flex_1()
      .min_h(0)
      .justify_center()
      .child(
        div()
          .h_full()
          .w_full()
          .max_w(920)
          .px(24)
          .py(14)
          .text_size(14)
          .child(
            TextView.markdown(`md-view-${this.slot}-${this.file}`, prose(this.text, this.file))
              .scrollable(true)
              .selectable(true)
              .on_link_click((url, cx) => this.link(url, cx))
              .size_full(),
          ),
      );
  }

  editBody(t) {
    if (!this.editor) return this.note(t, "Opening the editor…");
    return v_flex()
      .flex_1()
      .min_h(0)
      .when(!this.canEdit, (el) =>
        el.child(
          div()
            .px(16)
            .py(6)
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .border_b(1)
            .border_color(t.border)
            .child(this.on ? "This file is on another machine: it can be read here, not saved." : "This file is too large to edit here."),
        ),
      )
      .child(Editor.new(this.editor).flex_1().min_h(0));
  }

  diffBody(t) {
    const diff = this.diff;
    const body = v_flex().flex_1().min_h(0);
    const strip = h_flex()
      .h(30)
      .px(14)
      .gap(10)
      .flex_none()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().child([diff?.what, diff?.root ? tildePath(diff.root, home()) : null].filter(Boolean).join(" · ") || "Diff"));
    if (diff?.rows)
      strip.child(div().text_color(t.ansi2).child(`+${diff.add}`)).child(div().text_color(t.ansi1).child(`−${diff.del}`));
    if (this.dirty) strip.child(div().text_color(t.blocked).child("Not saved yet: the diff is of the file on disk"));
    body.child(strip);
    if (!diff) return body.child(this.note(t, this.diffLoading ? "Loading diff…" : ""));
    if (!diff.rows) return body.child(this.note(t, diff.note));
    const height = Math.ceil(CODE_SIZE * 1.6);
    const rows = diff.rows;
    // Kept across reloads, so the list stays where it was scrolled while an agent writes the file.
    const listId = `md-diff-${this.slot}-${this.file}`;
    const font = settings().font_family; // the terminals' font, if set
    const viewport = div()
      .flex_1()
      .min_h(0)
      .relative()
      .when(Boolean(font), (el) => el.font_family(font))
      .text_size(CODE_SIZE)
      .child(
        div()
          .id("md-diff-x")
          .size_full()
          .overflow_x_scrollbar()
          .child(
            div()
              .w_full()
              .min_w(diff.width)
              .h_full()
              .child(
                v_virtual_list(
                  listId,
                  rows.length,
                  height,
                  (i) => String(i),
                  (range) => rows.slice(range.start, range.end).map((row) => this.diffRow(row, t, height)),
                ).size_full(),
              ),
          ),
      )
      .child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
    body.child(viewport);
    if (diff.cut)
      body.child(div().px(14).py(6).flex_none().text_size(11.5).text_color(t.dim).child("Diff cut to 3,000 lines and 4,000 characters per line."));
    return body;
  }

  diffRow(row, t, height) {
    if (row.kind === "@" || row.kind === "\\")
      return div().h(height).px(12).w_full().flex().items_center().bg(t.raised).text_color(row.kind === "@" ? t.accent : t.dim).child(row.text);
    const color = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.foreground;
    const number = (n) => div().w(40).flex_none().text_right().text_color(t.dim).child(n === undefined ? "" : String(n));
    return h_flex()
      .h(height)
      .w_full()
      .gap(8)
      .items_center()
      .when(row.kind !== " ", (el) => el.bg(color + "18"))
      .child(number(row.old))
      .child(number(row.next))
      .child(div().w(12).flex_none().text_color(color).child(row.kind === " " ? "" : row.kind))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_color(color).child(row.text || " "));
  }
}
