// Monaco setup: bundled workers (offline-safe) + Surnia theme.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

monaco.editor.defineTheme('surnia-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8F8A80', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C6D86A' },
    { token: 'string', foreground: 'B7CF45' },
    { token: 'number', foreground: 'CBB684' },
    { token: 'type', foreground: 'C4A97C' },
    { token: 'function', foreground: 'A8A8A5' },
    { token: 'variable', foreground: 'F2F0EA' },
  ],
  colors: {
    'editor.background': '#141413',
    'editor.foreground': '#EFEFEF',
    'editorGutter.background': '#141413',
    'editor.lineHighlightBackground': '#201f1d',
    'editorLineNumber.foreground': '#6c675e',
    'editorLineNumber.activeForeground': '#9ddc38',
    'editorCursor.foreground': '#9ddc38',
    'editor.selectionBackground': '#a9be5640',
    'editorIndentGuide.background1': '#33322e',
    'editorWidget.background': '#1d1c1a',
    'editorWidget.border': '#33322e',
    'scrollbarSlider.background': '#f4f2ed21',
    'minimap.background': '#141413',
  },
});

monaco.editor.defineTheme('surnia-light', {
  base: 'vs',
  inherit: true,
  rules: [{ token: 'comment', foreground: '8A887C', fontStyle: 'italic' }],
  colors: {
    'editor.background': '#F8F8F8',
    'editor.foreground': '#283B0A',
    'editorGutter.background': '#F8F8F8',
    'editor.lineHighlightBackground': '#EEEEEE',
    'editorLineNumber.foreground': '#ADADAD',
  },
});

// midnight app shell (#100f0f) + Flexoki Ink tones — distinct from surnia-dark,
// which paints obsidian surfaces inside the light-black midnight chrome.
monaco.editor.defineTheme('surnia-midnight', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6F6E69', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'D0A215' }, // amber
    { token: 'string', foreground: 'A3B25F' }, // sage green
    { token: 'number', foreground: 'D14D41' }, // red
    { token: 'type', foreground: '58A99B' }, // teal
    { token: 'function', foreground: '58A99B' },
    { token: 'variable', foreground: 'CECDC3' }, // ink
  ],
  colors: {
    'editor.background': '#0d0d0c',
    'editor.foreground': '#D1EFA2',
    'editorGutter.background': '#0d0d0c',
    'editor.lineHighlightBackground': '#171716',
    'editorLineNumber.foreground': '#4A4845',
    'editorLineNumber.activeForeground': '#9CDB36',
    'editorCursor.foreground': '#9CDB36',
    'editor.selectionBackground': '#A3B25F42', // rgba(156, 219, 54, 0.26)
    'editorIndentGuide.background1': '#262626',
    'editorWidget.background': '#1C1A17',
    'editorWidget.border': '#343331',
    'scrollbarSlider.background': '#D8D3C51F',
    'minimap.background': '#12100F',
  },
});

export function monacoThemeFor(theme: string): string {
  if (theme === 'light') return 'surnia-light';
  if (theme === 'midnight') return 'surnia-midnight';
  return 'surnia-dark';
}

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
    md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
    php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml',
    toml: 'ini', ini: 'ini', sql: 'sql', xml: 'xml', svg: 'xml', vue: 'html',
    dart: 'dart', lua: 'lua', pl: 'perl', r: 'r', dockerfile: 'dockerfile',
    makefile: 'shell', env: 'ini', txt: 'plaintext', gradle: 'groovy', prisma: 'typescript',
  };
  return map[ext] ?? 'plaintext';
}

export { monaco };
