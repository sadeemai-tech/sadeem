// ============================================================
// SADEEM v11.16 — LSP LANGUAGE SUPPORT MATRIX (single source of truth)
//
// The founder has repeatedly asked for "any language in existence" and for LSP
// to cover all languages. This file is the HONEST answer: it is the one registry
// consumed by BOTH lsp.ts (the real client) and the `lsp_languages` tool.
//
// HONESTY CONTRACT (never violated):
//   • A language appears under LSP_SERVERS only when a REAL language server
//     exists, has a concrete launch command, and is wired into lsp.ts.
//   • `install` is a declarative recipe only when the server can actually be
//     installed by that one command. `install: null` means MANUAL / external —
//     the client will never pretend to auto-install it.
//   • `externalBinary` names any runtime/binary (JDK, clangd, Ruby, .NET, ...)
//     that may be missing on this machine. We do not claim it is present.
//   • Languages with no feasible server are listed under HEURISTIC_ONLY, and
//     their fallback tools are named explicitly (HEURISTIC_FALLBACKS).
//   • No entry claims "supported" without a working launch path.
//
// Zero npm dependencies; safe to import from Electron, CLI and tests alike.
// ============================================================
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

/** Declarative install recipe, or null when the server must be installed manually. */
export type InstallRecipe = { exe: string; args: string[]; timeoutMs: number } | null;

export interface LanguageServerSpec {
  /** Stable key (also the auto-install cache key). */
  lang: string;
  /** Human-readable language name used by lsp_languages. */
  language: string;
  /** LSP textDocument languageId. */
  languageId: string;
  /** Lowercase file extensions (no leading dot). */
  exts: string[];
  /** LSP launch command (base name; lsp.ts resolves Windows .cmd shims). */
  command: string;
  /** Launch arguments. */
  args: string[];
  /** Exact package / distribution the server comes from. */
  package: string;
  /** Copy-pasteable install command or short steps. */
  installHint: string;
  /** One-command auto-install; null = manual/external (never auto-installed). */
  install: InstallRecipe;
  /** Markers used to walk up from the file to the project root. Prefix '*.' = extension. */
  rootFiles: string[];
  /** External runtime/binary that may be missing — reported honestly. */
  externalBinary?: string;
  /** Extra honest caveat (e.g. "first launch downloads the JVM bundle"). */
  note?: string;
}

/** A language with no wired real LSP server — heuristics only, named honestly. */
export interface HeuristicLanguage {
  language: string;
  exts: string[];
  note?: string;
}

const npm = (pkgs: string[], timeoutMs = 300_000): InstallRecipe => ({
  exe: 'npm', args: ['install', '-g', '--no-fund', '--no-audit', ...pkgs], timeoutMs,
});
const tool = (exe: string, args: string[], timeoutMs = 600_000): InstallRecipe => ({ exe, args, timeoutMs });

/**
 * Real, wired language servers. This array IS the support matrix — lsp.ts uses
 * the same specs to spawn clients, so the advertised list cannot drift from
 * what actually launches.
 */
export const LSP_SERVERS: LanguageServerSpec[] = [
  {
    lang: 'typescript', language: 'TypeScript / JavaScript', languageId: 'typescript',
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts'],
    command: 'typescript-language-server', args: ['--stdio'],
    package: 'npm:typescript-language-server, typescript',
    installHint: 'npm i -g typescript-language-server typescript',
    install: npm(['typescript-language-server', 'typescript']),
    rootFiles: ['package.json', 'tsconfig.json', 'jsconfig.json'],
    note: 'Runs on Node.js (the app runtime already provides it).',
  },
  {
    lang: 'python', language: 'Python', languageId: 'python',
    exts: ['py', 'pyi'],
    command: 'pyright-langserver', args: ['--stdio'],
    package: 'npm:pyright (or pip:pyright)',
    installHint: 'npm i -g pyright  (or: pip install pyright)',
    install: npm(['pyright']),
    rootFiles: ['pyrightconfig.json', 'pyproject.toml', 'setup.py', 'requirements.txt'],
    note: 'Pyright is Node-based; it does not need a Python interpreter to analyse code.',
  },
  {
    lang: 'go', language: 'Go', languageId: 'go',
    exts: ['go'],
    command: 'gopls', args: [],
    package: 'go:golang.org/x/tools/gopls@latest',
    installHint: 'go install golang.org/x/tools/gopls@latest',
    install: tool('go', ['install', 'golang.org/x/tools/gopls@latest']),
    rootFiles: ['go.mod', 'go.work'],
    externalBinary: 'Go toolchain (the `go` command must already be installed and on PATH).',
  },
  {
    lang: 'rust', language: 'Rust', languageId: 'rust',
    exts: ['rs'],
    command: 'rust-analyzer', args: [],
    package: 'rustup:rust-analyzer component',
    installHint: 'rustup component add rust-analyzer',
    install: tool('rustup', ['component', 'add', 'rust-analyzer']),
    rootFiles: ['Cargo.toml'],
    externalBinary: 'Rust toolchain + rustup (the `rustup` command must be installed).',
  },
  {
    lang: 'java', language: 'Java', languageId: 'java',
    exts: ['java'],
    command: 'jdtls', args: [],
    package: 'npm:jdtls (Eclipse JDT Language Server)',
    installHint: 'npm i -g jdtls  — requires a JDK 17+ on PATH (`java -version`)',
    install: npm(['jdtls'], 600_000),
    rootFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
    externalBinary: 'Java JDK 17+ (`java` on PATH). jdtls cannot run without it.',
    note: 'First launch may download the Eclipse JDT bundle; needs network access once.',
  },
  {
    lang: 'php', language: 'PHP', languageId: 'php',
    exts: ['php', 'phtml'],
    command: 'intelephense', args: ['--stdio'],
    package: 'npm:intelephense',
    installHint: 'npm i -g intelephense',
    install: npm(['intelephense']),
    rootFiles: ['composer.json'],
    note: 'Pure Node.js server; no PHP binary is required for analysis.',
  },
  {
    lang: 'ruby', language: 'Ruby', languageId: 'ruby',
    exts: ['rb', 'rake', 'gemspec'],
    command: 'solargraph', args: ['stdio'],
    package: 'gem:solargraph',
    installHint: 'gem install solargraph  — requires Ruby + RubyGems',
    install: tool('gem', ['install', 'solargraph']),
    rootFiles: ['Gemfile', '*.gemspec', '.ruby-version'],
    externalBinary: 'Ruby runtime + RubyGems (`ruby`, `gem` on PATH).',
  },
  {
    lang: 'cpp', language: 'C / C++', languageId: 'cpp',
    exts: ['c', 'h', 'cpp', 'cxx', 'cc', 'hpp', 'hh'],
    command: 'clangd', args: ['--background-index'],
    package: 'system:LLVM clangd (apt/brew/LLVM release)',
    installHint: 'apt install clangd   |   brew install llvm   |   download an LLVM release (clangd)',
    install: null, // system binary — never pretend npm/gem can install it
    rootFiles: ['compile_commands.json', 'CMakeLists.txt', '.clangd', 'Makefile'],
    externalBinary: 'clangd binary (part of LLVM). Not bundled — install via your OS package manager.',
    note: 'Best results with a compile_commands.json in the project root.',
  },
  {
    lang: 'csharp', language: 'C#', languageId: 'csharp',
    exts: ['cs'],
    command: 'csharp-ls', args: [],
    package: 'dotnet tool:csharp-ls',
    installHint: 'dotnet tool install -g csharp-ls  — requires the .NET SDK',
    install: tool('dotnet', ['tool', 'install', '-g', 'csharp-ls']),
    rootFiles: ['*.sln', '*.csproj', 'global.json'],
    externalBinary: '.NET SDK (`dotnet` on PATH). csharp-ls is a .NET global tool.',
  },
  {
    lang: 'kotlin', language: 'Kotlin', languageId: 'kotlin',
    exts: ['kt', 'kts'],
    command: 'kotlin-language-server', args: [],
    package: 'GitHub release:kotlin-language-server (jmfargas/gradle-kotlin-language-server fork)',
    installHint: 'Download a kotlin-language-server release ZIP from GitHub, unzip, add its bin/ to PATH — requires Java 11+',
    install: null, // distributed as a GitHub zip, not an npm/pip package
    rootFiles: ['settings.gradle.kts', 'build.gradle.kts', 'pom.xml', 'gradlew'],
    externalBinary: 'Java JRE/JDK 11+ (`java` on PATH) + the downloaded server binary.',
    note: 'Not installable with npm/pip; this build will NOT auto-install it.',
  },
  {
    lang: 'swift', language: 'Swift', languageId: 'swift',
    exts: ['swift'],
    command: 'sourcekit-lsp', args: [],
    package: 'Swift toolchain:sourcekit-lsp (ships with Swift / Xcode)',
    installHint: 'Install the Swift toolchain (or Xcode on macOS); sourcekit-lsp is included',
    install: null,
    rootFiles: ['Package.swift', '*.xcodeproj', '*.xcworkspace'],
    externalBinary: 'Swift toolchain / Xcode (`sourcekit-lsp` on PATH). Not available on stock Windows.',
  },
  {
    lang: 'dart', language: 'Dart', languageId: 'dart',
    exts: ['dart'],
    command: 'dart', args: ['language-server', '--protocol=lsp'],
    package: 'Dart SDK:dart (language-server is built in)',
    installHint: 'Install the Dart SDK; the `dart language-server` command is bundled',
    install: null,
    rootFiles: ['pubspec.yaml'],
    externalBinary: 'Dart SDK (`dart` on PATH).',
  },
  {
    lang: 'elixir', language: 'Elixir', languageId: 'elixir',
    exts: ['ex', 'exs', 'heex'],
    command: 'elixir-ls', args: [],
    package: 'GitHub release:elixir-ls (Jake Becker / elixir-lsp)',
    installHint: 'Download/build elixir-ls from GitHub releases, add its release/ dir to PATH',
    install: null,
    rootFiles: ['mix.exs'],
    externalBinary: 'Elixir + Erlang/OTP runtime (`elixir`, `erl` on PATH).',
    note: 'No npm/pip distribution; not auto-installed.',
  },
  {
    lang: 'r', language: 'R', languageId: 'r',
    exts: ['r', 'rmd'],
    command: 'Rscript', args: ['-e', 'languageserver::run()'],
    package: 'CRAN:languageserver',
    installHint: 'Rscript -e "install.packages(\'languageserver\')"  — requires R',
    install: null, // CRAN package, installed from inside R — not an npm/pip command
    rootFiles: ['*.Rproj', 'DESCRIPTION', '.Rprofile'],
    externalBinary: 'R runtime (`Rscript` on PATH).',
  },
  {
    lang: 'lua', language: 'Lua', languageId: 'lua',
    exts: ['lua'],
    command: 'lua-language-server', args: [],
    package: 'GitHub release:lua-language-server (sumneko/LuaLS)',
    installHint: 'Download lua-language-server from GitHub releases and add its bin/ to PATH',
    install: null,
    rootFiles: ['.luarc.json', 'lua.cfg', '.luarc.jsonc'],
    externalBinary: 'lua-language-server binary (prebuilt in the GitHub release).',
  },
  {
    lang: 'zig', language: 'Zig', languageId: 'zig',
    exts: ['zig', 'zon'],
    command: 'zls', args: [],
    package: 'GitHub release:zls (Zig Language Server)',
    installHint: 'Build or download zls from GitHub releases; place `zls` on PATH',
    install: null,
    rootFiles: ['build.zig', 'build.zig.zon'],
    externalBinary: 'Zig toolchain + the zls binary (match the zls build to your Zig version).',
  },
];

/**
 * Languages with NO wired real LSP server. For these the agent must use the
 * heuristic tools — their names are surfaced explicitly so the model still
 * works instead of pretending LSP intelligence exists.
 */
export const HEURISTIC_ONLY: HeuristicLanguage[] = [
  { language: 'Shell (bash / zsh)', exts: ['sh', 'bash', 'zsh'] },
  { language: 'Vue', exts: ['vue'] },
  { language: 'Svelte', exts: ['svelte'] },
  { language: 'Markdown', exts: ['md', 'mdx'] },
  { language: 'YAML', exts: ['yaml', 'yml'] },
  { language: 'JSON', exts: ['json', 'jsonc'] },
  { language: 'CSS / HTML', exts: ['css', 'scss', 'less', 'html', 'htm'] },
  { language: 'SQL', exts: ['sql'] },
  { language: 'PowerShell', exts: ['ps1', 'psm1'] },
  { language: 'Dockerfile', exts: ['dockerfile'] },
  { language: 'Haskell', exts: ['hs', 'lhs'] },
  { language: 'Clojure', exts: ['clj', 'cljs', 'cljc', 'edn'] },
  { language: 'Scala', exts: ['scala'] },
  { language: 'Perl', exts: ['pl', 'pm'] },
  { language: 'Objective-C', exts: ['m', 'mm'] },
  { language: 'GraphQL', exts: ['graphql', 'gql'] },
];

/** The heuristic fallback tools, named in every "no server" result. */
export const HEURISTIC_FALLBACKS = ['find_refs', 'symbol_outline', 'repo_map', 'search_files'] as const;

/** One reusable honest sentence for unsupported / missing-server results. */
export function heuristicSentence(): string {
  return `Honest fallback: ${HEURISTIC_FALLBACKS.join(' / ')} are heuristic but multi-language — use them; no LSP support is claimed for this file.`;
}

/** Resolve a file path to its wired server spec (by extension, case-insensitive). */
export function specForFile(file: string): LanguageServerSpec | null {
  const ext = path.extname(String(file || '')).slice(1).toLowerCase();
  if (!ext) return null;
  return LSP_SERVERS.find((s) => s.exts.includes(ext)) ?? null;
}

/** Is `ext` (no dot) covered by a wired server? */
export function hasRealServer(ext: string): boolean {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  return LSP_SERVERS.some((s) => s.exts.includes(e));
}

/**
 * Walk up from a file to find a project-root marker; fall back to `fallback`.
 * When `markers` is supplied (normally the matched server's rootFiles) ONLY
 * those markers count — so a PHP file cannot latch onto an unrelated ancestor
 * package.json. With no markers, the union of all known markers is used.
 */
export function detectRoot(file: string, fallback: string, markers?: string[]): string {
  try {
    const candidateMarkers = markers?.length
      ? markers
      : ['package.json', ...LSP_SERVERS.flatMap((s) => s.rootFiles)];
    const start = path.dirname(path.resolve(String(file || fallback || '.')));
    let dir = start;
    for (let i = 0; i < 40; i++) {
      for (const marker of candidateMarkers) {
        if (marker.startsWith('*.')) {
          const ext = marker.slice(1).toLowerCase();
          try {
            if (readdirSync(dir).some((n) => n.toLowerCase().endsWith(ext))) return dir;
          } catch { /* unreadable dir — keep walking */ }
        } else if (existsSync(path.join(dir, marker))) {
          return dir;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  return path.resolve(String(fallback || '.'));
}

export type LanguageMatch =
  | { kind: 'server'; spec: LanguageServerSpec }
  | { kind: 'heuristic'; entry: HeuristicLanguage }
  | null;

/** Look up a language by name, extension, or server command. */
export function findLanguage(query: string): LanguageMatch {
  const want = String(query || '').trim().toLowerCase().replace(/^\./, '');
  if (!want) return null;
  const spec = LSP_SERVERS.find((s) =>
    s.language.toLowerCase().includes(want) ||
    s.lang === want ||
    s.exts.includes(want) ||
    s.command.toLowerCase().includes(want),
  );
  if (spec) return { kind: 'server', spec };
  const entry = HEURISTIC_ONLY.find((h) =>
    h.language.toLowerCase().includes(want) || h.exts.includes(want),
  );
  if (entry) return { kind: 'heuristic', entry };
  return null;
}

/** Full honest matrix — the single text the lsp_languages tool should print. */
export function formatMatrix(): string {
  const lines: string[] = [
    'LSP LANGUAGE SUPPORT (honest — mirrors the configured language servers):',
    '', 'REAL LANGUAGE SERVERS WIRED:',
    ...LSP_SERVERS.map((s) => {
      const ext = `  ✓ ${s.language} [${s.exts.join(', ')}] → ${s.command} · install: ${s.installHint}`;
      return s.externalBinary ? `${ext}\n      ⚠ external binary required: ${s.externalBinary}` : ext;
    }),
    '', 'NOT WIRED (no real LSP server — use heuristic ' + HEURISTIC_FALLBACKS.join(' / ') + '):',
    ...HEURISTIC_ONLY.map((h) => `  ✗ ${h.language} [${h.exts.join(', ')}]`),
    '',
    `Tools that use the wired servers: lsp_definition, lsp_hover, lsp_diagnostics, lsp_references, lsp_rename, lsp_completion.`,
    `Heuristic fallbacks for every other language: ${HEURISTIC_FALLBACKS.join(', ')}.`,
    'A missing server is refused honestly with the exact install command — never faked. Pass language:"python" (etc.) to check one.',
  ];
  return lines.join('\n');
}

/** Single-language answer — mirrors the historical lsp_languages response. */
export function describeLanguage(query: string): string {
  const match = findLanguage(query);
  if (!match) {
    return `"${query}" is not in the LSP matrix. Wired: ${LSP_SERVERS.map((s) => s.language).join(', ')}. Everything else uses the heuristic ${HEURISTIC_FALLBACKS.join(' / ')} tools.`;
  }
  if (match.kind === 'server') {
    const s = match.spec;
    let out = `${s.language} (${s.exts.join(', ')}) IS wired to a real language server: ${s.command}. Install: ${s.installHint}. Use lsp_definition / lsp_hover / lsp_diagnostics / lsp_references / lsp_rename / lsp_completion.`;
    if (s.externalBinary) out += ` WARNING: needs external binary — ${s.externalBinary}`;
    if (s.note) out += ` Note: ${s.note}`;
    return out;
  }
  return `${match.entry.language} is NOT backed by a real LSP server in this build. ${heuristicSentence()}`;
}
