// electron/agent/codeintel.ts
import { promises as fsp, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

// electron/agent/lspLanguages.ts
var npm = (pkgs, timeoutMs = 3e5) => ({
  exe: "npm",
  args: ["install", "-g", "--no-fund", "--no-audit", ...pkgs],
  timeoutMs
});
var tool = (exe, args, timeoutMs = 6e5) => ({ exe, args, timeoutMs });
var LSP_SERVERS = [
  {
    lang: "typescript",
    language: "TypeScript / JavaScript",
    languageId: "typescript",
    exts: ["ts", "tsx", "js", "jsx", "mts", "cts"],
    command: "typescript-language-server",
    args: ["--stdio"],
    package: "npm:typescript-language-server, typescript",
    installHint: "npm i -g typescript-language-server typescript",
    install: npm(["typescript-language-server", "typescript"]),
    rootFiles: ["package.json", "tsconfig.json", "jsconfig.json"],
    note: "Runs on Node.js (the app runtime already provides it)."
  },
  {
    lang: "python",
    language: "Python",
    languageId: "python",
    exts: ["py", "pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    package: "npm:pyright (or pip:pyright)",
    installHint: "npm i -g pyright  (or: pip install pyright)",
    install: npm(["pyright"]),
    rootFiles: ["pyrightconfig.json", "pyproject.toml", "setup.py", "requirements.txt"],
    note: "Pyright is Node-based; it does not need a Python interpreter to analyse code."
  },
  {
    lang: "go",
    language: "Go",
    languageId: "go",
    exts: ["go"],
    command: "gopls",
    args: [],
    package: "go:golang.org/x/tools/gopls@latest",
    installHint: "go install golang.org/x/tools/gopls@latest",
    install: tool("go", ["install", "golang.org/x/tools/gopls@latest"]),
    rootFiles: ["go.mod", "go.work"],
    externalBinary: "Go toolchain (the `go` command must already be installed and on PATH)."
  },
  {
    lang: "rust",
    language: "Rust",
    languageId: "rust",
    exts: ["rs"],
    command: "rust-analyzer",
    args: [],
    package: "rustup:rust-analyzer component",
    installHint: "rustup component add rust-analyzer",
    install: tool("rustup", ["component", "add", "rust-analyzer"]),
    rootFiles: ["Cargo.toml"],
    externalBinary: "Rust toolchain + rustup (the `rustup` command must be installed)."
  },
  {
    lang: "java",
    language: "Java",
    languageId: "java",
    exts: ["java"],
    command: "jdtls",
    args: [],
    package: "npm:jdtls (Eclipse JDT Language Server)",
    installHint: "npm i -g jdtls  \u2014 requires a JDK 17+ on PATH (`java -version`)",
    install: npm(["jdtls"], 6e5),
    rootFiles: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
    externalBinary: "Java JDK 17+ (`java` on PATH). jdtls cannot run without it.",
    note: "First launch may download the Eclipse JDT bundle; needs network access once."
  },
  {
    lang: "php",
    language: "PHP",
    languageId: "php",
    exts: ["php", "phtml"],
    command: "intelephense",
    args: ["--stdio"],
    package: "npm:intelephense",
    installHint: "npm i -g intelephense",
    install: npm(["intelephense"]),
    rootFiles: ["composer.json"],
    note: "Pure Node.js server; no PHP binary is required for analysis."
  },
  {
    lang: "ruby",
    language: "Ruby",
    languageId: "ruby",
    exts: ["rb", "rake", "gemspec"],
    command: "solargraph",
    args: ["stdio"],
    package: "gem:solargraph",
    installHint: "gem install solargraph  \u2014 requires Ruby + RubyGems",
    install: tool("gem", ["install", "solargraph"]),
    rootFiles: ["Gemfile", "*.gemspec", ".ruby-version"],
    externalBinary: "Ruby runtime + RubyGems (`ruby`, `gem` on PATH)."
  },
  {
    lang: "cpp",
    language: "C / C++",
    languageId: "cpp",
    exts: ["c", "h", "cpp", "cxx", "cc", "hpp", "hh"],
    command: "clangd",
    args: ["--background-index"],
    package: "system:LLVM clangd (apt/brew/LLVM release)",
    installHint: "apt install clangd   |   brew install llvm   |   download an LLVM release (clangd)",
    install: null,
    // system binary — never pretend npm/gem can install it
    rootFiles: ["compile_commands.json", "CMakeLists.txt", ".clangd", "Makefile"],
    externalBinary: "clangd binary (part of LLVM). Not bundled \u2014 install via your OS package manager.",
    note: "Best results with a compile_commands.json in the project root."
  },
  {
    lang: "csharp",
    language: "C#",
    languageId: "csharp",
    exts: ["cs"],
    command: "csharp-ls",
    args: [],
    package: "dotnet tool:csharp-ls",
    installHint: "dotnet tool install -g csharp-ls  \u2014 requires the .NET SDK",
    install: tool("dotnet", ["tool", "install", "-g", "csharp-ls"]),
    rootFiles: ["*.sln", "*.csproj", "global.json"],
    externalBinary: ".NET SDK (`dotnet` on PATH). csharp-ls is a .NET global tool."
  },
  {
    lang: "kotlin",
    language: "Kotlin",
    languageId: "kotlin",
    exts: ["kt", "kts"],
    command: "kotlin-language-server",
    args: [],
    package: "GitHub release:kotlin-language-server (jmfargas/gradle-kotlin-language-server fork)",
    installHint: "Download a kotlin-language-server release ZIP from GitHub, unzip, add its bin/ to PATH \u2014 requires Java 11+",
    install: null,
    // distributed as a GitHub zip, not an npm/pip package
    rootFiles: ["settings.gradle.kts", "build.gradle.kts", "pom.xml", "gradlew"],
    externalBinary: "Java JRE/JDK 11+ (`java` on PATH) + the downloaded server binary.",
    note: "Not installable with npm/pip; this build will NOT auto-install it."
  },
  {
    lang: "swift",
    language: "Swift",
    languageId: "swift",
    exts: ["swift"],
    command: "sourcekit-lsp",
    args: [],
    package: "Swift toolchain:sourcekit-lsp (ships with Swift / Xcode)",
    installHint: "Install the Swift toolchain (or Xcode on macOS); sourcekit-lsp is included",
    install: null,
    rootFiles: ["Package.swift", "*.xcodeproj", "*.xcworkspace"],
    externalBinary: "Swift toolchain / Xcode (`sourcekit-lsp` on PATH). Not available on stock Windows."
  },
  {
    lang: "dart",
    language: "Dart",
    languageId: "dart",
    exts: ["dart"],
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    package: "Dart SDK:dart (language-server is built in)",
    installHint: "Install the Dart SDK; the `dart language-server` command is bundled",
    install: null,
    rootFiles: ["pubspec.yaml"],
    externalBinary: "Dart SDK (`dart` on PATH)."
  },
  {
    lang: "elixir",
    language: "Elixir",
    languageId: "elixir",
    exts: ["ex", "exs", "heex"],
    command: "elixir-ls",
    args: [],
    package: "GitHub release:elixir-ls (Jake Becker / elixir-lsp)",
    installHint: "Download/build elixir-ls from GitHub releases, add its release/ dir to PATH",
    install: null,
    rootFiles: ["mix.exs"],
    externalBinary: "Elixir + Erlang/OTP runtime (`elixir`, `erl` on PATH).",
    note: "No npm/pip distribution; not auto-installed."
  },
  {
    lang: "r",
    language: "R",
    languageId: "r",
    exts: ["r", "rmd"],
    command: "Rscript",
    args: ["-e", "languageserver::run()"],
    package: "CRAN:languageserver",
    installHint: `Rscript -e "install.packages('languageserver')"  \u2014 requires R`,
    install: null,
    // CRAN package, installed from inside R — not an npm/pip command
    rootFiles: ["*.Rproj", "DESCRIPTION", ".Rprofile"],
    externalBinary: "R runtime (`Rscript` on PATH)."
  },
  {
    lang: "lua",
    language: "Lua",
    languageId: "lua",
    exts: ["lua"],
    command: "lua-language-server",
    args: [],
    package: "GitHub release:lua-language-server (sumneko/LuaLS)",
    installHint: "Download lua-language-server from GitHub releases and add its bin/ to PATH",
    install: null,
    rootFiles: [".luarc.json", "lua.cfg", ".luarc.jsonc"],
    externalBinary: "lua-language-server binary (prebuilt in the GitHub release)."
  },
  {
    lang: "zig",
    language: "Zig",
    languageId: "zig",
    exts: ["zig", "zon"],
    command: "zls",
    args: [],
    package: "GitHub release:zls (Zig Language Server)",
    installHint: "Build or download zls from GitHub releases; place `zls` on PATH",
    install: null,
    rootFiles: ["build.zig", "build.zig.zon"],
    externalBinary: "Zig toolchain + the zls binary (match the zls build to your Zig version)."
  }
];
var HEURISTIC_FALLBACKS = ["find_refs", "symbol_outline", "repo_map", "search_files"];

// electron/agent/codeintel.ts
var LANGS = {
  ts: ["TypeScript"],
  tsx: ["TypeScript"],
  js: ["JavaScript"],
  jsx: ["JavaScript"],
  mjs: ["JavaScript"],
  cjs: ["JavaScript"],
  py: ["Python"],
  pyi: ["Python"],
  go: ["Go"],
  rs: ["Rust"],
  java: ["Java"],
  kt: ["Kotlin"],
  kts: ["Kotlin"],
  cs: ["C#"],
  dart: ["Dart"],
  c: ["C"],
  h: ["C", "C++"],
  cpp: ["C++"],
  cxx: ["C++"],
  cc: ["C++"],
  hpp: ["C++"],
  hh: ["C++"],
  php: ["PHP"],
  rb: ["Ruby"],
  swift: ["Swift"],
  lua: ["Lua"],
  ex: ["Elixir"],
  exs: ["Elixir"],
  heex: ["Elixir"],
  r: ["R"],
  rmd: ["R"],
  zig: ["Zig"],
  zon: ["Zig"],
  sh: ["Shell"],
  bash: ["Shell"],
  zsh: ["Shell"],
  vue: ["Vue"],
  svelte: ["Svelte"],
  // v11.12+ — heuristic-only languages (NO LSP server is claimed for these).
  // Real regex/AST-lite extraction so symbol_outline / find_refs / repo_map
  // return useful results instead of an empty string.
  md: ["Markdown"],
  mdx: ["Markdown"],
  json: ["JSON"],
  jsonc: ["JSON"],
  yaml: ["YAML"],
  yml: ["YAML"],
  css: ["CSS"],
  scss: ["SCSS"],
  less: ["Less"],
  html: ["HTML"],
  htm: ["HTML"],
  sql: ["SQL"],
  ps1: ["PowerShell"],
  psm1: ["PowerShell"],
  dockerfile: ["Dockerfile"],
  hs: ["Haskell"],
  lhs: ["Haskell"],
  clj: ["Clojure"],
  cljs: ["Clojure"],
  cljc: ["Clojure"],
  edn: ["Clojure"],
  scala: ["Scala"],
  pl: ["Perl"],
  pm: ["Perl"],
  m: ["Objective-C"],
  mm: ["Objective-C"],
  graphql: ["GraphQL"],
  gql: ["GraphQL"]
};
var FAMILY_OF = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  py: "py",
  pyi: "py",
  go: "go",
  rs: "rs",
  java: "jvm",
  kt: "jvm",
  kts: "jvm",
  cs: "jvm",
  dart: "jvm",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hh: "cpp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
  heex: "elixir",
  r: "r",
  rmd: "r",
  zig: "zig",
  zon: "zig",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  vue: "embed",
  svelte: "embed",
  md: "md",
  mdx: "md",
  json: "data",
  jsonc: "data",
  yaml: "data",
  yml: "data",
  css: "style",
  scss: "style",
  less: "style",
  html: "html",
  htm: "html",
  sql: "sql",
  ps1: "ps",
  psm1: "ps",
  dockerfile: "docker",
  hs: "hs",
  lhs: "hs",
  clj: "clj",
  cljs: "clj",
  cljc: "clj",
  edn: "clj",
  scala: "scala",
  pl: "pl",
  pm: "pl",
  m: "objc",
  mm: "objc",
  graphql: "graphql",
  gql: "graphql"
};
var CONTAINER_KINDS = /* @__PURE__ */ new Set(["class", "interface", "struct", "trait", "impl", "module"]);
var REKIND = {
  js: /* @__PURE__ */ new Set(["class", "struct", "interface", "impl", "trait"]),
  jvm: /* @__PURE__ */ new Set(["class", "struct", "interface", "impl", "trait"]),
  cpp: /* @__PURE__ */ new Set(["class", "struct", "interface", "impl", "trait"]),
  go: /* @__PURE__ */ new Set(),
  // methods come from the receiver syntax directly
  rs: /* @__PURE__ */ new Set(["impl", "trait", "struct", "enum"]),
  py: /* @__PURE__ */ new Set(["class"]),
  php: /* @__PURE__ */ new Set(["class", "interface", "trait"]),
  ruby: /* @__PURE__ */ new Set(["class", "module"]),
  swift: /* @__PURE__ */ new Set(["class", "struct", "interface", "impl", "enum"]),
  lua: /* @__PURE__ */ new Set(),
  elixir: /* @__PURE__ */ new Set(["class", "module"]),
  r: /* @__PURE__ */ new Set(),
  zig: /* @__PURE__ */ new Set(["struct", "class"]),
  sh: /* @__PURE__ */ new Set(),
  embed: /* @__PURE__ */ new Set(["class", "struct", "interface", "impl", "trait"]),
  // heuristic-only families: containers are shallow (no reliable brace tree),
  // so no re-kindling — the declared kind is the honest one.
  md: /* @__PURE__ */ new Set(),
  data: /* @__PURE__ */ new Set(),
  style: /* @__PURE__ */ new Set(),
  html: /* @__PURE__ */ new Set(),
  sql: /* @__PURE__ */ new Set(),
  ps: /* @__PURE__ */ new Set(),
  docker: /* @__PURE__ */ new Set(),
  hs: /* @__PURE__ */ new Set(),
  clj: /* @__PURE__ */ new Set(),
  scala: /* @__PURE__ */ new Set(),
  pl: /* @__PURE__ */ new Set(),
  objc: /* @__PURE__ */ new Set(),
  graphql: /* @__PURE__ */ new Set()
};
var NO_REKIND = /* @__PURE__ */ new Set();
function extNoDot(p) {
  const base = path.basename(String(p || ""));
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}
function langOf(p) {
  const names = LANGS[extNoDot(p)];
  return names && names.length ? names[0] : "Unknown";
}
function clampInt(v, min, max, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function indentWidth(ws) {
  let w = 0;
  for (const ch of ws) w += ch === "	" ? 4 : 1;
  return w;
}
function leadingWs(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : "";
}
function codeLines(lines, style) {
  const out = [];
  let inStr = null;
  let tplDepth = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = style === "rs" ? raw.replace(/'(?:[A-Za-z_]\w*|static)\b/g, " L") : raw;
    let res = "";
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = j + 1 < line.length ? line[j + 1] : "";
      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false;
          res += "   ";
          j++;
        } else {
          res += " ";
        }
        continue;
      }
      if (inStr === "`") {
        if (ch === "\\") {
          res += "  ";
          j++;
          continue;
        }
        if (ch === "`") {
          inStr = null;
          res += " ";
          continue;
        }
        if (ch === "$" && next === "{") {
          inStr = null;
          tplDepth = 1;
          res += "  ";
          j++;
          continue;
        }
        res += " ";
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          res += "  ";
          j++;
          continue;
        }
        if (ch === inStr) {
          inStr = null;
          res += " ";
          continue;
        }
        res += " ";
        continue;
      }
      if (tplDepth > 0) {
        if (ch === "{") {
          tplDepth++;
          res += " ";
          continue;
        }
        if (ch === "}") {
          tplDepth--;
          if (tplDepth === 0) inStr = "`";
          res += " ";
          continue;
        }
        if (ch === "`") {
          inStr = "`";
          res += " ";
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = ch;
          res += " ";
          continue;
        }
        if (ch === "/" && next === "/") break;
        res += ch;
        continue;
      }
      if ((style === "c" || style === "rs") && ch === "/" && next === "/") break;
      if ((style === "c" || style === "rs") && ch === "/" && next === "*") {
        inBlock = true;
        res += "  ";
        j++;
        continue;
      }
      if (style === "hash" && ch === "#" && (j === 0 || /\s/.test(line[j - 1]))) break;
      if (style === "lua" && ch === "-" && next === "-") break;
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        res += " ";
        continue;
      }
      res += ch;
    }
    out.push(res);
  }
  return out;
}
function braceEnd(cs, startIdx) {
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < cs.length; i++) {
    const code = cs[i] ?? "";
    for (const ch of code) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (opened && depth <= 0) return i + 1;
    if (!opened) {
      if (code.includes(";")) return i + 1;
      if (!code.trim()) return Math.max(startIdx + 1, i);
    }
  }
  return cs.length;
}
function indentEnd(cs, declIdx, declIndent) {
  let end = declIdx;
  for (let i = declIdx + 1; i < cs.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    if (indentWidth(leadingWs(code)) <= declIndent) break;
    end = i;
  }
  return end + 1;
}
function kwEndRuby(cs, declIdx) {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? "";
    const openAt = /^\s*(?:def|class|module|if|unless|while|until|case|begin|for)\b/.test(code);
    const doAt = /\bdo\s*(?:\|[^|]*\|)?\s*$/.test(code);
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += (openAt ? 1 : 0) + (doAt ? 1 : 0) - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}
function kwEndLua(cs, declIdx) {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? "";
    let opens = 0;
    if (/^\s*(?:local\s+)?function\b/.test(code)) opens++;
    const thens = (code.match(/\bthen\b/g) ?? []).length;
    const elseifs = (code.match(/\belseif\b/g) ?? []).length;
    opens += Math.max(0, thens - elseifs);
    opens += (code.match(/\bdo\b/g) ?? []).length;
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}
function mkRaw(name, kind, idx, cs, offset, endLine) {
  return {
    name,
    kind,
    line: idx + 1 + offset,
    sigLine: idx + 1 + offset,
    endLine: (endLine ?? braceEnd(cs, idx)) + offset
  };
}
var CONTROL_WORDS = /* @__PURE__ */ new Set([
  "if",
  "else",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "do",
  "try",
  "new",
  "case",
  "default",
  "throw",
  "typeof",
  "await",
  "yield",
  "delete",
  "void",
  "super",
  "this",
  "function",
  "class",
  "struct",
  "enum",
  "interface",
  "namespace",
  "import",
  "export",
  "extends",
  "implements",
  "unless",
  "elsif",
  "def",
  "end",
  "fn",
  "let",
  "var",
  "const",
  "with",
  "except",
  "finally",
  "lambda",
  "match",
  "use",
  "package",
  "func",
  "defer",
  "local",
  "then",
  "begin",
  "rescue",
  "module",
  "until",
  "select",
  "range",
  "echo",
  "source",
  "require",
  "foreach",
  "elseif",
  "in",
  "as",
  "is",
  "not",
  "and",
  "or",
  "loop",
  "repeat",
  "print",
  "println"
]);
function scanBody(lines, cs, offset, startIdx, endIdxEx, targetDepth, regionContainer, makers, out) {
  let depth = 0;
  for (let i = startIdx; i < endIdxEx && i < lines.length; i++) {
    const depthBefore = depth;
    const code = cs[i] ?? "";
    for (const ch of code) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depthBefore !== targetDepth) continue;
    if (!code.trim()) continue;
    for (const make of makers) {
      const r = make(code);
      if (r) {
        out.push({
          name: r.name,
          kind: r.kind,
          container: r.container ?? regionContainer,
          lockContainer: r.lockContainer ?? regionContainer !== null,
          line: i + 1 + offset,
          sigLine: i + 1 + offset,
          endLine: braceEnd(cs, i) + offset
        });
        break;
      }
    }
  }
}
var JS_CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
var JS_INTERFACE_RE = /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/;
var JS_ENUM_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/;
var JS_TYPE_RE = /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/;
var JS_MODULE_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/;
var JS_FUNCTION_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
var JS_CONST_ARROW_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+?)?=\s*(?:async\s+)?(?:function\s*\*?\s*)?\(/;
var JS_METHOD_RE = /^\s{2,}(?:(?:public|private|protected|static|readonly|override|abstract|declare|get|set|async)\s+)*(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
var JS_ARROW_RE = /^\s{2,}(?:(?:public|private|protected|static|readonly)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b)?\s*\(/;
var jsMethodMaker = (code) => {
  const m = JS_METHOD_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: "method", lockContainer: true };
};
var jsArrowMaker = (code) => {
  const m = JS_ARROW_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: "method", lockContainer: true };
};
function scanJsFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    let sym = null;
    let m = JS_CLASS_RE.exec(code);
    if (m) sym = mkRaw(m[1], "class", i, cs, offset);
    if (!sym) {
      m = JS_INTERFACE_RE.exec(code);
      if (m) sym = mkRaw(m[1], "interface", i, cs, offset);
    }
    if (!sym) {
      m = JS_ENUM_RE.exec(code);
      if (m) sym = mkRaw(m[1], "enum", i, cs, offset);
    }
    if (!sym) {
      m = JS_TYPE_RE.exec(code);
      if (m) sym = mkRaw(m[1], "type", i, cs, offset);
    }
    if (!sym) {
      m = JS_MODULE_RE.exec(code);
      if (m) sym = mkRaw(m[1], "module", i, cs, offset);
    }
    if (!sym) {
      m = JS_FUNCTION_RE.exec(code);
      if (m) sym = mkRaw(m[1], "function", i, cs, offset);
    }
    if (!sym) {
      m = JS_CONST_ARROW_RE.exec(code);
      if (m) sym = mkRaw(m[1], /^\s*(?:export\s+)?const\b/.test(code) ? "const" : "variable", i, cs, offset);
    }
    if (sym) raw.push(sym);
  }
  for (const region of raw) {
    if (region.kind !== "class" && region.kind !== "interface" && region.kind !== "struct") continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jsMethodMaker, jsArrowMaker], raw);
  }
  return raw;
}
var JVM_CLASS_RE = /^\s*(?:(?:public|private|protected|internal|abstract|final|open|data|sealed|inner|value|non-sealed|static|partial|readonly|enum)\s+)*(class|interface|enum(?:\s+class)?|struct|object|record|mixin)\s+([A-Za-z_]\w*)/;
var JVM_FUN_RE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|async|suspend|override|open|inline|fun)\s+)*(?:<[^()]*>\s*)?(?:[\w$][\w$<>\[\],.?\s]*?\s+)?([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:async\s*)?\{/;
var JVM_METHOD_RE = /^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|sealed|synchronized|extern|unsafe|partial|suspend|inline|open|mutating|required|convenience|lateinit|const|new|fun)\s+)*(?:<[^()]*>\s*)?(?:[\w$][\w$<>\[\],.?\s]*?\s+)?([A-Za-z_~][\w]*)\s*\(/;
var jvmMethodMaker = (code) => {
  const m = JVM_METHOD_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: "method" };
};
function scanJvmFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const m = JVM_CLASS_RE.exec(code);
    if (!m) continue;
    const kw = m[1];
    const kind = kw === "interface" ? "interface" : kw === "enum" || kw === "enum class" ? "enum" : kw === "struct" ? "struct" : "class";
    raw.push(mkRaw(m[2], kind, i, cs, offset));
  }
  const regions = raw.filter((r) => CONTAINER_KINDS.has(r.kind));
  const insideRegion = (idx) => regions.some((r) => {
    const s = r.line - 1 - offset;
    const e = r.endLine - 1 - offset;
    return s < idx && idx <= e;
  });
  for (let i = 0; i < lines.length; i++) {
    if (insideRegion(i)) continue;
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const m = JVM_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push({ name, kind: "function", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: braceEnd(cs, i) + offset });
  }
  for (const region of raw) {
    if (region.kind !== "class" && region.kind !== "interface" && region.kind !== "struct") continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jvmMethodMaker], raw);
  }
  return raw;
}
var CPP_ENUM_RE = /^[\w:<>*&\s]*\benum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/;
var CPP_CLASS_RE = /^[\w:<>*&\s]*\b(?:class|struct)\s+([A-Za-z_]\w*)/;
var CPP_MEMBER_RE = /^[\w:<>*&~\s]*\b(\w+)::(~?[A-Za-z_]\w*)\s*\(/;
var CPP_FN_RE = /^[\w:<>*&\s]+\s\*?([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{/;
var cppMemberMaker = (code) => {
  const m = CPP_MEMBER_RE.exec(code);
  if (!m) return null;
  if (!m[1] || m[1] === "std") return null;
  const name = m[2];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: "method", container: m[1], lockContainer: true };
};
var cppFnMaker = (code) => {
  const m = CPP_FN_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: "function" };
};
function scanCppFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const e = CPP_ENUM_RE.exec(code);
    if (e) {
      raw.push(mkRaw(e[1], "enum", i, cs, offset));
      continue;
    }
    const m = CPP_CLASS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], /\bclass\b/.test(code) ? "class" : "struct", i, cs, offset));
      continue;
    }
  }
  scanBody(lines, cs, offset, 0, lines.length, 0, null, [cppMemberMaker, cppFnMaker], raw);
  for (const region of raw) {
    if (region.kind !== "class" && region.kind !== "struct") continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jvmMethodMaker], raw);
  }
  return raw;
}
var GO_STRUCT_RE = /^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+struct\b/;
var GO_IFACE_RE = /^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+interface\b/;
var GO_METHOD_RE = /^\s*func\s*\(\s*\w+\s+\*?([\w.]+)\s*\)\s*(\w+)/;
var GO_FUNC_RE = /^\s*func\s+([A-Za-z_]\w*)\s*\(/;
var GO_TYPE_RE = /^\s*type\s+([A-Za-z_]\w*)/;
function scanGoFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    let m = GO_STRUCT_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "struct", i, cs, offset));
      continue;
    }
    m = GO_IFACE_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "interface", i, cs, offset));
      continue;
    }
    m = GO_METHOD_RE.exec(code);
    if (m) {
      raw.push({ name: m[2], kind: "method", container: m[1], lockContainer: true, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: braceEnd(cs, i) + offset });
      continue;
    }
    m = GO_FUNC_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "function", i, cs, offset));
      continue;
    }
    m = GO_TYPE_RE.exec(code);
    if (m) {
      raw.push({ name: m[1], kind: "type", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}
var RS_FN_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+)?)?fn\s+([A-Za-z_]\w*)/;
var RS_ITEM_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/;
var RS_IMPL_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?impl(?:<[^>]*>)?\s+(?:[\w:<>,\s]+?\s+for\s+)?([\w:]+)/;
var RS_MOD_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/;
var RS_TYPE_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/;
function scanRsFamily(lines, offset) {
  const cs = codeLines(lines, "rs");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    let m = RS_ITEM_RE.exec(code);
    if (m) {
      const kind = m[1] === "struct" ? "struct" : m[1] === "enum" ? "enum" : "trait";
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    m = RS_IMPL_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "impl", i, cs, offset));
      continue;
    }
    m = RS_MOD_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "module", i, cs, offset));
      continue;
    }
    m = RS_FN_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "function", i, cs, offset));
      continue;
    }
    m = RS_TYPE_RE.exec(code);
    if (m) {
      raw.push({ name: m[1], kind: "type", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}
var PY_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/;
var PY_DEF_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/;
function scanPyFamily(lines, offset) {
  const cs = codeLines(lines, "hash");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const mc = PY_CLASS_RE.exec(code);
    const md = mc ? null : PY_DEF_RE.exec(code);
    if (!mc && !md) continue;
    const m = mc ?? md;
    let start = i;
    for (let j = i - 1; j >= 0 && /^\s*@/.test(cs[j] ?? ""); j--) start = j;
    const end = indentEnd(cs, i, indentWidth(leadingWs(code)));
    raw.push({ name: m[1], kind: mc ? "class" : "function", line: start + 1 + offset, sigLine: i + 1 + offset, endLine: end + offset });
  }
  return raw;
}
var PHP_CLASS_RE = /^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait)\s+([A-Za-z_]\w*)/;
var PHP_FUNC_RE = /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?([A-Za-z_]\w*)/;
var PHP_NS_RE = /^\s*namespace\s+([\w\\]+)/;
function scanPhpFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    let m = PHP_CLASS_RE.exec(code);
    if (m) {
      const kind = m[1] === "interface" ? "interface" : m[1] === "trait" ? "trait" : "class";
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    m = PHP_NS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "module", i, cs, offset));
      continue;
    }
    m = PHP_FUNC_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "function", i, cs, offset));
    }
  }
  return raw;
}
var RB_MODULE_RE = /^\s*module\s+([A-Za-z_][\w:]*)/;
var RB_CLASS_RE = /^\s*class\s+([A-Za-z_][\w:]*)/;
var RB_DEF_RE = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/;
function scanRubyFamily(lines, offset) {
  const cs = codeLines(lines, "hash");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    let m = RB_MODULE_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "module", i, cs, offset, kwEndRuby(cs, i)));
      continue;
    }
    m = RB_CLASS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "class", i, cs, offset, kwEndRuby(cs, i)));
      continue;
    }
    m = RB_DEF_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], "function", i, cs, offset, kwEndRuby(cs, i)));
    }
  }
  return raw;
}
var SWIFT_TYPE_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|fileprivate|internal|open|final|indirect|frozen|required|nonisolated)\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_]\w*)/;
var SWIFT_FUNC_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|fileprivate|internal|open|static|class|final|override|required|convenience|mutating|nonmutating|nonisolated)\s+)*func\s+([A-Za-z_]\w*)/;
var SWIFT_INIT_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|internal|override|convenience|required)\s+)?(?:init|deinit)\s*[!(?]/;
function scanSwiftFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const m = SWIFT_TYPE_RE.exec(code);
    if (m) {
      const kind = m[1] === "struct" ? "struct" : m[1] === "enum" ? "enum" : m[1] === "protocol" ? "interface" : m[1] === "extension" ? "impl" : "class";
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    const f = SWIFT_FUNC_RE.exec(code);
    if (f) {
      raw.push(mkRaw(f[1], "function", i, cs, offset));
      continue;
    }
    const init = SWIFT_INIT_RE.exec(code);
    if (init) {
      raw.push(mkRaw(init[0].trim().startsWith("deinit") ? "deinit" : "init", "function", i, cs, offset));
    }
  }
  return raw;
}
var LUA_FUNC_RE = /^\s*(?:local\s+)?function\s+([\w.:]+)/;
function scanLuaFamily(lines, offset) {
  const cs = codeLines(lines, "lua");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const m = LUA_FUNC_RE.exec(code);
    if (m) raw.push(mkRaw(m[1], "function", i, cs, offset, kwEndLua(cs, i)));
  }
  return raw;
}
var EX_MODULE_RE = /^\s*defmodule\s+([A-Za-z_][\w.]*)/;
var EX_FUN_RE = /^\s*def(?:p|macro|macrop|delegate|overridable|struct|impl)?\b\s+([A-Za-z_]\w*[?!]?)/;
function kwEndElixir(cs, declIdx) {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? "";
    const opens = /^\s*(?:defmodule|def(?:p|macro|macrop|delegate|overridable|struct|impl)?)\b/.test(code) ? 1 : 0;
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}
function scanElixirFamily(lines, offset) {
  const cs = codeLines(lines, "hash");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const isModule = EX_MODULE_RE.test(code);
    const m = isModule ? EX_MODULE_RE.exec(code) : EX_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push(mkRaw(name, isModule ? "module" : "function", i, cs, offset, kwEndElixir(cs, i)));
  }
  return raw;
}
var R_FUN_RE = /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\s*\(/;
function scanRFamily(lines, offset) {
  const cs = codeLines(lines, "hash");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const m = R_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1].split(".").pop() ?? m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push(mkRaw(name, "function", i, cs, offset, indentEnd(cs, i, indentWidth(leadingWs(code)))));
  }
  return raw;
}
var ZIG_FN_RE = /^\s*(?:pub\s+)?(?:(?:extern|inline|noinline|export)\s+)*fn\s+([A-Za-z_]\w*)/;
var ZIG_TYPE_RE = /^\s*(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:struct|enum|union|opaque)\b/;
function scanZigFamily(lines, offset) {
  const cs = codeLines(lines, "c");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const t = ZIG_TYPE_RE.exec(code);
    const f = t ? null : ZIG_FN_RE.exec(code);
    const m = t ?? f;
    if (!m) continue;
    raw.push(mkRaw(m[1], t ? "struct" : "function", i, cs, offset));
  }
  return raw;
}
var SH_FN_RE = /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/;
var SH_FN2_RE = /^\s*function\s+([A-Za-z_]\w*)\s*\{?\s*$/;
function scanShFamily(lines, offset) {
  const cs = codeLines(lines, "hash");
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    if (!code.trim()) continue;
    const m = SH_FN_RE.exec(code);
    if (m && !CONTROL_WORDS.has(m[1].toLowerCase())) {
      raw.push(mkRaw(m[1], "function", i, cs, offset));
      continue;
    }
    const m2 = SH_FN2_RE.exec(code);
    if (m2 && !CONTROL_WORDS.has(m2[1].toLowerCase())) {
      raw.push(mkRaw(m2[1], "function", i, cs, offset));
    }
  }
  return raw;
}
var MD_HEAD_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
function scanMdFamily(lines, _cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const m = MD_HEAD_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const name = m[2].trim().replace(/[*_`]/g, "").slice(0, 80);
    if (!name) continue;
    raw.push({ name, kind: "module", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var DATA_KEY_RE = /^\s*(?:-\s*)?["']?([A-Za-z_][\w.\- ]*?)["']?\s*:/;
function scanDataFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DATA_KEY_RE.exec(cs[i] ?? "");
    if (!m) continue;
    const name = m[1].trim().replace(/["']/g, "");
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push({ name, kind: "const", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var CSS_RULE_RE = /^\s*([^{}]+?)\s*\{/;
var CSS_MIXIN_RE = /^\s*@(?:mixin|function)\s+([\w-]+)/;
var CSS_VAR_RE = /^\s*([$@][\w-]+)\s*:/;
function scanStyleFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const mixin = CSS_MIXIN_RE.exec(code);
    if (mixin) {
      raw.push(mkRaw(mixin[1], "function", i, cs, offset));
      continue;
    }
    const v = CSS_VAR_RE.exec(code);
    if (v) {
      raw.push(mkRaw(v[1], "variable", i, cs, offset));
      continue;
    }
    const r = CSS_RULE_RE.exec(code);
    if (!r) continue;
    const sel = r[1].trim().replace(/\s+/g, " ").slice(0, 80);
    if (!sel || sel.startsWith("@") || CONTROL_WORDS.has(sel.toLowerCase())) continue;
    raw.push(mkRaw(sel, "const", i, cs, offset));
  }
  return raw;
}
var HTML_ID_RE = /\bid\s*=\s*["']([^"']+)["']/;
var HTML_TAG_RE = /<\s*([A-Za-z][\w-]*)/;
function scanHtmlFamily(lines, _cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const id = HTML_ID_RE.exec(line);
    if (id) {
      raw.push({ name: id[1], kind: "const", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const tag = HTML_TAG_RE.exec(line);
    if (tag && (/[A-Z]/.test(tag[1]) || tag[1].includes("-"))) {
      raw.push({ name: tag[1], kind: "class", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}
var SQL_CREATE_RE = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER|SCHEMA|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`\[]?([\w.]+)/i;
function scanSqlFamily(lines, cs, offset) {
  const raw = [];
  const kinds = {
    TABLE: "struct",
    VIEW: "struct",
    INDEX: "const",
    FUNCTION: "function",
    PROCEDURE: "function",
    TRIGGER: "function",
    SCHEMA: "module",
    TYPE: "type"
  };
  for (let i = 0; i < lines.length; i++) {
    const m = SQL_CREATE_RE.exec(cs[i] ?? "");
    if (!m) continue;
    const kind = kinds[m[1].toUpperCase()] ?? "const";
    const name = m[2].split(".").pop() ?? m[2];
    raw.push({ name, kind, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var PS_FUNC_RE = /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\{/i;
var PS_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/i;
var PS_NAMED_FUNC_RE = /^\s*function\s+([A-Za-z_][\w-]*)/i;
function scanPsFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const c = PS_CLASS_RE.exec(code);
    if (c) {
      raw.push(mkRaw(c[1], "class", i, cs, offset));
      continue;
    }
    const f = PS_NAMED_FUNC_RE.exec(code);
    if (f) {
      raw.push(mkRaw(f[1], "function", i, cs, offset));
      continue;
    }
    const implicit = PS_FUNC_RE.exec(code);
    if (implicit && implicit[1].includes("-") && !CONTROL_WORDS.has(implicit[1].toLowerCase())) {
      raw.push(mkRaw(implicit[1], "function", i, cs, offset));
    }
  }
  return raw;
}
var DOCKER_STAGE_RE = /^\s*FROM\s+\S+(?:\s+AS\s+([A-Za-z_]\w*))?/i;
var DOCKER_ENV_RE = /^\s*ENV\s+([A-Za-z_]\w*)\s*=/i;
function scanDockerFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const s = DOCKER_STAGE_RE.exec(code);
    if (s) {
      const name = s[1] ?? (s[0].split(/\s+/)[1] ?? "").split("/").pop() ?? "stage";
      raw.push({ name, kind: "module", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const e = DOCKER_ENV_RE.exec(code);
    if (e) raw.push({ name: e[1], kind: "const", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var HS_DECL_RE = /^\s*(module|data|newtype|type|class|instance)\s+([A-Z][\w.]*)/;
var HS_FUN_RE = /^\s*([a-z][\w']*)\s*::/;
function scanHsFamily(lines, cs, offset) {
  const raw = [];
  const kinds = { module: "module", data: "struct", newtype: "struct", type: "type", class: "interface", instance: "impl" };
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const d = HS_DECL_RE.exec(code);
    if (d) {
      raw.push({ name: d[2], kind: kinds[d[1].toLowerCase()] ?? "type", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const f = HS_FUN_RE.exec(code);
    if (f && !CONTROL_WORDS.has(f[1].toLowerCase())) {
      raw.push({ name: f[1], kind: "function", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}
var CLJ_RE = /^\s*\(\s*(ns|defn-?|defmacro|defmulti|defmethod|deftype|defrecord|defprotocol|def)\s+([\w.\-]+)/;
function scanCljFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CLJ_RE.exec(cs[i] ?? "");
    if (!m) continue;
    const kw = m[1].toLowerCase();
    const kind = kw === "ns" ? "module" : kw.startsWith("defn") || kw === "defmacro" || kw === "defmulti" || kw === "defmethod" ? "function" : kw === "def" ? "const" : kw === "defprotocol" ? "interface" : "struct";
    raw.push({ name: m[2], kind, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var SCALA_RE = /^\s*(?:(?:case|final|abstract|sealed|implicit|lazy|override)\s+)*(class|object|trait|def|val|var|type)\s+([A-Za-z_]\w*)/;
function scanScalaFamily(lines, cs, offset) {
  const raw = [];
  const kinds = { class: "class", object: "module", trait: "interface", def: "function", val: "const", var: "variable", type: "type" };
  for (let i = 0; i < lines.length; i++) {
    const m = SCALA_RE.exec(cs[i] ?? "");
    if (!m) continue;
    raw.push({ name: m[2], kind: kinds[m[1].toLowerCase()] ?? "const", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var PERL_RE = /^\s*(sub|package)\s+([\w:]+)/;
function scanPlFamily(lines, cs, offset) {
  const raw = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PERL_RE.exec(cs[i] ?? "");
    if (!m) continue;
    raw.push({ name: m[2], kind: m[1] === "sub" ? "function" : "module", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
var OBJC_TYPE_RE = /^\s*@(interface|implementation|protocol)\s+([A-Za-z_]\w*)/;
var OBJC_METHOD_RE = /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/;
function scanObjcFamily(lines, cs, offset) {
  const raw = [];
  let container = null;
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? "";
    const t = OBJC_TYPE_RE.exec(code);
    if (t) {
      container = t[2];
      raw.push({ name: t[2], kind: t[1].toLowerCase() === "implementation" ? "impl" : "interface", container: null, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const m = OBJC_METHOD_RE.exec(code);
    if (m && !CONTROL_WORDS.has(m[1].toLowerCase())) {
      raw.push({ name: m[1], kind: "method", container, lockContainer: true, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}
var GQL_RE = /^\s*(type|interface|enum|input|scalar|union|schema|query|mutation|subscription|fragment)\s+([A-Za-z_]\w*)/;
function scanGraphqlFamily(lines, cs, offset) {
  const raw = [];
  const kinds = {
    type: "type",
    interface: "interface",
    enum: "enum",
    input: "struct",
    scalar: "type",
    union: "type",
    schema: "module",
    query: "function",
    mutation: "function",
    subscription: "function",
    fragment: "function"
  };
  for (let i = 0; i < lines.length; i++) {
    const m = GQL_RE.exec(cs[i] ?? "");
    if (!m) continue;
    raw.push({ name: m[2], kind: kinds[m[1].toLowerCase()] ?? "type", line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}
function embedPieces(lines) {
  const pieces = [];
  const text = lines.join("\n");
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  let found = false;
  while ((m = re.exec(text)) !== null) {
    const nlBeforeTag = (text.slice(0, m.index).match(/\n/g) ?? []).length;
    const bodyStart = nlBeforeTag + 1 + (m[1].startsWith("\n") ? 1 : 0);
    const inner = m[1].replace(/^\r?\n/, "");
    const innerLines = inner.split("\n");
    pieces.push({ raw: scanJsFamily(innerLines, bodyStart), lines: innerLines, offset: bodyStart });
    found = true;
  }
  if (!found) pieces.push({ raw: scanJsFamily(lines, 0), lines, offset: 0 });
  return pieces;
}
function finalize(raw, lines, offset, rekindInto) {
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const r of raw) {
    if (seen.has(r.line)) continue;
    seen.add(r.line);
    ordered.push(r);
  }
  const containers = ordered.filter((r) => CONTAINER_KINDS.has(r.kind));
  const out = [];
  for (const r of ordered) {
    let container = r.container ?? null;
    if (!r.lockContainer) {
      container = null;
      let best = null;
      for (const c of containers) {
        if (c === r) continue;
        if (c.line < r.line && r.line <= c.endLine) {
          if (!best || c.endLine - c.line < best.endLine - best.line) best = c;
        }
      }
      if (best) {
        container = best.name;
        if (r.kind === "function" && rekindInto.has(best.kind)) r.kind = "method";
      }
    }
    const line = Math.max(1, r.line);
    const sig = (lines[r.sigLine - 1 - offset] ?? "").trim().slice(0, 120);
    const endLine = Math.min(Math.max(r.endLine, line), Math.max(line, lines.length + offset));
    out.push({ name: r.name, kind: r.kind, line, endLine, signature: sig, container });
  }
  return out;
}
function scanFamily(family, lines, cs) {
  switch (family) {
    case "js":
      return scanJsFamily(lines, 0);
    case "jvm":
      return scanJvmFamily(lines, 0);
    case "cpp":
      return scanCppFamily(lines, 0);
    case "go":
      return scanGoFamily(lines, 0);
    case "rs":
      return scanRsFamily(lines, 0);
    case "py":
      return scanPyFamily(lines, 0);
    case "php":
      return scanPhpFamily(lines, 0);
    case "ruby":
      return scanRubyFamily(lines, 0);
    case "swift":
      return scanSwiftFamily(lines, 0);
    case "lua":
      return scanLuaFamily(lines, 0);
    case "elixir":
      return scanElixirFamily(lines, 0);
    case "r":
      return scanRFamily(lines, 0);
    case "zig":
      return scanZigFamily(lines, 0);
    case "sh":
      return scanShFamily(lines, 0);
    case "md":
      return scanMdFamily(lines, cs, 0);
    case "data":
      return scanDataFamily(lines, cs, 0);
    case "style":
      return scanStyleFamily(lines, cs, 0);
    case "html":
      return scanHtmlFamily(lines, cs, 0);
    case "sql":
      return scanSqlFamily(lines, cs, 0);
    case "ps":
      return scanPsFamily(lines, cs, 0);
    case "docker":
      return scanDockerFamily(lines, cs, 0);
    case "hs":
      return scanHsFamily(lines, cs, 0);
    case "clj":
      return scanCljFamily(lines, cs, 0);
    case "scala":
      return scanScalaFamily(lines, cs, 0);
    case "pl":
      return scanPlFamily(lines, cs, 0);
    case "objc":
      return scanObjcFamily(lines, cs, 0);
    case "graphql":
      return scanGraphqlFamily(lines, cs, 0);
    default:
      return [];
  }
}
function extractSymbols(absPath, content) {
  try {
    const family = FAMILY_OF[extNoDot(absPath)];
    if (!family || typeof content !== "string" || !content.length) return [];
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const rekind = REKIND[family] ?? NO_REKIND;
    if (family === "embed") {
      const out = [];
      for (const piece of embedPieces(lines)) {
        out.push(...finalize(piece.raw, piece.lines, piece.offset, rekind));
      }
      return out;
    }
    const style = family === "rs" ? "rs" : family === "ruby" || family === "sh" || family === "elixir" || family === "r" || family === "ps" || family === "docker" || family === "hs" || family === "clj" || family === "pl" || family === "graphql" || family === "data" ? "hash" : family === "lua" ? "lua" : "c";
    const cs = family === "md" || family === "html" ? lines : codeLines(lines, style);
    return finalize(scanFamily(family, lines, cs), lines, 0, rekind);
  } catch {
    return [];
  }
}
function extractImports(absPath, content) {
  try {
    const family = FAMILY_OF[extNoDot(absPath)];
    if (!family || typeof content !== "string" || !content.length) return [];
    const out = [];
    const push = (s) => {
      const v = String(s || "").trim();
      if (v && !out.includes(v)) out.push(v);
    };
    const lines = content.split("\n");
    switch (family) {
      case "js":
      case "embed": {
        const staticRe = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g;
        const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
        const reqRe = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;
        for (const re of [staticRe, dynRe, reqRe]) {
          let m = re.exec(content);
          while (m !== null) {
            push(m[1]);
            m = re.exec(content);
          }
        }
        break;
      }
      case "py": {
        for (const line of lines) {
          let m = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
          if (m) {
            for (const part of m[1].split(",")) push(part.trim().split(/\s+as\s+/)[0]);
            continue;
          }
          m = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "go": {
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (t === "import (") {
            for (i++; i < lines.length; i++) {
              if (lines[i].trim() === ")") break;
              const mm2 = /"([^"]+)"/.exec(lines[i]);
              if (mm2) push(mm2[1]);
            }
            continue;
          }
          const mm = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/.exec(lines[i]);
          if (mm) push(mm[1]);
        }
        break;
      }
      case "jvm": {
        for (const line of lines) {
          let m = /^\s*import\s+['"]([^'"]+)['"]/.exec(line);
          if (!m) m = /^\s*(?:import|using)\s+(?:static\s+)?([\w.*]+)\s*;/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "cpp": {
        for (const line of lines) {
          const m = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "rs": {
        for (const line of lines) {
          const m = /^\s*use\s+([\w:]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "php": {
        for (const line of lines) {
          let m = /^\s*use\s+([\w\\]+)/.exec(line);
          if (m) {
            push(m[1]);
            continue;
          }
          m = /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "ruby": {
        for (const line of lines) {
          const m = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "swift": {
        for (const line of lines) {
          const m = /^\s*(?:@testable\s+)?import\s+(\w+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "lua": {
        for (const line of lines) {
          const m = /^\s*(?:local\s+)?require\s*\(?\s*['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "elixir": {
        for (const line of lines) {
          const m = /^\s*(?:alias|import|require|use)\s+([A-Z][\w.]*)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "r": {
        for (const line of lines) {
          const m = /^\s*(?:library|require|source)\s*\(?\s*['"]?([\w./-]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "zig": {
        for (const line of lines) {
          const m = /@import\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "sh": {
        for (const line of lines) {
          const m = /^\s*(?:source|\.)\s+(\S+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      // ---------- heuristic-only families ----------
      case "style": {
        for (const line of lines) {
          let m = /@import\s+["']([^"']+)["']/.exec(line);
          if (!m) m = /url\(\s*["']?([^"')]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "html": {
        for (const line of lines) {
          let m = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(line);
          if (!m) m = /<link[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "sql": {
        for (const line of lines) {
          const m = /^\s*(?:\\i|SOURCE)\s+(\S+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "ps": {
        for (const line of lines) {
          const m = /^\s*Import-Module\s+([\w.-]+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "docker": {
        for (const line of lines) {
          const m = /^\s*FROM\s+(\S+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "hs": {
        for (const line of lines) {
          const m = /^\s*import\s+(?:qualified\s+)?([A-Z][\w.]*)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "clj": {
        for (const line of lines) {
          const ns = /^\s*\(\s*ns\s+([\w.-]+)/.exec(line);
          if (ns) {
            push(ns[1]);
            continue;
          }
          const req = /\[([\w.-]+)\]/.exec(line);
          if (req) push(req[1]);
        }
        break;
      }
      case "scala":
      case "objc": {
        for (const line of lines) {
          let m = /^\s*import\s+([\w.]+)/.exec(line);
          if (!m) m = /^\s*#import\s+[<"]([^>"]+)[>"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "pl": {
        for (const line of lines) {
          const m = /^\s*use\s+([\w:]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case "graphql": {
        for (const line of lines) {
          const m = /^\s*#\s*import\s+["']([^"']+)["']/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
var MAX_FILES = 8e3;
var MAX_UPDATE_MS = 6e4;
var MAX_FILE_BYTES = 512 * 1024;
var MAX_WALK_BYTES = 1e6;
var MAX_REF_HITS = 300;
var RAW_REF_CAP = 3e3;
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "out", "target", "__pycache__", ".venv", "venv", "coverage"]);
var ENTRY_POINT_RE = /(?:^|\/)(?:index|main|app|server|mod|__init__|__main__)\.[A-Za-z]+$/;
var JS_FAMILY_EXTS = /* @__PURE__ */ new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"]);
function rankSymbols(syms) {
  const KIND_WEIGHT = {
    class: 3,
    interface: 3,
    struct: 3,
    trait: 3,
    impl: 3,
    enum: 3,
    function: 2,
    method: 2,
    module: 1,
    type: 1,
    const: 1,
    variable: 1
  };
  return [...syms].sort((a, b) => (KIND_WEIGHT[b.kind] ?? 0) - (KIND_WEIGHT[a.kind] ?? 0) || a.line - b.line);
}
function topDirOf(rel) {
  const i = rel.indexOf("/");
  return i < 0 ? "." : rel.slice(0, i);
}
function baseNoExt(rel) {
  const last = rel.split("/").pop() ?? rel;
  return last.replace(/\.[^.]+$/, "");
}
function specifierTargets(spec, defBase) {
  if (!defBase) return false;
  const clean = spec.replace(/^[.]{1,2}\//, "").split(/[?#]/)[0].trim();
  const last = clean.split("/").pop() ?? "";
  const noExt = last.replace(/\.[A-Za-z0-9]+$/, "");
  return noExt === defBase || (noExt.split(".").pop() ?? "") === defBase;
}
function pathDepth(rel) {
  return rel.split("/").length;
}
var CodeIndex = class {
  root;
  /** absPath -> entry. absPath keys keep outline() cheap; relPath is derived for display. */
  files = /* @__PURE__ */ new Map();
  errorCount = 0;
  lastStats = { files: 0, scanned: 0, changed: 0, errors: 0, partial: false, durationMs: 0, langs: {} };
  jsDeps = null;
  constructor(root) {
    this.root = path.resolve(String(root || "."));
  }
  /**
   * Walks the workspace root and (re)indexed changed files. Incremental: a file
   * whose mtimeMs+size are unchanged since the previous run is skipped WITHOUT
   * a read. Caps at 8000 files / 60s — reports partial=true instead of hanging.
   */
  async update() {
    const t0 = Date.now();
    const stats = { files: this.files.size, scanned: 0, changed: 0, errors: this.errorCount, partial: false, durationMs: 0, langs: {} };
    try {
      const deadline = t0 + MAX_UPDATE_MS;
      const found = [];
      let truncated = false;
      const queue = [this.root];
      while (queue.length) {
        if (found.length >= MAX_FILES || Date.now() > deadline) {
          truncated = true;
          break;
        }
        const dir = queue.shift();
        let entries;
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          this.errorCount++;
          continue;
        }
        for (const ent of entries) {
          if (found.length >= MAX_FILES || Date.now() > deadline) {
            truncated = true;
            break;
          }
          if (ent.isDirectory()) {
            const name2 = ent.name;
            if (SKIP_DIRS.has(name2.toLowerCase())) continue;
            if (name2.startsWith(".") && name2 !== ".src") continue;
            queue.push(path.join(dir, name2));
            continue;
          }
          if (!ent.isFile()) continue;
          const name = ent.name;
          if (name.includes(".min.")) continue;
          if (!LANGS[extNoDot(name)]) continue;
          let st;
          try {
            st = await fsp.stat(path.join(dir, name));
          } catch {
            continue;
          }
          if (st.size > MAX_WALK_BYTES) continue;
          found.push(path.join(dir, name));
        }
      }
      if (!truncated) {
        const present = new Set(found);
        for (const abs of [...this.files.keys()]) {
          if (!present.has(abs)) this.files.delete(abs);
        }
      }
      for (const abs of found) {
        if (Date.now() > deadline) {
          stats.partial = true;
          break;
        }
        try {
          const st = await fsp.stat(abs);
          const prev = this.files.get(abs);
          if (prev && prev.size === st.size && Math.abs(prev.mtimeMs - st.mtimeMs) < 1) continue;
          const content = await fsp.readFile(abs, "utf8");
          if (Buffer.byteLength(content) > MAX_FILE_BYTES) continue;
          this.files.set(abs, {
            relPath: this.relOf(abs),
            mtimeMs: st.mtimeMs,
            size: st.size,
            lang: langOf(abs),
            symbols: extractSymbols(abs, content),
            imports: extractImports(abs, content)
          });
          stats.scanned++;
          stats.changed++;
        } catch {
          this.errorCount++;
        }
      }
      if (truncated) stats.partial = true;
      stats.files = this.files.size;
      stats.langs = this.langCounts();
    } catch {
      stats.partial = true;
      this.errorCount++;
    }
    stats.errors = this.errorCount;
    stats.durationMs = Date.now() - t0;
    this.lastStats = { ...stats, langs: { ...stats.langs } };
    return stats;
  }
  /** Current index state (files reflects the live map, errors the running total). */
  stats() {
    try {
      return { ...this.lastStats, files: this.files.size, errors: this.errorCount };
    } catch {
      return { files: 0, scanned: 0, changed: 0, errors: 0, partial: false, durationMs: 0, langs: {} };
    }
  }
  /**
   * Generic query entry point — currently an alias of findDefinitions.
   */
  query(q, opts) {
    return this.findDefinitions(q, opts);
  }
  /**
   * Symbol search: exact name match scores 3, prefix 2, substring 1.
   * Ties break by path depth, then line. Never throws.
   */
  findDefinitions(q, opts) {
    const out = [];
    try {
      const needle = String(q ?? "").trim().toLowerCase();
      if (!needle) return [];
      const limit = clampInt(opts?.limit, 1, 200, 20);
      const kind = opts?.kind ? String(opts.kind) : null;
      for (const entry of this.files.values()) {
        for (const sym of entry.symbols) {
          if (kind && sym.kind !== kind) continue;
          const nm = sym.name.toLowerCase();
          let score = 0;
          if (nm === needle) score = 3;
          else if (nm.startsWith(needle)) score = 2;
          else if (nm.includes(needle)) score = 1;
          if (!score) continue;
          out.push({ symbol: sym, relPath: entry.relPath, score });
        }
      }
      out.sort(
        (a, b) => b.score - a.score || pathDepth(a.relPath) - pathDepth(b.relPath) || a.symbol.line - b.symbol.line || a.symbol.name.localeCompare(b.symbol.name)
      );
      return out.slice(0, limit);
    } catch {
      this.errorCount++;
      return [];
    }
  }
  /**
   * Reference search over indexed files. Comment lines (// # *) and the
   * definition line(s) are excluded. Reads files from disk (bounded by the
   * 300-hit cap and a 3000-candidate ranking pool). Never throws.
   */
  findReferences(name, opts) {
    try {
      const needle = String(name ?? "").trim();
      if (!needle || needle.length > 200) return [];
      const limit = clampInt(opts?.limit, 1, MAX_REF_HITS, 50);
      const boundary = new RegExp(`\\b${escapeRegExp(needle)}\\b`);
      const declRe = new RegExp(
        `^\\s*(?:(?:export|default|async|pub|unsafe|local|abstract|final|open|static|public|private|protected|readonly)\\s+)*(?:def|function|fn|func)\\s*\\(?\\s*(?:self\\.)?${escapeRegExp(needle)}\\b`
      );
      const typeDeclRe = new RegExp(
        `^\\s*(?:(?:export|abstract|final|open|sealed|data|pub|static|public|private|protected|readonly)\\s+)*(?:class|struct|interface|trait|impl|enum|module|namespace|type)\\s+${escapeRegExp(needle)}\\b`
      );
      const raw = [];
      for (const [abs, entry] of this.files) {
        if (raw.length >= RAW_REF_CAP) break;
        let content;
        try {
          content = readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        const defLines = /* @__PURE__ */ new Set();
        for (const s of entry.symbols) {
          if (s.name === needle) defLines.add(s.line);
        }
        for (let i = 0; i < lines.length && raw.length < RAW_REF_CAP; i++) {
          const line = lines[i];
          if (!line.includes(needle)) continue;
          const t = line.trim();
          if (!t || t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*")) continue;
          if (defLines.has(i + 1) || declRe.test(line) || typeDeclRe.test(line)) continue;
          raw.push({ relPath: entry.relPath, line: i + 1, text: t.slice(0, 120), boundary: boundary.test(line) });
        }
      }
      raw.sort(
        (a, b) => Number(b.boundary) - Number(a.boundary) || pathDepth(a.relPath) - pathDepth(b.relPath) || a.relPath.localeCompare(b.relPath) || a.line - b.line
      );
      return raw.slice(0, limit).map(({ relPath, line, text }) => ({ relPath, line, text }));
    } catch {
      this.errorCount++;
      return [];
    }
  }
  /**
   * Blast radius: the definition of `name`, every referencing file, and which
   * of those files import the defining module. Never throws.
   */
  impactOf(name) {
    try {
      const hit = this.findDefinitions(name, { limit: 1 })[0];
      const symbol = hit ? hit.symbol : null;
      const refs = this.findReferences(name, { limit: MAX_REF_HITS });
      const byFile = /* @__PURE__ */ new Map();
      for (const r of refs) byFile.set(r.relPath, (byFile.get(r.relPath) ?? 0) + 1);
      const defRel = hit ? hit.relPath : null;
      if (defRel) byFile.set(defRel, byFile.get(defRel) ?? 0);
      const defBase = defRel ? baseNoExt(defRel) : "";
      const files = [];
      for (const [rel, n] of byFile) {
        const imports = rel === defRel || (defBase ? this.importsOf(rel).some((spec) => specifierTargets(spec, defBase)) : false);
        files.push({ relPath: rel, refs: n, imports });
      }
      files.sort(
        (a, b) => (a.relPath === defRel ? -1 : 0) - (b.relPath === defRel ? -1 : 0) || b.refs - a.refs || a.relPath.localeCompare(b.relPath)
      );
      const importers = files.filter((f) => f.imports && f.relPath !== defRel).length;
      const radius = files.length <= 2 ? "small" : files.length <= 8 ? "medium" : "large";
      const where = defRel ? `${defRel}:${symbol?.line ?? "?"}` : "?";
      const summary = `blast_radius name=${name} kind=${symbol?.kind ?? "unknown"} def=${where} files=${files.length} refs=${refs.length} importers=${importers} radius=${radius}`;
      return { symbol, files, summary };
    } catch {
      this.errorCount++;
      return { symbol: null, files: [], summary: "blast_radius unavailable (index error)" };
    }
  }
  /**
   * Importance-ranked repo map, grouped by top-level dir, hard-capped at
   * `budgetChars` with a '…' tail when truncated. Never throws.
   */
  repoMap(budgetChars = 4e3) {
    try {
      const budget = clampInt(budgetChars, 80, 2e5, 4e3);
      const rows = [];
      const jsBoost = this.hasJsDeps();
      for (const entry of this.files.values()) {
        const top = rankSymbols(entry.symbols).slice(0, 3);
        if (!top.length) continue;
        let weight = 1;
        if (ENTRY_POINT_RE.test(entry.relPath)) weight += 1;
        if (jsBoost && JS_FAMILY_EXTS.has(extNoDot(entry.relPath))) weight += 1;
        const depthPenalty = Math.max(0, pathDepth(entry.relPath) - 1) * 0.5;
        rows.push({
          dir: topDirOf(entry.relPath),
          score: entry.symbols.length * weight - depthPenalty,
          text: `${entry.relPath}: ${top.map((s) => `${s.name} (${s.line})`).join(", ")}`
        });
      }
      const dirAgg = /* @__PURE__ */ new Map();
      for (const r of rows) dirAgg.set(r.dir, (dirAgg.get(r.dir) ?? 0) + r.score);
      rows.sort((a, b) => (dirAgg.get(b.dir) ?? 0) - (dirAgg.get(a.dir) ?? 0) || b.score - a.score || a.text.localeCompare(b.text));
      const full = rows.map((r) => r.text).join("\n");
      if (full.length <= budget) return full;
      const taken = [];
      let used = 0;
      for (const r of rows) {
        const add = r.text.length + (taken.length ? 1 : 0);
        if (used + add > budget - 1) break;
        taken.push(r.text);
        used += add;
      }
      if (taken.length) return `${taken.join("\n")}\u2026`;
      return `${rows[0].text.slice(0, Math.max(1, budget - 1))}\u2026`;
    } catch {
      return "";
    }
  }
  /**
   * Indented symbol tree of one file with line numbers. Uses the index when
   * the file is unchanged, otherwise reads it. Never throws.
   */
  outline(absPath) {
    try {
      const abs = path.resolve(String(absPath ?? ""));
      let symbols = null;
      try {
        const st = statSync(abs);
        const prev = this.files.get(abs);
        if (prev && prev.size === st.size && Math.abs(prev.mtimeMs - st.mtimeMs) < 1) symbols = prev.symbols;
      } catch {
      }
      if (!symbols) {
        symbols = extractSymbols(abs, readFileSync(abs, "utf8"));
      }
      if (!symbols.length) return "(no symbols)";
      const sorted = [...symbols].sort((a, b) => a.line - b.line);
      const out = [path.basename(abs)];
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        let depth = 0;
        for (let j = 0; j < i; j++) {
          const t = sorted[j];
          if (CONTAINER_KINDS.has(t.kind) && t.line < s.line && s.line <= t.endLine) depth++;
        }
        out.push(`${"  ".repeat(depth)}${s.kind} ${s.name} (${s.line})`);
      }
      return out.join("\n");
    } catch {
      this.errorCount++;
      return "(outline unavailable)";
    }
  }
  // ---------- internals ----------
  relOf(abs) {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }
  importsOf(rel) {
    for (const entry of this.files.values()) {
      if (entry.relPath === rel) return entry.imports;
    }
    return [];
  }
  langCounts() {
    const counts = {};
    for (const entry of this.files.values()) {
      counts[entry.lang] = (counts[entry.lang] ?? 0) + 1;
    }
    return counts;
  }
  /** true when the workspace root has a package.json with dependencies — boosts JS-family files in repoMap. */
  hasJsDeps() {
    if (this.jsDeps !== null) return this.jsDeps;
    try {
      const pkg = JSON.parse(readFileSync(path.join(this.root, "package.json"), "utf8"));
      this.jsDeps = !!pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
    } catch {
      this.jsDeps = false;
    }
    return this.jsDeps;
  }
};
var HEURISTIC_LABEL = `HEURISTIC FALLBACK (${HEURISTIC_FALLBACKS.join(" / ")}; NOT LSP):`;
function symbolAtPosition(absPath, content, line, character) {
  try {
    const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
    const text = lines[Math.max(0, Math.floor(line) - 1)] ?? "";
    const target = Math.max(0, Math.floor(character) - 1);
    const re = /[A-Za-z_$][\w$]*/g;
    let m;
    let nearest = null;
    while ((m = re.exec(text)) !== null) {
      if (m.index <= target && target < m.index + m[0].length) return m[0];
      const dist = m.index - target;
      if (dist >= 0 && (!nearest || dist < nearest.dist)) nearest = { name: m[0], dist };
    }
    return nearest?.name ?? null;
  } catch {
    return null;
  }
}
function heuristicOutline(absPath, content, query, limit = 80) {
  try {
    const text = content ?? readFileSync(absPath, "utf8");
    const needle = String(query ?? "").trim().toLowerCase();
    const all = extractSymbols(absPath, text);
    const syms = needle ? all.filter((s) => s.name.toLowerCase().includes(needle)) : all;
    if (!syms.length) {
      return `symbol_outline found no symbols${needle ? ` matching "${query}"` : ""} in ${path.basename(String(absPath))}.`;
    }
    const cap = clampInt(limit, 1, 200, 80);
    const rows = syms.slice(0, cap).map(
      (s) => `  ${String(s.line).padStart(5)}  ${s.kind.padEnd(9)} ${s.name}${s.container ? ` (in ${s.container})` : ""}`
    );
    return `symbol_outline: ${syms.length} symbol(s)${syms.length > cap ? ` (showing ${cap})` : ""}:
${rows.join("\n")}`;
  } catch (err) {
    return `symbol_outline unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}
var fallbackIndexes = /* @__PURE__ */ new Map();
async function fallbackIndexFor(workspace) {
  const root = path.resolve(String(workspace || "."));
  let idx = fallbackIndexes.get(root);
  if (!idx) {
    idx = new CodeIndex(root);
    fallbackIndexes.set(root, idx);
  }
  await idx.update().catch(() => void 0);
  return idx;
}
async function heuristicFindReferences(workspace, name, limit = 50) {
  try {
    const idx = await fallbackIndexFor(workspace);
    return idx.findReferences(name, { limit: clampInt(limit, 1, MAX_REF_HITS, 50) });
  } catch {
    return [];
  }
}
async function heuristicRepoMap(workspace, budgetChars = 4e3) {
  try {
    const idx = await fallbackIndexFor(workspace);
    return idx.repoMap(budgetChars);
  } catch {
    return "(repo_map unavailable)";
  }
}
export {
  CodeIndex,
  HEURISTIC_LABEL,
  LANGS,
  extractImports,
  extractSymbols,
  fallbackIndexFor,
  heuristicFindReferences,
  heuristicOutline,
  heuristicRepoMap,
  symbolAtPosition
};
