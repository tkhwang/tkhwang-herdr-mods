// syntax colors: code drawn line by line in a mod's own rows (the Changes diff tab, the file tab's
// Diff) in the colors Herdr's editor gives it, and which language that editor is told a file is in.
// Herdr's editor colors a whole buffer (its syntax.rs, Sublime's syntaxes); a diff is rows of plain
// text, so this cuts each row into [kind, text] runs itself. A language is a table (comments,
// strings, words) for one shared lexer, or a lexer of its own for the ones that aren't code
// (YAML, CSS, HTML and XML, Markdown). What is still open at a line's end (a block comment, a
// string over several lines, a template's ${…}, a heredoc, a fenced block) carries into the next.
// No herdr calls, so it can be checked with plain node. The same file lives in better-changes and
// tkhwang-markdown: keep the copies the same.

// ── Colors ───────────────────────────────────────────────────────────────────

// The colors each kind of run takes, from the theme: the editor's (editorSyntax) for the kinds it
// has, so a file reads the same in View, Edit and Diff. A run with no kind takes the row's color.
export function syntaxColors(t) {
  return {
    keyword: t.ansi5,
    string: t.ansi2,
    comment: t.dim,
    function: t.ansi4,
    type: t.ansi3,
    number: t.ansi1,
    constant: t.ansi6,
    variable: t.ansi6,
    property: t.ansi4,
    tag: t.ansi4,
    attr: t.ansi3,
    heading: t.ansi5,
  };
}

// EditorState's `syntax` option: the same colors, for Herdr's editor.
export function editorSyntax(t) {
  return { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 };
}

// ── Languages ────────────────────────────────────────────────────────────────

const EXT = {
  js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
  json: "json", jsonc: "json", json5: "json", jsonl: "json", geojson: "json", webmanifest: "json",
  py: "python", pyi: "python", pyw: "python", rb: "ruby", rake: "ruby", gemspec: "ruby", ru: "ruby",
  rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala",
  groovy: "groovy", gradle: "groovy", swift: "swift", dart: "dart",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  m: "objc", mm: "objc", cs: "csharp", php: "php", lua: "lua", pl: "perl", pm: "perl", r: "r",
  ex: "elixir", exs: "elixir", sql: "sql", psql: "sql", graphql: "graphql", gql: "graphql", proto: "proto",
  tf: "hcl", tfvars: "hcl", hcl: "hcl", ps1: "powershell", psm1: "powershell", psd1: "powershell",
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", fish: "shell", command: "shell",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini",
  css: "css", scss: "scss", sass: "scss", less: "less",
  html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html", astro: "html",
  xml: "xml", svg: "xml", plist: "xml", xsd: "xml", xsl: "xml", xslt: "xml", csproj: "xml", fsproj: "xml",
  props: "xml", targets: "xml", resx: "xml", storyboard: "xml", xib: "xml",
  md: "markdown", markdown: "markdown", mdx: "markdown", mk: "make", mak: "make", dockerfile: "docker",
};

const NAME = {
  makefile: "make", gnumakefile: "make", dockerfile: "docker", containerfile: "docker",
  gemfile: "ruby", rakefile: "ruby", podfile: "ruby", vagrantfile: "ruby", brewfile: "ruby", fastfile: "ruby",
  ".bashrc": "shell", ".bash_profile": "shell", ".bash_aliases": "shell", ".profile": "shell", ".zshrc": "shell",
  ".zprofile": "shell", ".zshenv": "shell", ".zlogin": "shell", ".envrc": "shell", pkgbuild: "shell",
  ".gitconfig": "ini", ".editorconfig": "ini", ".npmrc": "ini", ".gitmodules": "ini", "pipfile": "toml",
  ".gitignore": "ignore", ".dockerignore": "ignore", ".npmignore": "ignore", ".prettierignore": "ignore",
  ".eslintignore": "ignore", ".gitattributes": "ignore",
};

// The language a file is in for this lexer, from its name, or null for one it doesn't know.
export function languageOf(path) {
  const name = String(path ?? "").split(/[\\/]/).pop().toLowerCase();
  if (NAME[name]) return NAME[name];
  if (/^\.env(\.|$)/.test(name)) return "ini";
  if (/^(docker|container)file[.-]/.test(name)) return "docker";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (EXT[name.slice(dot + 1)] ?? null) : null;
}

// What Herdr's editor is told a file is (EditorState's `language`), which it matches against the
// file extensions of its syntaxes. Languages it has no syntax for get the nearest one it has
// (TypeScript JavaScript's, TOML YAML's); anything else is passed as the file's own extension.
const EDITOR = {
  js: "js", jsx: "js", ts: "js", tsx: "js", json: "json", python: "py", ruby: "rb", rust: "rs", go: "go",
  java: "java", kotlin: "scala", scala: "scala", groovy: "groovy", swift: "rs", dart: "java",
  c: "c", cpp: "cpp", objc: "m", csharp: "cs", php: "php", lua: "lua", perl: "pl", r: "r", elixir: "rb",
  sql: "sql", shell: "sh", docker: "sh", make: "make", ignore: "sh", powershell: "sh", hcl: "sh",
  yaml: "yaml", toml: "yaml", ini: "properties", css: "css", scss: "css", less: "css",
  html: "html", xml: "xml", markdown: "markdown", graphql: "py", proto: "java",
};

export function editorLanguage(path) {
  const lang = languageOf(path);
  if (lang && EDITOR[lang]) return EDITOR[lang];
  const name = String(path ?? "").split(/[\\/]/).pop().toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "txt";
}

// ── Runs ─────────────────────────────────────────────────────────────────────

// A line longer than this is colored only up to here; a line in more runs than MAX_RUNS ends in
// one plain run. Minified code would otherwise put thousands of elements on one row.
const MAX_LEX = 2000;
const MAX_RUNS = 240;

// Adds a run, joined to the one before when it is the same kind; spaces join whatever is before
// them (they show no color), so a row is a few runs, not one per token.
function push(out, kind, text) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && (last[0] === kind || (!kind && /^\s+$/.test(text)))) last[1] += text;
  else out.push([kind, text]);
}

// `end`: where the lexer stopped (a token begun before MAX_LEX can end past it); the rest is plain.
function finish(out, line, end, stack) {
  if (end < line.length) push(out, "", line.slice(end));
  if (out.length > MAX_RUNS) out.splice(MAX_RUNS - 1, out.length, ["", out.slice(MAX_RUNS - 1).map((r) => r[1]).join("")]);
  return { spans: out, state: stack.length ? stack : null };
}

const isWord = (c) => Boolean(c) && /[\p{L}\p{N}_$]/u.test(c);
const copy = (state) => (state ? state.map((f) => ({ ...f })) : []);
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

function nextChar(line, j) {
  while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
  return line[j] ?? "";
}

// The rest of a block comment (or a block string), from `i`; nested ones count when `nest`.
function scanBlock(line, i, n, top, stack, out) {
  let j = i;
  for (;;) {
    const close = line.indexOf(top.close, j);
    const open = top.nest ? line.indexOf(top.open, j) : -1;
    if (open !== -1 && open < n && (close === -1 || open < close)) {
      top.depth++;
      j = open + top.open.length;
      continue;
    }
    if (close === -1 || close >= n) {
      push(out, top.kind, line.slice(i, n));
      return n;
    }
    j = close + top.close.length;
    if (--top.depth === 0) {
      push(out, top.kind, line.slice(i, j));
      stack.pop();
      return j;
    }
  }
}

// The rest of a string, from `i`: escapes, a `${` that opens code inside it (`interp`), and runs
// colored as variables inside it (`inner`, such as $name in a shell string).
function scanString(line, i, n, top, stack, out) {
  let start = i;
  let j = i;
  while (j < n) {
    if (top.esc && line[j] === "\\") {
      j += 2;
      continue;
    }
    if (line.startsWith(top.close, j)) {
      j += top.close.length;
      push(out, "string", line.slice(start, j));
      stack.pop();
      return j;
    }
    if (top.interp && line.startsWith(top.interp, j)) {
      push(out, "string", line.slice(start, j));
      push(out, "keyword", top.interp);
      stack.push({ t: "code", open: top.iopen, close: top.iclose, depth: 0 });
      return j + top.interp.length;
    }
    if (top.inner) {
      top.inner.lastIndex = j;
      const m = top.inner.exec(line);
      if (m && m[0]) {
        push(out, "string", line.slice(start, j));
        push(out, "variable", m[0]);
        j += m[0].length;
        start = j;
        continue;
      }
    }
    j++;
  }
  // An escape or a run inside the string can end past n: the string goes as far as it went.
  const end = Math.max(j, n);
  push(out, "string", line.slice(start, end));
  if (!top.multi) stack.pop();
  return end;
}

// ── The code lexer ───────────────────────────────────────────────────────────

const WORD = /[\p{L}_][\p{L}\p{N}_]*/uy;
const JS_WORD = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[\p{L}\p{N}_]*/uy;

// A string table: { open, close (= open), esc (true), multi, interp, iopen, iclose, inner }.
function stringsAt(specs) {
  return (line, i) => {
    for (const s of specs) {
      if (!line.startsWith(s.open, i)) continue;
      return {
        len: s.open.length,
        frame: { t: "str", close: s.close ?? s.open, esc: s.esc !== false, multi: Boolean(s.multi), interp: s.interp ?? null, iopen: s.iopen, iclose: s.iclose, inner: s.inner ?? null },
      };
    }
    return null;
  };
}

// A language rule: a sticky regex at `i`, when `when(ctx)` allows, as one run of `kind`.
function rule(re, kind, when) {
  return (line, i, ctx) => {
    if (when && !when(ctx, line, i)) return null;
    re.lastIndex = i;
    const m = re.exec(line);
    return m && m[0] ? [[kind, m[0]]] : null;
  };
}

const atStart = (ctx) => !ctx.prev;

// cfg: line (comment starters), lineAtWord (a line comment only at a word's start, as # in a
// shell), block ([open, close, nest] or { re, close(m) }), strings (a table, or a function
// (line, i) => { len, frame }), extra (rules tried before strings, words and numbers), keywords,
// constants, types, builtins (Sets), ci (case-blind words), word (the identifier regex), fnDef and
// typeDef (keywords naming the function or type after them), call (false: a word before "(" isn't
// a call), caps (false: no FooBar types and FOO_BAR constants), numbers (false: none), objectKeys
// (a keyword as an object key is plain: { default: 1 }).
function codeLexer(cfg) {
  const ci = Boolean(cfg.ci);
  const key = (w) => (ci ? w.toLowerCase() : w);
  const has = (set, w) => Boolean(set && set.has(key(w)));
  const word = cfg.word ?? WORD;
  const blocks = (cfg.block ?? []).map((b) => (Array.isArray(b) ? { open: b[0], close: b[1], nest: Boolean(b[2]) } : b));
  const stringAt = typeof cfg.strings === "function" ? cfg.strings : stringsAt(cfg.strings ?? []);

  function classify(w, line, start, end, prev) {
    const before = line[start - 1] ?? "";
    const member = (before === "." && line[start - 2] !== ".") || (before === ">" && line[start - 2] === "-");
    if (prev?.kind === "keyword" && cfg.fnDef?.has(prev.text)) return "function";
    if (prev?.kind === "keyword" && cfg.typeDef?.has(prev.text)) return "type";
    const after = nextChar(line, end);
    if (!member) {
      // A key named like a keyword ({ type: …, delete: … }, a property line in an interface) is a
      // key; `default:` and `case x:` stay keywords.
      if (has(cfg.keywords, w))
        return cfg.objectKeys && after === ":" && w !== "default" && w !== "case" && (!prev || prev.text === "{" || prev.text === ",") ? "" : "keyword";
      if (has(cfg.constants, w)) return "constant";
      if (has(cfg.types, w)) return "type";
    }
    if (cfg.call !== false && after === "(") return "function";
    if (!member && has(cfg.builtins, w)) return "function";
    if (cfg.caps !== false) {
      if (/^[A-Z][A-Z0-9_]+$/.test(w)) return "constant";
      if (/^[A-Z]/.test(w) && /[a-z]/.test(w)) return "type";
    }
    return "";
  }

  function lex(line, state) {
    const out = [];
    const stack = copy(state);
    const n = Math.min(line.length, MAX_LEX);
    const ctx = { prev: null, stack, heredoc: null };
    let i = 0;
    const token = (kind, text) => {
      push(out, kind, text);
      ctx.prev = { kind, text };
    };
    while (i < n) {
      const top = stack[stack.length - 1];
      if (top?.t === "block") {
        i = scanBlock(line, i, n, top, stack, out);
        continue;
      }
      if (top?.t === "str") {
        i = scanString(line, i, n, top, stack, out);
        ctx.prev = { kind: "string", text: '"' };
        continue;
      }
      if (top?.t === "heredoc") {
        const body = top.strip ? line.replace(/^[ \t]+/, "") : line;
        const end = body.replace(/\r$/, "") === top.tag;
        push(out, end ? "keyword" : "string", line.slice(0, n));
        if (end) stack.pop();
        i = n;
        continue;
      }
      const c = line[i];
      if (c === " " || c === "\t" || c === "\r") {
        let j = i + 1;
        while (j < n && (line[j] === " " || line[j] === "\t" || line[j] === "\r")) j++;
        push(out, "", line.slice(i, j));
        i = j;
        continue;
      }
      // Inside a template's ${…}: its own braces count, and the one that closes it goes back to
      // the string.
      if (top?.t === "code") {
        if (c === top.open) top.depth++;
        else if (c === top.close) {
          if (top.depth === 0) {
            token("keyword", c);
            stack.pop();
            i++;
            continue;
          }
          top.depth--;
        }
      }
      let hit = false;
      for (const b of blocks) {
        if (b.re) {
          b.re.lastIndex = i;
          const m = b.re.exec(line);
          if (!m) continue;
          push(out, "comment", m[0]);
          stack.push({ t: "block", close: b.close(m), nest: false, depth: 1, kind: "comment" });
          i += m[0].length;
        } else if (line.startsWith(b.open, i)) {
          push(out, "comment", b.open);
          stack.push({ t: "block", open: b.open, close: b.close, nest: b.nest, depth: 1, kind: "comment" });
          i += b.open.length;
        } else continue;
        hit = true;
        break;
      }
      if (hit) continue;
      if (cfg.line && cfg.line.some((p) => line.startsWith(p, i)) && (!cfg.lineAtWord || i === 0 || /[\s;|&(]/.test(line[i - 1]))) {
        push(out, "comment", line.slice(i, n));
        i = n;
        break;
      }
      let runs = null;
      for (const f of cfg.extra ?? []) if ((runs = f(line, i, ctx))) break;
      if (runs) {
        for (const [kind, text] of runs) token(kind, text);
        i += runs.reduce((sum, r) => sum + r[1].length, 0);
        continue;
      }
      const s = stringAt(line, i);
      if (s) {
        push(out, "string", line.slice(i, i + s.len));
        stack.push(s.frame);
        i += s.len;
        continue;
      }
      if (cfg.numbers !== false && (/\d/.test(c) || (c === "." && /\d/.test(line[i + 1] ?? "") && !isWord(line[i - 1])))) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(line);
        if (m) {
          token("number", m[0]);
          i += m[0].length;
          continue;
        }
      }
      word.lastIndex = i;
      const m = word.exec(line);
      if (m) {
        token(classify(m[0], line, i, i + m[0].length, ctx.prev), m[0]);
        i += m[0].length;
        continue;
      }
      token("", c);
      i++;
    }
    if (ctx.heredoc) stack.push({ t: "heredoc", tag: ctx.heredoc.tag, strip: ctx.heredoc.strip });
    return finish(out, line, i, stack);
  }
  // A hunk that starts inside a /* … */ comment: the state of being in one.
  if (blocks.some((b) => b.open === "/*")) lex.comment = () => [{ t: "block", open: "/*", close: "*/", nest: false, depth: 1, kind: "comment" }];
  return lex;
}

// ── Code languages ───────────────────────────────────────────────────────────

const SLASH = { line: ["//"], block: [["/*", "*/"]] };
const QUOTES = [{ open: '"' }, { open: "'" }];
const DOLLAR_INNER = /\$\{[^}\n]*\}|\$[\p{L}_][\p{L}\p{N}_]*/uy;
const decorator = rule(/@[\p{L}_$][\p{L}\p{N}_$.]*/uy, "function");

// JavaScript: a / starts a regex where a value would start, never after one.
const REGEX = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/y;
const REGEX_AFTER = words("return typeof instanceof in of new delete void throw case do else yield await export default");
function valueStarts(prev) {
  if (!prev) return true;
  if (prev.kind === "keyword") return REGEX_AFTER.has(prev.text);
  if (prev.kind) return false;
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev.text);
}
// JSX: a tag where an expression starts (`return <div`, `= <Foo`), not after a value (`a < b`).
const JSX_TAG = /(<\/?)([\p{L}_$][\p{L}\p{N}_$.:-]*)/uy;
function jsxTag(line, i, ctx) {
  if (line[i] !== "<") return null;
  const prev = ctx.prev;
  if (prev && !(prev.kind === "keyword" ? /^(return|default|yield|await)$/.test(prev.text) : !prev.kind && /[(,=:?{[>&|]$/.test(prev.text))) return null;
  JSX_TAG.lastIndex = i;
  const m = JSX_TAG.exec(line);
  return m ? [["", m[1]], ["tag", m[2]]] : null;
}

const JS_KEYWORDS = "as async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield";
const JS = {
  ...SLASH,
  word: JS_WORD,
  strings: [{ open: "`", multi: true, interp: "${", iopen: "{", iclose: "}" }, ...QUOTES],
  keywords: words(JS_KEYWORDS),
  constants: words("true false null undefined NaN Infinity"),
  fnDef: words("function"),
  typeDef: words("class"),
  objectKeys: true,
  extra: [rule(REGEX, "string", (ctx) => valueStarts(ctx.prev)), decorator],
};
const JSX = { ...JS, extra: [jsxTag, ...JS.extra] };
const TS = {
  ...JS,
  keywords: words(`${JS_KEYWORDS} abstract accessor asserts declare enum implements infer interface is keyof module namespace override private protected public readonly satisfies type unique`),
  types: words("any bigint boolean never number object string symbol unknown"),
  typeDef: words("class interface enum type namespace module"),
};
const TSX = { ...TS, extra: [jsxTag, ...TS.extra] };

const JSON_CFG = {
  ...SLASH,
  strings: [{ open: '"' }],
  constants: words("true false null"),
  call: false,
  caps: false,
  extra: [rule(/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, "property")],
};

const PY_STRING = /([rRbBuUfF]{0,2})("""|'''|"|')/y;
const PY_FIELD = /\{[^{}\n]*\}/y;
const PYTHON = {
  line: ["#"],
  strings(line, i) {
    if (isWord(line[i - 1])) return null;
    PY_STRING.lastIndex = i;
    const m = PY_STRING.exec(line);
    if (!m) return null;
    const p = m[1].toLowerCase();
    if (p && !/^(r|u|b|f|br|rb|fr|rf)$/.test(p)) return null;
    return { len: m[0].length, frame: { t: "str", close: m[2], esc: !p.includes("r"), multi: m[2].length === 3, inner: p.includes("f") ? PY_FIELD : null } };
  },
  keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
  constants: words("True False None Ellipsis NotImplemented self cls"),
  types: words("int float str bool bytes list dict set tuple object type complex frozenset bytearray"),
  fnDef: words("def"),
  typeDef: words("class"),
  extra: [rule(/@[\p{L}_][\p{L}\p{N}_.]*/uy, "function", atStart)],
};

const RS_STRING = /(b?r)(#*)"|b?"/y;
const RUST = {
  ...SLASH,
  block: [["/*", "*/", true]],
  strings(line, i) {
    if (isWord(line[i - 1])) return null;
    RS_STRING.lastIndex = i;
    const m = RS_STRING.exec(line);
    if (!m) return null;
    return { len: m[0].length, frame: { t: "str", close: '"' + (m[2] ?? ""), esc: !m[1], multi: true } };
  },
  keywords: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop macro_rules match mod move mut pub ref return static struct super trait type union unsafe use where while yield"),
  constants: words("true false self None Some Ok Err"),
  types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str"),
  fnDef: words("fn"),
  typeDef: words("struct enum trait type union"),
  extra: [
    rule(/'(?:\\(?:x[\da-fA-F]{2}|u\{[\da-fA-F]{1,6}\}|.)|[^\\'\n])'/y, "string"),
    rule(/'[\p{L}_][\p{L}\p{N}_]*(?!')/uy, "keyword"),
    rule(/[\p{L}_][\p{L}\p{N}_]*!(?=\s*[([{])/uy, "function"),
    rule(/#!?\[/y, "keyword"),
  ],
};

const GO = {
  ...SLASH,
  strings: [{ open: "`", esc: false, multi: true }, ...QUOTES],
  keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
  constants: words("true false nil iota"),
  types: words("any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr"),
  fnDef: words("func"),
  typeDef: words("type"),
};

const JAVA = {
  ...SLASH,
  strings: [{ open: '"""', multi: true }, ...QUOTES],
  keywords: words("abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new non-sealed package permits private protected public record return sealed static strictfp super switch synchronized this throw throws transient try var void volatile while yield"),
  constants: words("true false null"),
  types: words("boolean byte char double float int long short"),
  typeDef: words("class interface enum record"),
  extra: [decorator],
};

const KOTLIN = {
  ...SLASH,
  block: [["/*", "*/", true]],
  strings: [{ open: '"""', esc: false, multi: true, inner: DOLLAR_INNER }, { open: '"', inner: DOLLAR_INNER }, { open: "'" }],
  keywords: words("abstract actual annotation as break by catch class companion const constructor continue crossinline data do else enum expect external final finally for fun if import in infix init inline inner interface internal is lateinit noinline object open operator out override package private protected public reified return sealed super suspend tailrec this throw try typealias typeof val var vararg when where while"),
  constants: words("true false null"),
  fnDef: words("fun"),
  typeDef: words("class interface object typealias"),
  extra: [decorator],
};

const SCALA = {
  ...SLASH,
  block: [["/*", "*/", true]],
  strings: [{ open: '"""', esc: false, multi: true, inner: DOLLAR_INNER }, { open: '"', inner: DOLLAR_INNER }, { open: "'" }],
  keywords: words("abstract case catch class def do else enum export extends final finally for forSome given if implicit import lazy match new object override package private protected return sealed super then this throw trait try type using val var while with yield"),
  constants: words("true false null"),
  fnDef: words("def"),
  typeDef: words("class object trait type enum"),
  extra: [decorator],
};

const GROOVY = {
  ...SLASH,
  strings: [{ open: "'''", multi: true }, { open: '"""', multi: true, inner: DOLLAR_INNER }, { open: '"', inner: DOLLAR_INNER }, { open: "'" }],
  keywords: words("as assert break case catch class const continue def default do else enum extends final finally for goto if implements import in instanceof interface new package private protected public return static super switch synchronized this throw throws trait transient try var void volatile while"),
  constants: words("true false null"),
  typeDef: words("class interface trait enum"),
  extra: [decorator],
};

const SWIFT = {
  ...SLASH,
  block: [["/*", "*/", true]],
  strings: [{ open: '"""', multi: true, inner: /\\\([^)\n]*\)/y }, { open: '"', inner: /\\\([^)\n]*\)/y }],
  keywords: words("actor any as associatedtype async await break case catch class continue convenience default defer deinit do dynamic else enum extension fallthrough fileprivate final for func guard if import in indirect init inout internal is isolated lazy let mutating nonisolated nonmutating open operator optional override precedencegroup private protocol public repeat required rethrows return some static struct subscript super switch throw throws try typealias unowned var weak where while"),
  constants: words("true false nil self"),
  fnDef: words("func"),
  typeDef: words("class struct enum protocol extension actor typealias"),
  extra: [rule(/#[a-zA-Z]+/y, "keyword"), decorator],
};

const DART = {
  ...SLASH,
  strings: [{ open: "'''", multi: true, inner: DOLLAR_INNER }, { open: '"""', multi: true, inner: DOLLAR_INNER }, { open: "r'", esc: false, close: "'" }, { open: 'r"', esc: false, close: '"' }, { open: '"', inner: DOLLAR_INNER }, { open: "'", inner: DOLLAR_INNER }],
  keywords: words("abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for Function if implements import in interface is late library mixin new operator part required rethrow return sealed static super switch sync this throw try typedef var void when while with yield"),
  constants: words("true false null"),
  typeDef: words("class mixin extension enum typedef"),
  extra: [decorator],
};

// C and its family: a # directive at a line's start, and the <header> an #include names.
const directive = rule(/#[ \t]*[a-zA-Z_]+/y, "keyword", atStart);
const header = rule(/<[^>\n]*>/y, "string", (ctx) => ctx.prev?.kind === "keyword" && /^#[ \t]*(include|import)$/.test(ctx.prev.text));
const C_KEYWORDS = "auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local";
const C_TYPES = "char double float int long short signed unsigned void bool _Bool size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE";
const C = {
  ...SLASH,
  strings: QUOTES,
  keywords: words(C_KEYWORDS),
  constants: words("true false NULL nullptr"),
  types: words(C_TYPES),
  typeDef: words("struct enum union"),
  extra: [directive, header],
};
const CPP = {
  ...C,
  keywords: words(`${C_KEYWORDS} alignas alignof and and_eq asm bitand bitor catch class compl concept const_cast consteval constexpr constinit co_await co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept not not_eq operator or or_eq override private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw try typeid typename using virtual xor xor_eq`),
  types: words(`${C_TYPES} wchar_t char8_t char16_t char32_t string`),
  typeDef: words("class struct enum union namespace"),
};
const OBJC = {
  ...C,
  strings: [{ open: '@"', close: '"' }, ...QUOTES],
  constants: words("true false NULL nil Nil YES NO self super"),
  extra: [directive, header, rule(/@[a-zA-Z]+/y, "keyword")],
};

const CS_STRING = /(\$@|@\$|@|\$+)?("""|")/y;
const CSHARP = {
  ...SLASH,
  strings(line, i) {
    if (line[i] === "'") return { len: 1, frame: { t: "str", close: "'", esc: true, multi: false } };
    if (isWord(line[i - 1])) return null;
    CS_STRING.lastIndex = i;
    const m = CS_STRING.exec(line);
    if (!m) return null;
    const p = m[1] ?? "";
    return { len: m[0].length, frame: { t: "str", close: m[2], esc: !p.includes("@") && m[2] === '"', multi: p.includes("@") || m[2] === '"""', inner: p.includes("$") ? PY_FIELD : null } };
  },
  keywords: words("abstract as async await base break case catch checked class const continue default delegate do dynamic else enum event explicit extern file finally fixed for foreach get global goto if implicit in init interface internal is lock namespace nameof new operator out override params partial private protected public readonly record ref required return scoped sealed set sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using var virtual volatile when where while yield"),
  constants: words("true false null"),
  types: words("bool byte char decimal double float int long nint nuint object sbyte short string uint ulong ushort void"),
  typeDef: words("class struct interface enum record namespace"),
  extra: [directive],
};

const PHP_INNER = /\$[\p{L}_][\p{L}\p{N}_]*(?:->[\p{L}_][\p{L}\p{N}_]*)?|\{\$[^}\n]*\}/uy;
const PHP = {
  line: ["//", "#"],
  block: [["/*", "*/"]],
  strings: [{ open: '"', inner: PHP_INNER }, { open: "'" }, { open: "`" }],
  keywords: words("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield"),
  constants: words("true false null TRUE FALSE NULL"),
  fnDef: words("function"),
  typeDef: words("class interface trait enum"),
  extra: [rule(/<\?(?:php|=)?|\?>/y, "keyword"), rule(/\$[\p{L}_][\p{L}\p{N}_]*/uy, "variable"), decorator],
};

const RUBY_INNER = /#\{[^}\n]*\}/y;
const RUBY = {
  line: ["#"],
  word: /[\p{L}_][\p{L}\p{N}_]*[?!]?/uy,
  strings: [{ open: '"', inner: RUBY_INNER }, { open: "'" }, { open: "`", inner: RUBY_INNER }],
  keywords: words("BEGIN END alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return super then undef unless until when while yield"),
  constants: words("true false nil self __FILE__ __LINE__ __method__"),
  builtins: words("require require_relative include extend prepend attr_reader attr_writer attr_accessor private protected public module_function raise puts lambda proc loop"),
  fnDef: words("def"),
  typeDef: words("class module"),
  extra: [
    (line, i, ctx) => {
      if (i !== 0 || !line.startsWith("=begin")) return null;
      ctx.stack.push({ t: "block", close: "=end", nest: false, depth: 1, kind: "comment" });
      return [["comment", "=begin"]];
    },
    (line, i, ctx) => {
      const m = /<<([~-]?)(['"]?)([A-Za-z_]\w*)\2/y;
      m.lastIndex = i;
      const r = m.exec(line);
      if (!r) return null;
      ctx.heredoc = { tag: r[3], strip: Boolean(r[1]) };
      return [["keyword", r[0]]];
    },
    rule(/:(?!:)[\p{L}_][\p{L}\p{N}_]*[?!=]?/uy, "constant", (ctx, line, i) => !isWord(line[i - 1]) && line[i - 1] !== ":"),
    rule(/[\p{L}_][\p{L}\p{N}_]*:(?=\s)/uy, "constant", (ctx, line, i) => line[i - 1] !== ":"),
    rule(/@@?[\p{L}_][\p{L}\p{N}_]*|\$[\p{L}_][\p{L}\p{N}_]*/uy, "variable"),
  ],
};

const ELIXIR = {
  line: ["#"],
  word: /[\p{L}_][\p{L}\p{N}_]*[?!]?/uy,
  strings: [{ open: '"""', multi: true, inner: RUBY_INNER }, { open: '"', inner: RUBY_INNER }, { open: "'" }],
  keywords: words("after alias and case catch cond def defdelegate defexception defguard defimpl defmacro defmacrop defmodule defp defprotocol defstruct do else end fn for if import in not or quote raise receive require rescue try unless unquote use when with"),
  constants: words("true false nil"),
  fnDef: words("def defp defmacro defmacrop defguard"),
  typeDef: words("defmodule defprotocol defimpl"),
  extra: [
    rule(/:(?!:)[\p{L}_][\p{L}\p{N}_]*[?!]?/uy, "constant", (ctx, line, i) => !isWord(line[i - 1]) && line[i - 1] !== ":"),
    rule(/[\p{L}_][\p{L}\p{N}_]*:(?=\s)/uy, "constant", (ctx, line, i) => line[i - 1] !== ":"),
    rule(/@[\p{L}_][\p{L}\p{N}_]*/uy, "variable"),
  ],
};

const LUA = {
  line: ["--"],
  block: [{ re: /--\[(=*)\[/y, close: (m) => `]${m[1]}]` }],
  strings(line, i) {
    const m = /\[(=*)\[/y;
    m.lastIndex = i;
    const r = m.exec(line);
    if (r) return { len: r[0].length, frame: { t: "block", close: `]${r[1]}]`, nest: false, depth: 1, kind: "string" } };
    return line[i] === '"' || line[i] === "'" ? { len: 1, frame: { t: "str", close: line[i], esc: true, multi: false } } : null;
  },
  keywords: words("and break do else elseif end for function goto if in local not or repeat return then until while"),
  constants: words("true false nil self"),
  fnDef: words("function"),
};

const PERL = {
  line: ["#"],
  strings: [{ open: '"', inner: /[$@][\p{L}_][\p{L}\p{N}_:]*/uy }, { open: "'" }, { open: "`" }],
  keywords: words("my our local sub if elsif else unless while until for foreach do last next redo return use no require package BEGIN END and or not eq ne lt gt le ge cmp undef defined wantarray"),
  builtins: words("print printf say die warn open close push pop shift unshift split join keys values each map grep sort reverse length substr sprintf chomp exists delete scalar ref bless"),
  fnDef: words("sub"),
  typeDef: words("package"),
  caps: false,
  extra: [
    (line, i, ctx) => {
      if (i !== 0 || !/^=[a-zA-Z]/.test(line)) return null;
      ctx.stack.push({ t: "block", close: "=cut", nest: false, depth: 1, kind: "comment" });
      return [["comment", line]];
    },
    rule(/[$@%](?:\{\w+\}|[\p{L}_][\p{L}\p{N}_:]*|[_0-9!@&*])/uy, "variable", (ctx, line, i) => line[i] !== "%" || isWord(line[i + 1])),
  ],
};

const R = {
  line: ["#"],
  strings: [{ open: '"' }, { open: "'" }, { open: "`" }],
  keywords: words("function if else repeat while for in next break return"),
  constants: words("TRUE FALSE NULL NA NaN Inf NA_integer_ NA_real_ NA_character_"),
  caps: false,
};

const SQL = {
  line: ["--"],
  block: [["/*", "*/"]],
  strings: [{ open: "'", esc: false }, { open: '"', esc: false }, { open: "`", esc: false }],
  ci: true,
  caps: false,
  keywords: words("add all alter and as asc begin between by cascade case check column commit constraint create cross database declare default delete desc distinct do drop else end exists execute fetch for foreign from full function grant group having if ilike in index inner insert intersect into is join key language lateral left like limit materialized natural next not of offset on only or order outer over partition primary procedure recursive references rename replace restrict return returning returns revoke right rollback rows schema select set table temp temporary then to top transaction trigger union unique update using values view when where window with"),
  constants: words("true false null"),
  types: words("bigint bigserial blob bool boolean bytea char character clob date decimal double float int integer interval json jsonb numeric precision real serial smallint smallserial text time timestamp timestamptz tinyint uuid varchar varying"),
  extra: [rule(/@[\p{L}_][\p{L}\p{N}_]*|:[\p{L}_][\p{L}\p{N}_]*|\$\d+/uy, "variable", (ctx, line, i) => line[i - 1] !== ":")],
};

// Shells: $name, ${…} and $( as variables, NAME= before a command, and heredocs.
const SH_VAR = /\$(?:\{[^}\n]*\}|\(\(?|[\p{L}_][\p{L}\p{N}_]*|[0-9@#?$!*-])/uy;
const ASSIGN_AFTER = words("export local readonly declare typeset ; && || | ( { then do else");
function heredocStart(line, i, ctx) {
  const m = /(?<!<)<<(?!<)(-?)[ \t]*(['"]?)([A-Za-z_][\w-]*)\2/y;
  m.lastIndex = i;
  const r = m.exec(line);
  if (!r) return null;
  ctx.heredoc = { tag: r[3], strip: Boolean(r[1]) };
  return [["keyword", r[0]]];
}
const SHELL = {
  line: ["#"],
  lineAtWord: true,
  word: /[\p{L}_][\p{L}\p{N}_-]*/uy,
  // "…$(command "with quotes")…": the command inside is code, whose quotes don't end the string.
  strings: [{ open: '"', multi: true, interp: "$(", iopen: "(", iclose: ")", inner: /\$(?:\{[^}\n]*\}|[\p{L}_][\p{L}\p{N}_]*|[0-9@#?$!*-])|`[^`\n]*`/uy }, { open: "'", esc: false, multi: true }],
  keywords: words("if then else elif fi for in do done case esac while until function select time return local export readonly declare typeset unset shift exit break continue source alias unalias set eval exec trap wait coproc"),
  builtins: words("echo printf cd pwd read test type command builtin let getopts hash umask ulimit jobs fg bg kill disown pushd popd dirs mapfile readarray shopt complete compgen"),
  constants: words("true false"),
  caps: false,
  extra: [
    heredocStart,
    rule(SH_VAR, "variable"),
    rule(/[\p{L}_][\p{L}\p{N}_]*(?=\+?=)/uy, "variable", (ctx) => !ctx.prev || ctx.prev.kind === "keyword" || ASSIGN_AFTER.has(ctx.prev.text)),
  ],
};

const MAKE = {
  ...SHELL,
  keywords: words(`${[...SHELL.keywords].join(" ")} include sinclude ifeq ifneq ifdef ifndef endif define endef unexport override vpath`),
  extra: [
    rule(/\$(?:\([^)\n]*\)|\{[^}\n]*\}|[@<^+?*%|])/y, "variable"),
    rule(/[\p{L}_.][\p{L}\p{N}_.-]*(?=\s*(?:[:+?!]|::)?=)/uy, "variable", atStart),
    rule(/[^\s:#=][^:#=\n]*?(?=\s*::?(?!=))/y, "function", (ctx, line, i) => i === 0),
    ...SHELL.extra,
  ],
};

const DOCKER = {
  ...SHELL,
  keywords: words(`${[...SHELL.keywords].join(" ")} AS as`),
  extra: [rule(/(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/iy, "keyword", atStart), ...SHELL.extra],
};

const POWERSHELL = {
  line: ["#"],
  block: [["<#", "#>"]],
  strings: [{ open: '@"', close: '"@', esc: false, multi: true }, { open: "@'", close: "'@", esc: false, multi: true }, { open: '"', esc: false, inner: /\$(?:\{[^}\n]*\}|\([^)\n]*\)|[\p{L}_][\p{L}\p{N}_:]*)/uy }, { open: "'", esc: false }],
  ci: true,
  keywords: words("begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow"),
  caps: false,
  extra: [rule(/\$(?:\{[^}\n]*\}|[\p{L}_][\p{L}\p{N}_:]*)/uy, "variable"), rule(/[A-Z][a-z]+-[A-Z][\p{L}\p{N}]*/uy, "function"), rule(/-[a-z]+\b/y, "keyword", (ctx, line, i) => /\s/.test(line[i - 1] ?? ""))],
};

const HCL = {
  line: ["#", "//"],
  block: [["/*", "*/"]],
  strings: [{ open: '"', interp: "${", iopen: "{", iclose: "}" }],
  keywords: words("resource data variable output module provider locals terraform for in if else endif endfor dynamic content moved import check"),
  constants: words("true false null"),
  caps: false,
  extra: [heredocStart, rule(/[\p{L}_][\p{L}\p{N}_-]*(?=\s*=(?!=))/uy, "property")],
};

const PROTO = {
  ...SLASH,
  strings: QUOTES,
  keywords: words("syntax edition package import option message enum service rpc returns stream repeated optional required map oneof reserved extend extensions to max public weak"),
  types: words("double float int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 bool string bytes"),
  constants: words("true false"),
  typeDef: words("message enum service"),
};

const GRAPHQL = {
  line: ["#"],
  strings: [{ open: '"""', multi: true }, { open: '"' }],
  keywords: words("query mutation subscription fragment on type interface union enum input scalar schema extend implements directive repeatable"),
  constants: words("true false null"),
  typeDef: words("type interface union enum input scalar fragment"),
  extra: [rule(/\$[\p{L}_][\p{L}\p{N}_]*/uy, "variable"), rule(/@[\p{L}_][\p{L}\p{N}_]*/uy, "function")],
};

// TOML and INI: [tables] as types and the keys before "=" as properties.
const TOML = {
  line: ["#"],
  strings: [{ open: '"""', multi: true }, { open: "'''", esc: false, multi: true }, { open: '"' }, { open: "'", esc: false }],
  constants: words("true false inf nan"),
  call: false,
  caps: false,
  extra: [
    rule(/\[\[?[^\]\n]*\]\]?/y, "type", atStart),
    rule(/\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/y, "number"),
    rule(/(?:[\w-]+|"(?:[^"\\\n]|\\.)*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[\w-]+|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'))*(?=[ \t]*=)/y, "property", (ctx) => !ctx.prev || ctx.prev.text === "{" || ctx.prev.text === ","),
  ],
};
const INI = {
  line: [";", "#"],
  lineAtWord: true,
  strings: [{ open: '"' }, { open: "'", esc: false }],
  keywords: words("export"),
  constants: words("true false yes no on off"),
  call: false,
  caps: false,
  extra: [rule(/\[[^\]\n]*\]/y, "type", atStart), rule(/[\w.\-@$/]+(?=[ \t]*[=:])/y, "property", (ctx) => !ctx.prev || ctx.prev.text === "export")],
};

function lexIgnore(line, state) {
  const out = [];
  if (/^\s*#/.test(line)) push(out, "comment", line);
  else if (line.startsWith("!")) {
    push(out, "keyword", "!");
    push(out, "", line.slice(1));
  } else push(out, "", line);
  return finish(out, line, line.length, copy(state));
}

// ── YAML ─────────────────────────────────────────────────────────────────────

// A key before ": " (quoted, or plain up to the first colon followed by a space).
const Y_KEY = /(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[^\s#'"{}[\],&*!|>%@`-][^\n#]*?|-[^\s#][^\n#]*?)(?=[ \t]*:(?:[ \t]|$))/y;
const Y_SCALAR = /[^\s,[\]{}#](?:[^\n,[\]{}#]|#(?<=\S#))*?(?=[ \t]*(?:[,\]}]|[ \t]#|$))/y;
const Y_NUMBER = /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|0x[\da-fA-F]+|0o[0-7]+|\.inf|\.nan)$/i;
const Y_CONSTANT = words("true false null yes no on off True False Null TRUE FALSE NULL Yes No ~");

function lexYaml(line, state) {
  const out = [];
  const stack = copy(state);
  const n = Math.min(line.length, MAX_LEX);
  let i = 0;
  // A block scalar (key: |) holds every line more indented than its key, and blank ones.
  const block = stack[stack.length - 1];
  if (block?.t === "yblock") {
    if (!line.trim() || /^[ \t]*/.exec(line)[0].length > block.indent) {
      push(out, "string", line.slice(0, n));
      return finish(out, line, n, stack);
    }
    stack.pop();
  }
  let indent = /^[ \t]*/.exec(line)[0].length;
  const at = (re) => {
    re.lastIndex = i;
    return re.exec(line)?.[0] ?? null;
  };
  let m;
  if (stack[stack.length - 1]?.t !== "str") {
    if (/^(---|\.\.\.)(?=\s|$)/.test(line)) {
      push(out, "keyword", line.slice(0, 3));
      i = 3;
    } else if (line.startsWith("%")) {
      push(out, "keyword", line.slice(0, n));
      return finish(out, line, n, stack);
    }
    const lead = /^[ \t]*(?:-(?=[ \t]|$)[ \t]*)*/.exec(line.slice(i))[0];
    push(out, "", lead);
    i += lead.length;
    Y_KEY.lastIndex = i;
    const key = i < n ? Y_KEY.exec(line) : null;
    if (key) {
      indent = i;
      push(out, "property", key[0]);
      i += key[0].length;
    }
  }
  while (i < n) {
    const top = stack[stack.length - 1];
    if (top?.t === "str") {
      i = scanString(line, i, n, top, stack, out);
      continue;
    }
    const c = line[i];
    if (c === " " || c === "\t") {
      push(out, "", c);
      i++;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      push(out, "comment", line.slice(i, n));
      i = n;
    } else if (c === '"' || c === "'") {
      push(out, "string", c);
      stack.push({ t: "str", close: c, esc: c === '"', multi: true });
      i++;
    } else if ((c === "&" || c === "*") && (m = at(/[&*][^\s,[\]{}]+/y))) {
      push(out, "variable", m);
      i += m.length;
    } else if (c === "!") {
      m = at(/![^\s,[\]{}]*/y);
      push(out, "keyword", m);
      i += m.length;
    } else if ((c === "|" || c === ">") && /^[|>][-+0-9]*[ \t]*(#.*)?$/.test(line.slice(i))) {
      m = at(/[|>][-+0-9]*/y);
      push(out, "keyword", m);
      stack.push({ t: "yblock", indent });
      i += m.length;
    } else if ("[]{},:?-".includes(c)) {
      push(out, "", c);
      i++;
      // A key inside a flow mapping: {name: value}.
      if (c === "{" || c === ",") {
        const ws = /[ \t]*/y;
        ws.lastIndex = i;
        const gap = ws.exec(line)[0];
        const k = /[^\s,[\]{}:#"'][^,[\]{}:#\n]*?(?=[ \t]*:(?:[ \t]|$))/y;
        k.lastIndex = i + gap.length;
        const m = k.exec(line);
        if (m) {
          push(out, "", gap);
          push(out, "property", m[0]);
          i += gap.length + m[0].length;
        }
      }
    } else {
      Y_SCALAR.lastIndex = i;
      const m = Y_SCALAR.exec(line);
      const text = m ? m[0] : c;
      push(out, Y_NUMBER.test(text) ? "number" : Y_CONSTANT.has(text) ? "constant" : "", text);
      i += text.length;
    }
  }
  return finish(out, line, i, stack);
}

// ── CSS, SCSS, Less ──────────────────────────────────────────────────────────

// Selectors (tags, .classes, #ids, :pseudo) until "{"; inside a block (or the parentheses of
// @media), a property before ":" unless a "{" comes before the next ";" (then it is a nested
// selector such as &:hover), and its value after it: numbers with units, #colors, functions.
function selectorAhead(line, i, n) {
  const k = line.slice(i, n).search(/[{;}]/);
  return k !== -1 && line[i + k] === "{";
}

function cssLexer(scss) {
  return function lex(line, state) {
    const out = [];
    const stack = copy(state);
    if (stack[0]?.t !== "css") stack.unshift({ t: "css", depth: 0 });
    const base = stack[0];
    const n = Math.min(line.length, MAX_LEX);
    let value = false;
    let paren = 0;
    let i = 0;
    const at = (re) => {
      re.lastIndex = i;
      return re.exec(line)?.[0] ?? null;
    };
    while (i < n) {
      const top = stack[stack.length - 1];
      if (top.t === "block") {
        i = scanBlock(line, i, n, top, stack, out);
        continue;
      }
      if (top.t === "str") {
        i = scanString(line, i, n, top, stack, out);
        continue;
      }
      const c = line[i];
      let m;
      if (c === " " || c === "\t" || c === "\r") {
        push(out, "", c);
        i++;
      } else if (line.startsWith("/*", i)) {
        push(out, "comment", "/*");
        stack.push({ t: "block", open: "/*", close: "*/", nest: false, depth: 1, kind: "comment" });
        i += 2;
      } else if (scss && line.startsWith("//", i) && line[i - 1] !== ":") {
        push(out, "comment", line.slice(i, n));
        i = n;
      } else if (c === '"' || c === "'") {
        push(out, "string", c);
        stack.push({ t: "str", close: c, esc: true, multi: false });
        i++;
      } else if (c === "{" || c === "}" || c === ";") {
        if (c === "{") base.depth++;
        if (c === "}") base.depth = Math.max(0, base.depth - 1);
        value = false;
        push(out, "", c);
        i++;
      } else if ((m = at(/#\{[^}\n]*\}/y))) {
        push(out, "variable", m);
        i += m.length;
      } else if ((m = at(/@[\w-]+/y))) {
        push(out, "keyword", m);
        i += m.length;
      } else if ((m = at(scss ? /\$[\w-]+|--[\w-]+/y : /--[\w-]+/y))) {
        push(out, "variable", m);
        i += m.length;
        // $name: or --name: declares it; what follows is its value.
        const colon = at(/[ \t]*:(?!:)/y);
        if (colon && !value) {
          push(out, "", colon);
          i += colon.length;
          value = true;
        }
      } else if ((m = at(/![ \t]*important/iy))) {
        push(out, "keyword", m);
        i += m.length;
      } else if (c === "(" || c === ")") {
        paren = Math.max(0, paren + (c === "(" ? 1 : -1));
        push(out, "", c);
        i++;
      } else if (value) {
        if ((m = at(/#[\da-fA-F]{3,8}(?![\w-])/y)) || (!isWord(line[i - 1]) && (m = at(/[-+]?(?:\d*\.\d+|\d+)(?:%|[a-zA-Z]+)?/y)))) push(out, "number", m);
        else if ((m = at(/[\w-]+(?=\()/y))) push(out, "function", m);
        else push(out, "", (m = at(/[\w-]+/y) ?? c));
        i += m.length;
      } else if ((base.depth > 0 || paren > 0) && (m = at(/[\w-]+(?=[ \t]*:(?!:))/y)) && (paren > 0 || !selectorAhead(line, i, n))) {
        push(out, "property", m);
        i += m.length;
        const colon = at(/[ \t]*:/y);
        push(out, "", colon);
        i += colon.length;
        value = true;
      } else if ((m = at(/[.#][\w-]+/y))) {
        push(out, "type", m);
        i += m.length;
      } else if ((m = at(/::?[\w-]+/y))) {
        push(out, "keyword", m);
        i += m.length;
      } else if (c === "&") {
        push(out, "keyword", c);
        i++;
      } else if ((m = at(/[\w-]+/y))) {
        push(out, /^\d/.test(m) ? "number" : "tag", m);
        i += m.length;
      } else {
        push(out, "", c);
        i++;
      }
    }
    return finish(out, line, i, stack.length === 1 && base.depth === 0 ? [] : stack);
  };
}

// ── HTML and XML ─────────────────────────────────────────────────────────────

// Tags, their attributes and values, comments, entities; in HTML the code in <script> and the CSS
// in <style> (lang="ts", lang="scss" as a .vue or .svelte file says) in those lexers.
function markupLexer(xml) {
  return function lex(line, state) {
    const out = [];
    const stack = copy(state);
    const n = Math.min(line.length, MAX_LEX);
    let i = 0;
    while (i < n) {
      const top = stack[stack.length - 1];
      if (top?.t === "block") {
        i = scanBlock(line, i, n, top, stack, out);
        continue;
      }
      if (top?.t === "str") {
        i = scanString(line, i, n, top, stack, out);
        continue;
      }
      if (top?.t === "embed") {
        const end = line.toLowerCase().indexOf(top.close, i);
        const stop = end === -1 || end > n ? n : end;
        const inner = LEXERS[top.lang];
        if (inner) {
          const r = inner(line.slice(i, stop), top.inner);
          for (const [kind, text] of r.spans) push(out, kind, text);
          top.inner = r.state;
        } else push(out, "", line.slice(i, stop));
        i = stop;
        if (end !== -1 && end <= n) stack.pop();
        continue;
      }
      if (top?.t === "tag") {
        const c = line[i];
        if (/\s/.test(c)) {
          push(out, "", c);
          i++;
        } else if (c === ">" || line.startsWith("/>", i)) {
          const end = c === ">" ? ">" : "/>";
          push(out, "", end);
          i += end.length;
          stack.pop();
          if (top.embed && end === ">") stack.push({ t: "embed", lang: top.embed, close: `</${top.name}`, inner: null });
        } else if (c === '"' || c === "'") {
          push(out, "string", c);
          // lang="ts" on <script>, lang="scss" on <style>: what the block inside is in.
          const value = line.slice(i + 1, line.indexOf(c, i + 1) === -1 ? n : line.indexOf(c, i + 1)).toLowerCase();
          if (top.embed && top.attr === "lang") top.embed = top.name === "style" ? (LEXERS[value] ? value : "css") : value === "ts" || value === "tsx" ? value : "js";
          if (top.embed && top.attr === "type" && !/(java|ecma)script|module|^$/.test(value)) top.embed = null;
          stack.push({ t: "str", close: c, esc: false, multi: true });
          i++;
        } else if (c === "=") {
          push(out, "", c);
          i++;
          const bare = /[^\s"'>=`]+/y;
          bare.lastIndex = i;
          const m = bare.exec(line);
          if (m) {
            push(out, "string", m[0]);
            i += m[0].length;
          }
        } else {
          const re = /[^\s=>/"']+|\//y;
          re.lastIndex = i;
          const m = re.exec(line)?.[0] ?? c;
          const plain = m === "/" || (m === c && !/[\p{L}\p{N}_:@.-]/u.test(c));
          top.attr = m.toLowerCase();
          push(out, plain ? "" : "attr", m);
          i += m.length;
        }
        continue;
      }
      if (line.startsWith("<!--", i)) {
        push(out, "comment", "<!--");
        stack.push({ t: "block", close: "-->", nest: false, depth: 1, kind: "comment" });
        i += 4;
        continue;
      }
      if (line.startsWith("<![CDATA[", i)) {
        push(out, "keyword", "<![CDATA[");
        stack.push({ t: "block", close: "]]>", nest: false, depth: 1, kind: "string" });
        i += 9;
        continue;
      }
      let m = /<[!?][^>\n]*>?/y;
      m.lastIndex = i;
      let r = m.exec(line);
      if (r) {
        push(out, "keyword", r[0]);
        i += r[0].length;
        continue;
      }
      m = /(<\/?)([\p{L}_][\p{L}\p{N}_:.-]*)/uy;
      m.lastIndex = i;
      r = m.exec(line);
      if (r) {
        push(out, "", r[1]);
        push(out, "tag", r[2]);
        i += r[0].length;
        const name = r[2].toLowerCase();
        const embed = !xml && r[1] === "<" && (name === "script" ? "js" : name === "style" ? "css" : null);
        stack.push({ t: "tag", name, embed, attr: null });
        continue;
      }
      m = /&(?:#\d+|#x[\da-fA-F]+|[\p{L}\p{N}]+);/uy;
      m.lastIndex = i;
      r = m.exec(line);
      if (r) {
        push(out, "constant", r[0]);
        i += r[0].length;
        continue;
      }
      let j = i + 1;
      while (j < n && line[j] !== "<" && line[j] !== "&") j++;
      push(out, "", line.slice(i, j));
      i = j;
    }
    return finish(out, line, i, stack);
  };
}

// ── Markdown ─────────────────────────────────────────────────────────────────

const FENCE_LANG = {
  javascript: "js", node: "js", typescript: "ts", py: "python", python3: "python", rb: "ruby", rs: "rust",
  golang: "go", kt: "kotlin", "c#": "csharp", cs: "csharp", "c++": "cpp", sh: "shell", bash: "shell", zsh: "shell",
  shell: "shell", console: "shell", yml: "yaml", dockerfile: "docker", docker: "docker", makefile: "make", make: "make",
  terraform: "hcl", tf: "hcl", ps1: "powershell", pwsh: "powershell", powershell: "powershell", vue: "html", svelte: "html",
};
function fenceLang(info) {
  const name = info.toLowerCase().replace(/^\{?\.?/, "").split(/[\s{,]/)[0];
  if (!name) return null;
  if (FENCE_LANG[name]) return FENCE_LANG[name];
  if (LEXERS[name] && name !== "markdown") return name;
  return languageOf(`x.${name}`);
}

const MD_INLINE = [
  [/(`+)[^`\n]+?\1(?!`)/y, "string"],
  [/!?\[[^\]\n]*\](?=[([])/y, "function"],
  [/\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/y, "string", (prev) => prev === "function"],
  [/\[[^\]\n]*\]/y, "string", (prev) => prev === "function"],
  [/<(?:https?:|mailto:)[^>\s]+>/y, "string"],
  [/(\*\*|__)(?=\S)[^\n]+?(?<=\S)\1/y, "type"],
  [/<!--.*?-->/y, "comment"],
  [/<\/?[\p{L}][^>\n]*>/uy, "tag"],
];

function inlineMarkdown(line, i, n, out) {
  let prev = null;
  while (i < n) {
    let hit = null;
    for (const [re, kind, when] of MD_INLINE) {
      if (when && !when(prev)) continue;
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0]) {
        hit = [kind, m[0]];
        break;
      }
    }
    if (hit) {
      push(out, hit[0], hit[1]);
      prev = hit[0];
      i += hit[1].length;
      continue;
    }
    let j = i + 1;
    while (j < n && !"`![<(*_".includes(line[j])) j++;
    push(out, "", line.slice(i, j));
    prev = null;
    i = j;
  }
  return i;
}

function lexMarkdown(line, state) {
  const out = [];
  const stack = copy(state);
  const n = Math.min(line.length, MAX_LEX);
  const top = stack[stack.length - 1];
  if (top?.t === "fence") {
    const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (close && close[1][0] === top.fence[0] && close[1].length >= top.fence.length) {
      push(out, "keyword", line.slice(0, n));
      stack.pop();
    } else if (LEXERS[top.lang]) {
      const r = LEXERS[top.lang](line.slice(0, n), top.inner);
      for (const [kind, text] of r.spans) push(out, kind, text);
      top.inner = r.state;
    } else push(out, "", line.slice(0, n));
    return finish(out, line, n, stack);
  }
  if (top?.t === "block") {
    const i = scanBlock(line, 0, n, top, stack, out);
    return finish(out, line, inlineMarkdown(line, i, n, out), stack);
  }
  let m = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (m && !(m[2][0] === "`" && m[3].includes("`"))) {
    push(out, "", m[1]);
    push(out, "keyword", m[2]);
    push(out, "type", m[3]);
    stack.push({ t: "fence", fence: m[2], lang: fenceLang(m[3].trim()), inner: null });
    return finish(out, line, n, stack);
  }
  if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
    push(out, "heading", line.slice(0, n));
    return finish(out, line, n, stack);
  }
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
    push(out, "keyword", line.slice(0, n));
    return finish(out, line, n, stack);
  }
  if (/^[ \t]*<!--/.test(line) && !line.includes("-->")) {
    push(out, "comment", line.slice(0, n));
    stack.push({ t: "block", close: "-->", nest: false, depth: 1, kind: "comment" });
    return finish(out, line, n, stack);
  }
  let i = 0;
  m = /^([ \t]*(?:>[ \t]?)+)/.exec(line);
  if (m) {
    push(out, "keyword", m[1]);
    i = m[1].length;
  }
  m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\](?=[ \t]))?/.exec(line.slice(i));
  if (m) {
    push(out, "", m[1]);
    push(out, "keyword", m[2]);
    push(out, "", m[3]);
    if (m[4]) push(out, "keyword", m[4]);
    i += m[0].length;
  }
  return finish(out, line, inlineMarkdown(line, i, n, out), stack);
}

// ── The lexers ───────────────────────────────────────────────────────────────

const LEXERS = {
  js: codeLexer(JSX),
  jsx: codeLexer(JSX),
  ts: codeLexer(TS),
  tsx: codeLexer(TSX),
  json: codeLexer(JSON_CFG),
  python: codeLexer(PYTHON),
  ruby: codeLexer(RUBY),
  rust: codeLexer(RUST),
  go: codeLexer(GO),
  java: codeLexer(JAVA),
  kotlin: codeLexer(KOTLIN),
  scala: codeLexer(SCALA),
  groovy: codeLexer(GROOVY),
  swift: codeLexer(SWIFT),
  dart: codeLexer(DART),
  c: codeLexer(C),
  cpp: codeLexer(CPP),
  objc: codeLexer(OBJC),
  csharp: codeLexer(CSHARP),
  php: codeLexer(PHP),
  lua: codeLexer(LUA),
  perl: codeLexer(PERL),
  r: codeLexer(R),
  elixir: codeLexer(ELIXIR),
  sql: codeLexer(SQL),
  shell: codeLexer(SHELL),
  make: codeLexer(MAKE),
  docker: codeLexer(DOCKER),
  powershell: codeLexer(POWERSHELL),
  hcl: codeLexer(HCL),
  proto: codeLexer(PROTO),
  graphql: codeLexer(GRAPHQL),
  toml: codeLexer(TOML),
  ini: codeLexer(INI),
  ignore: lexIgnore,
  yaml: lexYaml,
  css: cssLexer(false),
  scss: cssLexer(true),
  less: cssLexer(true),
  html: markupLexer(false),
  xml: markupLexer(true),
  markdown: lexMarkdown,
};

// ── Lines and diffs ──────────────────────────────────────────────────────────

// Every line of a text as runs (an array of [kind, text] per line), or null for a language it
// doesn't know (or a lexer that failed on it: the text then shows uncolored, never not at all).
export function highlight(lines, lang) {
  const lex = LEXERS[lang];
  if (!lex) return null;
  let state = null;
  try {
    return lines.map((line) => {
      const r = lex(line, state);
      state = r.state;
      return r.spans;
    });
  } catch {
    return null;
  }
}

// Puts `spans` on the rows of a diff ({ kind: "@" | "-" | "+" | " " | …, text }) for a language it
// knows; false (and no spans) for one it doesn't. Each side is read in its own order (context and
// removed lines, context and added lines), so a comment or string a change opens or closes colors
// the lines after it on that side only; a hunk starts afresh, or inside a /* comment when its
// first line looks like one (" * …", " */"). A lexer that fails leaves every row uncolored.
export function highlightDiff(rows, lang) {
  const lex = LEXERS[lang];
  if (!lex) return false;
  try {
    colorRows(rows, lex);
    return true;
  } catch {
    for (const row of rows) delete row.spans;
    return false;
  }
}

function colorRows(rows, lex) {
  let before = null;
  let after = null;
  let fresh = true;
  for (const row of rows) {
    if (row.kind === "@") {
      before = after = null;
      fresh = true;
      continue;
    }
    if (row.kind !== "-" && row.kind !== "+" && row.kind !== " ") continue;
    if (fresh) {
      fresh = false;
      if (lex.comment && /^\s*\*(?:\s|\/|$)/.test(row.text)) before = after = lex.comment();
    }
    if (row.kind === "-") {
      const r = lex(row.text, before);
      row.spans = r.spans;
      before = r.state;
    } else if (row.kind === "+") {
      const r = lex(row.text, after);
      row.spans = r.spans;
      after = r.state;
    } else {
      before = lex(row.text, before).state;
      const r = lex(row.text, after);
      row.spans = r.spans;
      after = r.state;
    }
  }
}
