// Pure transformations: Git output → changed files → tree/diff display rows.
// No Herdr APIs or filesystem access belong here, so parsing stays testable.

/** Parse `git diff --numstat -z` without losing tabs inside filenames. */
function parseNumstat(text) {
  // Filenames such as "constructor" and "__proto__" must be ordinary keys.
  const stats = Object.create(null);
  for (const entry of text.split("\0")) {
    const [added, deleted, ...pathParts] = entry.split("\t");
    if (!pathParts.length) continue;

    // Git uses '-' instead of a line count for binary files.
    stats[pathParts.join("\t")] = {
      add: Number(added) || 0,
      del: Number(deleted) || 0,
      binary: added === "-",
    };
  }
  return stats;
}

/**
 * Combine porcelain-v1 status with [index, working-tree] numstat output.
 * Callers disable rename detection so each NUL-delimited entry has one path.
 * A partially staged file belongs to both groups, with separate statistics.
 */
export function changedFiles(status, numstats) {
  const statistics = numstats.map(parseNumstat);
  const emptyStats = { add: 0, del: 0 };

  return status
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      // Porcelain's X column describes the index; Y describes the working tree.
      const xy = entry.slice(0, 2);
      const path = entry.slice(3);
      const fresh = xy === "??";
      const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
      const stagedStats = statistics[0]?.[path] ?? emptyStats;
      const unstagedStats = statistics[1]?.[path] ?? emptyStats;

      return {
        path,
        fresh,
        conflict,
        // Conflicts stay in the unstaged group until the user resolves them.
        staged: !fresh && !conflict && xy[0] !== " " && xy[0] !== "?",
        unstaged: fresh || conflict || xy[1] !== " ",
        status: conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M",
        stagedStatus: conflict ? "U" : xy[0],
        unstagedStatus: fresh ? "A" : conflict ? "U" : xy[1],
        stagedStats,
        unstagedStats,
        add: stagedStats.add + unstagedStats.add,
        del: stagedStats.del + unstagedStats.del,
        binary: Boolean(stagedStats.binary || unstagedStats.binary),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Build directory-first display rows, omitting descendants of closed folders. */
export function fileTree(files, closed = new Set()) {
  const root = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop(); // The final component is the filename, not a directory.
    let node = root;
    let path = "";

    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { path, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part);
    }
    node.files.push(file);
  }

  const rows = [];
  function walk(node, depth) {
    const directories = [...node.dirs].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, directory] of directories) {
      rows.push({ kind: "folder", name, path: directory.path, depth });
      if (!closed.has(directory.path)) walk(directory, depth + 1);
    }
    for (const file of node.files) {
      rows.push({ kind: "file", file, depth });
    }
  }

  walk(root, 0);
  return rows;
}

/**
 * Attach old/new line numbers to unified diff lines. Hunk headers reset both
 * counters; metadata such as "No newline at end of file" consumes neither.
 */
export function diffRows(lines) {
  let oldLine = 0;
  let newLine = 0;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { kind: "@", text };
    }

    const kind = text[0];
    if (kind === "-") return { kind, old: oldLine++, text: text.slice(1) };
    if (kind === "+") return { kind, next: newLine++, text: text.slice(1) };
    if (kind === " ") {
      return { kind, old: oldLine++, next: newLine++, text: text.slice(1) };
    }
    return { kind: "", text };
  });
}

/**
 * Align each replacement block by position, not textual similarity. Missing
 * counterparts become blank cells. Never pair across context or hunk boundaries.
 */
export function splitDiffRows(rows) {
  const paired = [];
  const removed = [];
  const added = [];

  function flushReplacement() {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      paired.push({
        kind: "pair",
        left: removed[index] ?? null,
        right: added[index] ?? null,
      });
    }
    removed.length = 0;
    added.length = 0;
  }

  for (const row of rows) {
    if (row.kind === "-") removed.push(row);
    else if (row.kind === "+") added.push(row);
    else {
      flushReplacement();
      // Context appears on both sides; headers and metadata span both columns.
      paired.push(row.kind === " " ? { kind: "pair", left: row, right: row } : row);
    }
  }
  flushReplacement();
  return paired;
}

// ai message: the prompt AI_COMMAND (main.js) answers with a commit message. The recent
// commit messages carry the repository's language, prefix style and whether bodies are
// written; the diff is cut at a size the model answers quickly from, well under Herdr's
// 30 s limit on a command.
export const AI_DIFF_LIMIT = 40000;
const AI_EXAMPLE_LIMIT = 600;

export function aiPrompt({ stat, diff, examples, branch }) {
  const cut = diff.length > AI_DIFF_LIMIT;
  // `git log --format=%B%x1e`: one record per commit, subject and body.
  const recent = examples
    .split("\x1e")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => (m.length > AI_EXAMPLE_LIMIT ? m.slice(0, AI_EXAMPLE_LIMIT) + "…" : m));
  return [
    "Write a git commit message for the staged changes below.",
    "Rules:",
    "- Reply with the commit message only: no quotes, no code fence, no explanation.",
    "- First a subject line of at most 72 characters, imperative mood, no trailing period.",
    recent.length
      ? "- Follow the form of these recent commits from this repository exactly: the same kind of prefix (the same type words, untranslated, and a scope in parentheses when they have one), a summary in their language, tone and grammatical form, and a body after one blank line only when they write bodies, in the same shape:\n" +
        recent.map((m) => m.split("\n").map((l) => `  ${l}`).join("\n")).join("\n  ---\n")
      : "- Use the Conventional Commits form, type(scope): summary, in English, with a short body after one blank line only when the change needs explaining.",
    "- Say what the change does and why, not which files changed. Wrap body lines at 72 characters.",
    branch ? `Branch: ${branch}` : null,
    "Changed files:",
    stat.trim() || "(none)",
    cut ? `Staged diff (first ${AI_DIFF_LIMIT} characters):` : "Staged diff:",
    diff.slice(0, AI_DIFF_LIMIT),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// The model's answer as a commit message: code fences and a "Subject:" label dropped, quotes
// around the subject removed, runs of blank lines folded to one.
export function aiMessage(text) {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !l.trim().startsWith("```"));
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length)
    lines[0] = lines[0]
      .trim()
      .replace(/^(subject|commit message)\s*:\s*/i, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
