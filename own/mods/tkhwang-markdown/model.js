// tkhwang-markdown: what the tab shows, worked out from text alone (no herdr calls), so it can be
// checked with plain node.

export const MARKDOWN = /\.(md|mdx|markdown)$/i;

// Past this many characters the file is shown cut and can't be edited.
export const MAX_TEXT = 400000;
// A diff longer than this is cut, and so is a line longer than MAX_LINE.
export const MAX_DIFF_LINES = 3000;
export const MAX_LINE = 4000;

export const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, "") || "/";
export const nameOf = (path) => path.split(/[\\/]/).pop();

// `~/…` for a folder under the home folder.
export function tildePath(path, home) {
  const h = (home ?? "").replace(/[\\/]+$/, "");
  return h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
}

// The text View draws: YAML front matter as a yaml code block (rendered as prose it would run into
// the first paragraph), and in MDX the top-level import/export lines left out.
export function prose(text, file = "") {
  let body = text;
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(body);
  if (front) body = "```yaml\n" + front[1] + "\n```\n\n" + body.slice(front[0].length);
  if (/\.mdx$/i.test(file)) {
    let fence = null;
    body = body
      .split("\n")
      .filter((line) => {
        const m = line.match(/^\s*(`{3,}|~{3,})/);
        if (m && !fence) fence = m[1];
        else if (m && fence && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        else if (!fence && /^(import|export)\s/.test(line)) return false;
        return true;
      })
      .join("\n");
  }
  return body.length > MAX_TEXT ? body.slice(0, MAX_TEXT) + "\n\n… (file truncated)" : body;
}

// Where a link in the document goes: { web } for a URL the system opens, { file } for a path on the
// same machine (relative to the document, `#anchor` dropped), or null (an anchor, other schemes).
export function linkTarget(url, docPath) {
  if (/^(https?:|mailto:)/i.test(url)) return { web: url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return null;
  let given = url.replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
  try {
    given = decodeURIComponent(given);
  } catch {
    // A stray % stays as written.
  }
  if (!given) return null;
  const joined = given.startsWith("/") ? given : `${dirOf(docPath)}/${given}`;
  const parts = [];
  for (const part of joined.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return { file: "/" + parts.join("/") };
}

// `git diff` output (from its first @@) as rows: { kind: "@" | "+" | "-" | " " | "\\", text, old,
// next } with each side's line number.
export function diffRows(lines) {
  const rows = [];
  let old = 0;
  let next = 0;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      rows.push({ kind: "@", text: line });
    } else if (line.startsWith("+")) rows.push({ kind: "+", text: line.slice(1), next: next++ });
    else if (line.startsWith("-")) rows.push({ kind: "-", text: line.slice(1), old: old++ });
    else if (line.startsWith("\\")) rows.push({ kind: "\\", text: line });
    else rows.push({ kind: " ", text: line.slice(1), old: old++, next: next++ });
  }
  return rows;
}

// A file Git doesn't have yet: every line added.
export function addedLines(text) {
  if (!text) return [];
  const all = text.replace(/\n$/, "").split("\n");
  return [`@@ -0,0 +1,${all.length} @@`, ...all.map((line) => `+${line}`)];
}

// The lines of `git diff` from its first hunk, cut to the limits; null when there is no hunk (no
// change, or a mode-only change).
export function hunks(stdout) {
  const all = stdout.replace(/\n$/, "").split("\n");
  const first = all.findIndex((line) => line.startsWith("@@"));
  return first < 0 ? null : all.slice(first);
}

// Cuts a diff to MAX_DIFF_LINES lines of at most MAX_LINE characters: { lines, cut }.
export function bounded(lines) {
  const cut = lines.length > MAX_DIFF_LINES || lines.some((line) => line.length > MAX_LINE);
  return {
    cut,
    lines: lines.slice(0, MAX_DIFF_LINES).map((line) => (line.length > MAX_LINE ? line.slice(0, MAX_LINE) + "…" : line)),
  };
}

// How many lines a diff adds and removes.
export function counts(rows) {
  let add = 0;
  let del = 0;
  for (const row of rows) {
    if (row.kind === "+") add++;
    else if (row.kind === "-") del++;
  }
  return { add, del };
}
