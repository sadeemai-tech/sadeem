// ============================================================
// SADEEM settings — search registry.
// A flat, bilingual (EN/AR) index of every settings control.
// SettingsModal filters this list; clicking a hit jumps to the
// owning section. Keep entries in sync with the section files.
// SURVEYOR v4: 'providers' is a first-class pane (04) beside
// 'models' (03); the SecurityPanel mount lives under 'privacy'
// (12 — Privacy & Security).
// ============================================================

export type SettingsNavId =
  | 'general'
  | 'appearance'
  | 'models'
  | 'providers'
  | 'agent'
  | 'mcp'
  | 'terminal'
  | 'editor'
  | 'preview'
  | 'apiServer'
  | 'billing'
  | 'notifications'
  | 'privacy'
  | 'advanced'
  | 'memory'
  | 'feedback'
  // v10.3 — flat Codex-style sections
  | 'voice'
  | 'plugins'
  | 'git'
  | 'account'
  | 'shortcuts'
  // v11.4 — dedicated panes
  | 'logs'
  | 'evidence'
  // v11.10 — approvals manager
  | 'approvals'
  // v1131 — these panes already exist in SettingsModal but had no registry id
  | 'updates'
  | 'remote';

export interface SettingEntry {
  /** Stable id (for tests / future deep-linking). */
  id: string;
  /** Section that owns the control. */
  section: SettingsNavId;
  /** English label. */
  en: string;
  /** Arabic label. */
  ar: string;
  /** Extra match terms (both languages, lowercase). */
  keywords: string[];
}

export const SETTINGS_REGISTRY: SettingEntry[] = [
  // ---- general (01) ----
  { id: 'general.language', section: 'general', en: 'Interface language', ar: 'لغة الواجهة', keywords: ['language', 'lang', 'arabic', 'english', 'عربي', 'إنجليزي', 'locale'] },
  { id: 'general.theme', section: 'general', en: 'Theme', ar: 'السمة', keywords: ['theme', 'dark', 'light', 'obsidian', 'midnight', 'سمة', 'داكن', 'فاتح', 'appearance'] },
  { id: 'general.permissions', section: 'general', en: 'Default permission mode', ar: 'وضع الأذونات الافتراضي', keywords: ['permission', 'mode', 'plan', 'ask', 'auto-edit', 'full access', 'أذونات', 'وضع', 'أمان'] },
  { id: 'general.checkpoints', section: 'general', en: 'Checkpoints before agent edits', ar: 'نقاط استعادة قبل تعديلات الوكيل', keywords: ['checkpoint', 'snapshot', 'restore', 'undo', 'استعادة', 'نسخة'] },
  { id: 'general.onboarding', section: 'general', en: 'Re-run onboarding tour', ar: 'إعادة جولة الترحيب', keywords: ['onboarding', 'tour', 'welcome', 'setup', 'ترحيب', 'جولة'] },
  { id: 'general.recent', section: 'general', en: 'Recent projects', ar: 'المشاريع الأخيرة', keywords: ['recent', 'paths', 'folders', 'workspace', 'أحدث', 'مسار', 'مجلدات'] },

  // ---- appearance (02) ----
  { id: 'appearance.theme', section: 'appearance', en: 'Theme — obsidian, midnight, light', ar: 'السمة — أوبسيديان، منتصف الليل، فاتح', keywords: ['theme', 'dark', 'light', 'obsidian', 'midnight', 'paper', 'palette', 'swatch', 'سمة', 'داكن', 'فاتح', 'لوحة'] },
  { id: 'appearance.language', section: 'appearance', en: 'Interface language (EN/AR)', ar: 'لغة الواجهة (إنجليزي/عربي)', keywords: ['language', 'english', 'arabic', 'rtl', 'locale', 'لغة', 'عربي', 'إنجليزي'] },
  { id: 'appearance.preview', section: 'appearance', en: 'Live appearance preview', ar: 'معاينة المظهر الحيّة', keywords: ['preview', 'live', 'mock', 'mini window', 'معاينة', 'مباشر'] },
  { id: 'appearance.glass', section: 'appearance', en: 'Glass intensity', ar: 'شدة الزجاج', keywords: ['glass', 'blur', 'frost', 'transparency', 'liquid glass', 'opacity', 'زجاج', 'ضباب', 'شفافية'] },
  { id: 'appearance.glassLevels', section: 'appearance', en: 'Glass level — off, soft, medium, strong', ar: 'مستوى الزجاج — إيقاف، خفيف، متوسط، قوي', keywords: ['glass off', 'glass strong', 'blur level', 'medium', 'قوي', 'متوسط'] },
  { id: 'appearance.ambient', section: 'appearance', en: 'Ambient glow (aurora backdrop)', ar: 'التوهج المحيطي (خلفية الشفق)', keywords: ['ambient', 'glow', 'aurora', 'backdrop', 'background light', 'توهج', 'شفق', 'خلفية'] },
  { id: 'appearance.specular', section: 'appearance', en: 'Specular glass edges (v7)', ar: 'الحواف الزجاجية العاكسة (v7)', keywords: ['specular', 'edges', 'highlights', 'chrome', 'glass v7', 'عاكس', 'حواف', 'بريق'] },
  { id: 'appearance.layout', section: 'appearance', en: 'Layout & density', ar: 'التخطيط والكثافة', keywords: ['layout', 'density', 'compact', 'chat width', 'transcript measure', 'تخطيط', 'كثافة', 'عرض'] },
  { id: 'appearance.fontSize', section: 'appearance', en: 'Editor font size', ar: 'حجم خط المحرر', keywords: ['font', 'size', 'editor', 'text', 'خط', 'حجم', 'محرر'] },
  { id: 'appearance.termFontSize', section: 'appearance', en: 'Terminal font size', ar: 'حجم خط الطرفية', keywords: ['font', 'terminal', 'size', 'خط', 'طرفية'] },
  { id: 'appearance.compact', section: 'appearance', en: 'Compact density', ar: 'كثافة مضغوطة', keywords: ['compact', 'density', 'spacing', 'layout', 'مضغوط', 'كثافة'] },
  { id: 'appearance.chatWidth', section: 'appearance', en: 'Transcript width', ar: 'عرض سجل المحادثة', keywords: ['transcript', 'chat width', 'cozy', 'wide', 'full', 'measure', 'column', 'عرض', 'محادثة', 'عمود'] },
  { id: 'appearance.reduceMotion', section: 'appearance', en: 'Reduce motion & animations', ar: 'تقليل الحركة والانتقالات', keywords: ['motion', 'animation', 'transition', 'accessibility', 'a11y', 'حركة', 'انتقالات'] },
  { id: 'appearance.motionSpeed', section: 'appearance', en: 'Animation speed', ar: 'سرعة الحركة', keywords: ['speed', 'animation speed', 'fast', 'slow', 'motion scale', 'سرعة', 'بطء'] },
  { id: 'appearance.reset', section: 'appearance', en: 'Reset appearance to defaults', ar: 'استعادة إعدادات المظهر الافتراضية', keywords: ['reset', 'restore', 'defaults', 'reset appearance', 'استعادة', 'ضبط', 'افتراضي'] },

  // ---- models (03) ----
  { id: 'models.active', section: 'models', en: 'Active model', ar: 'النموذج النشط', keywords: ['model', 'active', 'provider', 'نموذج'] },
  { id: 'models.modelId', section: 'models', en: 'Model id', ar: 'معرّف النموذج', keywords: ['model', 'id', 'claude', 'gpt', 'معرف'] },
  { id: 'models.reasoning', section: 'models', en: 'Reasoning depth', ar: 'عمق الاستدلال', keywords: ['reasoning', 'thinking', 'effort', 'budget', 'استدلال', 'تفكير'] },
  { id: 'models.maxTokens', section: 'models', en: 'Max output tokens', ar: 'الحد الأقصى لمخرجات التوكنات', keywords: ['tokens', 'output', 'limit', 'توكن'] },
  { id: 'models.temperature', section: 'models', en: 'Temperature', ar: 'الحرارة', keywords: ['temperature', 'creativity', 'deterministic', 'حرارة'] },

  // ---- providers (04) ----
  { id: 'models.provider', section: 'providers', en: 'Provider', ar: 'المزوّد', keywords: ['provider', 'anthropic', 'openai', 'openrouter', 'ollama', 'gemini', 'zai', 'glm', 'deepseek', 'custom', 'مزود'] },
  { id: 'models.apiKeys', section: 'providers', en: 'API keys & providers', ar: 'مفاتيح API والمزودون', keywords: ['api', 'key', 'secret', 'token', 'base url', 'verify', 'مفتاح', 'تحقق'] },
  { id: 'models.liveList', section: 'providers', en: 'Live model list', ar: 'قائمة النماذج الحيّة', keywords: ['models', 'list', 'fetch', 'live', 'نماذج'] },

  // ---- agent (05) ----
  { id: 'agent.maxTurns', section: 'agent', en: 'Max turns per run', ar: 'أقصى دورات لكل تشغيل', keywords: ['turns', 'loop', 'iterations', 'agent', 'دورات'] },
  { id: 'agent.promptCaching', section: 'agent', en: 'Prompt caching', ar: 'تخزين السياق مؤقتاً', keywords: ['cache', 'caching', 'prompt', 'cost', 'anthropic', 'تخزين'] },
  { id: 'agent.parallel', section: 'agent', en: 'Parallel tool calls', ar: 'أدوات متوازية', keywords: ['parallel', 'tools', 'concurrent', 'متوازي'] },
  { id: 'agent.maxRetries', section: 'agent', en: 'Retries on rate limit', ar: 'المحاولات عند ضغط المزوّد', keywords: ['retry', 'retries', 'rate limit', '429', 'محاولات'] },
  { id: 'agent.autoCompact', section: 'agent', en: 'Auto-compact long sessions', ar: 'ضغط الجلسات الطويلة تلقائياً', keywords: ['compact', 'context', 'threshold', 'summary', 'ضغط'] },
  { id: 'agent.autoApprove', section: 'agent', en: 'Auto-approve file edits', ar: 'موافقة تلقائية على تعديل الملفات', keywords: ['approve', 'auto', 'edits', 'permission', 'موافقة'] },
  { id: 'agent.autoVerify', section: 'agent', en: 'Auto-verify after edits', ar: 'تحقق تلقائي بعد التعديلات', keywords: ['verify', 'build', 'test', 'typecheck', 'after edits', 'تحقق', 'بناء'] },
  { id: 'agent.dangerGate', section: 'agent', en: 'Dangerous-command policy', ar: 'سياسة الأوامر الخطرة', keywords: ['dangerous', 'danger gate', 'always ask', 'risky', 'command', 'خطر', 'أوامر'] },
  { id: 'agent.router', section: 'agent', en: 'Model router', ar: 'موجّه النماذج', keywords: ['router', 'model roles', 'plan model', 'search model', 'edit model', 'verifier model', 'provider family', 'موجّه', 'أدوار', 'نماذج'] },
  { id: 'agent.verifierPosture', section: 'agent', en: 'Verifier posture — fail-open / fail-closed', ar: 'موقف المُتحقِّق — متساهل / صارم', keywords: ['verifier', 'posture', 'fail-open', 'fail-closed', 'strict', 'lenient', 'تحقق', 'صارم', 'متساهل'] },
  { id: 'agent.allowlist', section: 'agent', en: 'Network allowlist', ar: 'قائمة الشبكة المسموحة', keywords: ['network', 'allowlist', 'hosts', 'domains', 'http_request', 'firewall', 'policy', 'شبكة', 'مضيفون', 'سياسة'] },

  // ---- preview (09) ----
  { id: 'preview.autoDetect', section: 'preview', en: 'Auto-detect dev servers', ar: 'اكتشاف تلقائي لسيرفرات التطوير', keywords: ['dev server', 'detect', 'vite', 'preview', 'اكتشاف'] },
  { id: 'preview.deviceFrame', section: 'preview', en: 'Device frame by default', ar: 'إطار الجهاز افتراضياً', keywords: ['device', 'frame', 'mobile', 'responsive', 'جهاز'] },
  { id: 'preview.console', section: 'preview', en: 'Show console panel', ar: 'إظهار لوحة وحدة التحكم', keywords: ['console', 'logs', 'debug', 'كونسول'] },
  { id: 'preview.autoRefresh', section: 'preview', en: 'Auto-refresh on file changes', ar: 'تحديث تلقائي عند تغيّر الملفات', keywords: ['refresh', 'reload', 'hot', 'تحديث'] },
  { id: 'preview.zoom', section: 'preview', en: 'Zoom level', ar: 'مستوى التكبير', keywords: ['zoom', 'scale', 'تكبير'] },

  // ---- mcp (06) ----
  { id: 'mcp.summary', section: 'mcp', en: 'MCP servers & tools summary', ar: 'ملخص خوادم وأدوات MCP', keywords: ['mcp', 'servers', 'tools', 'model context protocol', 'خوادم', 'أدوات'] },
  { id: 'mcp.openPanel', section: 'mcp', en: 'Open MCP panel', ar: 'فتح لوحة MCP', keywords: ['mcp', 'panel', 'registry', 'presets', 'لوحة'] },

  // ---- terminal (07) ----
  { id: 'terminal.fontSize', section: 'terminal', en: 'Terminal font size', ar: 'حجم خط الطرفية', keywords: ['terminal', 'font', 'size', 'طرفية', 'خط'] },
  { id: 'terminal.shell', section: 'terminal', en: 'Default shell', ar: 'الصدفة الافتراضية', keywords: ['shell', 'bash', 'zsh', 'powershell', 'pwsh', 'cmd', 'wsl', 'pty', 'صدفة'] },
  { id: 'terminal.scrollback', section: 'terminal', en: 'Terminal scrollback', ar: 'سجل التمرير في الطرفية', keywords: ['scrollback', 'buffer', 'lines', 'terminal', 'history', 'تمرير', 'سجل'] },
  { id: 'terminal.guard', section: 'terminal', en: 'Command guard', ar: 'حارس الأوامر', keywords: ['command guard', 'guard', 'block', 'dangerous', 'terminal', 'حارس', 'أوامر'] },

  // ---- editor (08) ----
  { id: 'editor.inlineSuggestions', section: 'editor', en: 'Inline ghost suggestions', ar: 'اقتراحات شبحية سطرية', keywords: ['inline', 'ghost', 'autocomplete', 'copilot', 'completion', 'اقتراحات', 'إكمال'] },
  { id: 'editor.minimap', section: 'editor', en: 'Minimap', ar: 'الخريطة المصغرة', keywords: ['minimap', 'outline', 'خريطة'] },
  { id: 'editor.wordWrap', section: 'editor', en: 'Word wrap', ar: 'التفاف الأسطر', keywords: ['wrap', 'word', 'lines', 'التفاف'] },
  { id: 'editor.tabSize', section: 'editor', en: 'Tab size (2 / 4 / 8)', ar: 'حجم الجدولة (2 / 4 / 8)', keywords: ['tab', 'size', 'indent', 'width', 'جدولة', 'إزاحة'] },
  { id: 'editor.fontSize', section: 'editor', en: 'Editor font size (10–22)', ar: 'حجم خط المحرر (10–22)', keywords: ['font', 'size', 'editor', 'text', 'خط', 'حجم'] },
  { id: 'editor.indentGuides', section: 'editor', en: 'Indent guides', ar: 'خطوط الإزاحة', keywords: ['indent', 'guides', 'rulers', 'tabs', 'spaces', 'مسافة', 'إزاحة'] },

  // ---- api server (10) ----
  { id: 'apiServer.enable', section: 'apiServer', en: 'Enable API server', ar: 'تفعيل خادم API', keywords: ['api', 'server', 'http', 'loopback', 'bearer', 'token', 'curl', 'خادم'] },
  { id: 'apiServer.port', section: 'apiServer', en: 'API server port', ar: 'منفذ خادم API', keywords: ['port', 'server', 'منفذ'] },

  // ---- billing / account & data (14) ----
  { id: 'billing.plan', section: 'billing', en: 'Plan & subscription', ar: 'الخطة والاشتراك', keywords: ['billing', 'plan', 'subscription', 'upgrade', 'license', 'فوترة', 'اشتراك'] },
  { id: 'billing.profile', section: 'billing', en: 'Local profile', ar: 'الملف المحلي', keywords: ['profile', 'account', 'name', 'email', 'local', 'device', 'ملف', 'حساب', 'محلي', 'جهاز'] },
  { id: 'billing.license', section: 'billing', en: 'License & plan status', ar: 'حالة الترخيص والخطة', keywords: ['license', 'plan', 'status', 'pro', 'team', 'free', 'trial', 'perpetual', 'ترخيص', 'خطة', 'تجربة', 'دائم'] },
  { id: 'billing.activate', section: 'billing', en: 'Activate a license key', ar: 'تفعيل مفتاح الترخيص', keywords: ['activate', 'key', 'KDX', 'offline', 'license key', 'تفعيل', 'مفتاح'] },
  { id: 'billing.endpoint', section: 'billing', en: 'License endpoint', ar: 'نقطة التحقق من الترخيص', keywords: ['endpoint', 'license server', 'url', 'activation', 'نقطة', 'رابط', 'تحقق'] },
  { id: 'billing.usage', section: 'billing', en: "This month's usage", ar: 'استخدام هذا الشهر', keywords: ['usage', 'month', 'tokens', 'runs', 'cost', 'session', 'استخدام', 'شهري', 'توكن', 'تكلفة'] },
  { id: 'billing.export', section: 'billing', en: 'Export local data (ZIP)', ar: 'تصدير البيانات المحلية (ZIP)', keywords: ['export', 'data', 'backup', 'zip', 'json', 'تصدير', 'بيانات', 'نسخة'] },
  // v1131 — honest launch policy: no monthly plan, no checkout, no Stripe key.
  // The Pro/Team cards, "$X/mo" prices and the secret-key field were removed
  // from the UI; a stale search hit here would have advertised them anyway.
  { id: 'billing.plans', section: 'billing', en: 'Plans & pricing — free season', ar: 'الخطط والأسعار — موسم مجاني', keywords: ['plans', 'free season', 'pricing', 'license', 'لا اشتراك', 'خطط', 'أسعار'] },

  // ---- notifications (11) ----
  { id: 'notifications.done', section: 'notifications', en: 'Notify when agent finishes', ar: 'إشعار عند انتهاء الوكيل', keywords: ['notification', 'notify', 'finish', 'done', 'toast', 'إشعار'] },
  { id: 'notifications.tray', section: 'notifications', en: 'Close to system tray', ar: 'الإغلاق إلى شريط النظام', keywords: ['tray', 'close', 'minimize', 'background', 'شريط', 'إغلاق'] },

  // ---- privacy & security (12) ----
  { id: 'privacy.security', section: 'privacy', en: 'Security panel & audit trail', ar: 'لوحة الأمان وسجل التدقيق', keywords: ['security', 'panel', 'audit', 'guard', 'redaction', 'symlink', 'أمان', 'تدقيق'] },
  { id: 'privacy.telemetry', section: 'privacy', en: 'Telemetry policy', ar: 'سياسة القياس عن بُعد', keywords: ['telemetry', 'privacy', 'tracking', 'local', 'خصوصية'] },
  { id: 'privacy.memory', section: 'privacy', en: 'Global memory', ar: 'الذاكرة العامة', keywords: ['memory', 'memo', 'context', 'MEMORY.md', 'ذاكرة'] },
  { id: 'privacy.usageData', section: 'privacy', en: 'Local usage data', ar: 'بيانات الاستخدام المحلية', keywords: ['usage', 'data', 'clear', 'history', 'استخدام'] },

  // ---- advanced (13) ----
  { id: 'advanced.usageStats', section: 'advanced', en: 'Usage statistics', ar: 'إحصاءات الاستخدام', keywords: ['usage', 'runs', 'tokens', 'cost', 'stats', 'إحصاء'] },
  { id: 'advanced.danger', section: 'advanced', en: 'Danger zone — clear data, reset settings', ar: 'منطقة الخطر — مسح البيانات وإعادة الضبط', keywords: ['reset', 'danger', 'clear', 'wipe', 'defaults', 'خطر', 'ضبط'] },
  { id: 'advanced.env', section: 'advanced', en: 'SADEEM environment variables', ar: 'متغيرات بيئة سديم', keywords: ['env', 'environment', 'KODEX_HOME', 'KODEX_ENABLE_GPU', 'KODEX_SMOKE', 'بيئة'] },
  { id: 'advanced.about', section: 'advanced', en: 'About SADEEM', ar: 'حول سديم', keywords: ['about', 'version', 'tech stack', 'حول', 'إصدار'] },
];

/** Case-insensitive bilingual filter over label + keywords. */
export function searchSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [...SETTINGS_REGISTRY, ...V5_ENTRIES, ...V6_ENTRIES, ...V102_ENTRIES, ...V103_ENTRIES, ...V114_ENTRIES, ...V1110_ENTRIES, ...V1131_ENTRIES].filter((e) => {
    if (e.en.toLowerCase().includes(q) || e.ar.includes(q)) return true;
    return e.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

// ============================================================
// v5.0.0 — Skills & Memory section entries
// ============================================================
export const V5_ENTRIES: SettingEntry[] = [
  { id: 'memory.section', section: 'memory', en: 'Skills & memory', ar: 'المهارات والذاكرة', keywords: ['skills', 'memory', 'learn', 'مهارات', 'ذاكرة', 'تعلم'] },
  { id: 'memory.skills.manage', section: 'memory', en: 'Open the skills manager', ar: 'فتح مدير المهارات', keywords: ['skills manager', 'library', 'import', 'مدير المهارات', 'مكتبة'] },
  { id: 'memory.skills.trust', section: 'memory', en: 'Trust workspace skills', ar: 'الثقة بمهارات مساحة العمل', keywords: ['trust', 'skills', 'security', 'ثقة', 'أمان'] },
  { id: 'memory.auto', section: 'memory', en: 'Auto-learning after runs', ar: 'التعلم التلقائي بعد التشغيلات', keywords: ['auto memory', 'learn', 'MEMORY.md', 'DNA', 'تعلم تلقائي'] },
  { id: 'memory.global', section: 'memory', en: 'Global memory text', ar: 'الذاكرة العالمية', keywords: ['global memory', 'always know', 'ذاكرة عالمية'] },
];

// ============================================================
// v6 — Suggestions & Contact section entries
// ============================================================
export const V6_ENTRIES: SettingEntry[] = [
  { id: 'feedback.section', section: 'feedback', en: 'Suggestions & contact', ar: 'الاقتراحات والتواصل', keywords: ['feedback', 'suggestions', 'contact', 'report', 'bug', 'feature request', 'اقتراحات', 'تواصل', 'مشكلة', 'ملاحظات'] },
  { id: 'feedback.send', section: 'feedback', en: 'Send a suggestion', ar: 'إرسال اقتراح', keywords: ['send', 'suggest', 'submit', 'إرسال', 'اقتراح'] },
  { id: 'feedback.history', section: 'feedback', en: 'Your submissions', ar: 'اقتراحاتك المرسلة', keywords: ['history', 'submissions', 'sent', 'سجل'] },
  { id: 'feedback.contact', section: 'feedback', en: 'Contact the team', ar: 'التواصل مع الفريق', keywords: ['contact', 'email', 'support', 'تواصل', 'دعم'] },
];
// ---------- v10.2 voice input ----------
export const V102_ENTRIES: SettingEntry[] = [
  { id: 'voice.asrProvider', section: 'voice', en: 'Voice transcription provider', ar: 'مزوّد تفريغ الصوت', keywords: ['voice', 'microphone', 'mic', 'speech', 'transcription', 'whisper', 'asr', 'glm-asr', 'dictation', 'صوت', 'ميكروفون', 'إملاء'] },
  { id: 'voice.asrModel', section: 'voice', en: 'Voice model override', ar: 'تجاوز نموذج الصوت', keywords: ['voice model', 'whisper-1', 'whisper-large-v3', 'glm-asr-2512', 'asr model', 'نموذج صوت'] },
  // v10.2 worktrees & git — section 'git' since v10.3's dedicated pane
  { id: 'git.worktree', section: 'git', en: 'Worktrees — parallel task trees', ar: 'أشجار العمل — مهام متوازية', keywords: ['worktree', 'git', 'branch', 'parallel', 'merge', 'ورك تري', 'تفرع', 'دمج'] },
];

// ---------- v10.3 sections (flat Codex-style panes) ----------
export const V103_ENTRIES: SettingEntry[] = [
  { id: 'shortcuts.sheet', section: 'shortcuts', en: 'Keyboard shortcuts', ar: 'اختصارات لوحة المفاتيح', keywords: ['shortcuts', 'keyboard', 'hotkeys', 'keybindings', 'cheatsheet', 'اختصارات', 'لوحة المفاتيح'] },
  // v11.4 — rebindable shortcuts
  { id: 'shortcuts.rebind', section: 'shortcuts', en: 'Rebind actions — change keys, reset all', ar: 'إعادة ربط الأفعال — تغيير المفاتيح واستعادتها', keywords: ['rebind', 'remap', 'change shortcut', 'keybinding', 'reset', 'إعادة', 'ربط', 'تغيير'] },
  { id: 'preview.customCommand', section: 'preview', en: 'Custom dev-server command (any runtime)', ar: 'أمر خادم مخصص (أي بيئة تشغيل)', keywords: ['custom command', 'go run', 'python', 'django', 'flask', 'fastapi', 'uvicorn', 'dev server', 'أمر مخصص', 'بايثون'] },
  { id: 'voice.test', section: 'voice', en: 'Live voice test — record and transcribe', ar: 'اختبار صوتي حي — سجّل وفرّغ', keywords: ['voice test', 'record', 'test microphone', 'اختبار الصوت', 'تسجيل'] },
  { id: 'artifacts.proof', section: 'evidence', en: 'Proof Center — verifiable session evidence', ar: 'مركز الإثبات — أدلة جلسة قابلة للتحقق', keywords: ['proof', 'artifacts', 'evidence', 'export', 'إثبات', 'أدلة'] },
  { id: 'library.wiki', section: 'general', en: 'Repo Wiki (inside Library)', ar: 'ويكي المستودع (داخل المكتبة)', keywords: ['wiki', 'library', 'architecture', 'docs', 'ويكي', 'مكتبة'] },
];

// ---------- v11.4 — logs / evidence / voice additions ----------
export const V114_ENTRIES: SettingEntry[] = [
  { id: 'logs.level', section: 'logs', en: 'Log level — debug, info, warn, error', ar: 'مستوى السجل — تصحيح، معلومات، تحذير، خطأ', keywords: ['log', 'level', 'debug', 'info', 'warn', 'error', 'diagnostics', 'سجل', 'مستوى'] },
  { id: 'logs.openFolder', section: 'logs', en: 'Open log folder', ar: 'فتح مجلد السجل', keywords: ['log', 'folder', 'main.log', 'open', 'reveal', 'مجلد', 'سجل'] },
  { id: 'logs.export', section: 'logs', en: 'Export log (sanitized)', ar: 'تصدير السجل (منقّح)', keywords: ['export', 'log', 'download', 'copy', 'تصدير', 'سجل'] },
  { id: 'logs.clear', section: 'logs', en: 'Clear log', ar: 'مسح السجل', keywords: ['clear', 'truncate', 'log', 'مسح', 'سجل'] },
  { id: 'evidence.counts', section: 'evidence', en: 'Evidence counts — proofs, false-done rate', ar: 'إحصاءات الأدلة — الإثباتات ومعدل الإنجاز الكاذب', keywords: ['evidence', 'proof', 'false done', 'honesty', 'ledger', 'أدلة', 'إثبات'] },
  { id: 'evidence.openFolder', section: 'evidence', en: 'Open artifacts folder', ar: 'فتح مجلد الأدلة', keywords: ['proofs', 'folder', 'open', 'artifacts', 'مجلد', 'أدلة'] },
  { id: 'voice.language', section: 'voice', en: 'Dictation language (BCP-47)', ar: 'لغة الإملاء (BCP-47)', keywords: ['voice', 'language', 'locale', 'en-US', 'ar-SA', 'asr', 'لغة', 'إملاء'] },
  { id: 'voice.autoSend', section: 'voice', en: 'Auto-send transcript', ar: 'إرسال النص المفرّغ تلقائياً', keywords: ['voice', 'auto send', 'transcript', 'dictation', 'إرسال', 'صوت'] },
];

// ---------- v10.2 plugins ----------
V102_ENTRIES.push(
  { id: 'plugins.section', section: 'mcp', en: 'Plugins — capability packs', ar: 'الإضافات — حزم قدرات', keywords: ['plugins', 'packs', 'connectors', 'starter', 'install', 'إضافات', 'حزم', 'تثبيت'] },
  { id: 'plugins.starters', section: 'mcp', en: 'Starter packs (Web, Memory, Git)', ar: 'حزم البداية (ويب، ذاكرة، جيت)', keywords: ['starter', 'web pack', 'memory pack', 'git rituals', 'حزم البداية'] },
  { id: 'plugins.import', section: 'mcp', en: 'Import plugin from URL or file', ar: 'استيراد إضافة من رابط أو ملف', keywords: ['import', 'url', 'json', 'manifest', 'استيراد'] },
);

// ---------- v11.10 — approvals manager (Settings → Approvals) ----------
export const V1110_ENTRIES: SettingEntry[] = [
  { id: 'approvals.fullAccess', section: 'approvals', en: 'Full access master switch', ar: 'مفتاح الوصول الكامل', keywords: ['full access', 'permission mode', 'master switch', 'auto approve', 'وصول كامل', 'وضع الأذونات', 'موافقة تلقائية'] },
  { id: 'approvals.rules', section: 'approvals', en: 'Granted always-rules — list and revoke', ar: 'قواعد "اسمح دائماً" الممنوحة — عرض وإلغاء', keywords: ['always allow', 'always reject', 'revoke', 'approval rules', 'remembered', 'اسمح دائماً', 'ارفض دائماً', 'إلغاء', 'قواعد الموافقة'] },
  { id: 'approvals.security', section: 'approvals', en: 'Full access security warning', ar: 'تحذير أمان الوصول الكامل', keywords: ['security warning', 'risk', 'sudo', 'destructive', 'تحذير أمني', 'خطر'] },
];

// ---------- v1131 — full-coverage audit additions ----------
// These two panes shipped without a single search entry, so their controls
// were reachable only by clicking the nav. The failover item points at the
// honest OFF-by-default note in Agent (it is intentionally not a toggle).
export const V1131_ENTRIES: SettingEntry[] = [
  { id: 'updates.feed', section: 'updates', en: 'Update feed & check now', ar: 'خلاصة التحديثات والفحص الآن', keywords: ['updates', 'feed', 'version', 'check', 'download', 'تحديثات', 'خلاصة', 'إصدار'] },
  { id: 'updates.autoCheck', section: 'updates', en: 'Quiet automatic update check', ar: 'فحص تلقائي هادئ للتحديثات', keywords: ['auto check', 'updates', 'background', 'فحص', 'تلقائي'] },
  { id: 'remote.pairing', section: 'remote', en: 'Remote access & pairing', ar: 'الوصول عن بُعد والاقتران', keywords: ['remote', 'pair', 'device', 'access', 'عن بُعد', 'اقتران'] },
  { id: 'agent.failover', section: 'agent', en: 'Automatic provider failover (off by default)', ar: 'التبديل التلقائي بين المزوّدين (مُعطَّل افتراضياً)', keywords: ['failover', 'switch provider', 'fallback', '429', 'تبديل', 'مزوّد'] },
];
