// AttachMenu — v11.37 (founder's design request) + v11.42 (slash commands)
// + v11.43 (file mentions moved out of the chat).
//
// The chat panel used to carry THREE separate hairline icon buttons in the
// composer toolbar: attach-image, prompt-presets ("prompt prosthetics") and
// rewind-to-checkpoint. They are now COLLECTED behind ONE "+" trigger. The
// trigger opens a small hairline popover with those three paths PLUS the new
// "attach document" ability.
//
// v11.43 — the founder's repeat complaint: "الدائرة اللي بنص إيه تبعت المنشن
// فايل" — the floating '@' file list hovering over the middle of the chat. It
// is MOVED here: a "Mention file / استشهاد بملف" disclosure row inside THIS
// same "+" popover expands into the REAL capped workspace list. The rows call
// the composer's OWN insertMention(@path) handler passed in as `onMentionFile`
// — no new IPC, no second file source, no auto-send. The four original
// menuitems and the v11.42 slash group stay exactly where they are.
//
// v11.42 — the founder also asked for the slash commands to stop cluttering the
// view: "ادمجن هيك علامات كل سلاش إنه جوا الـ add". The always-visible mono
// quick-hint row is retired (chat-final.css hides it; the source constant stays
// because v1126 pins it as a registry guard). ALL advertised slash commands now
// live behind ONE "Commands / الأوامر" disclosure row inside this SAME "+"
// popover. The submenu is rendered from the canonical SLASH_COMMANDS registry —
// never a hand-made decorative copy — and picking a row inserts the real token
// into the composer through the existing `insertIntoComposer` store action
// (the same path editor actions use). No command is auto-sent: the user reviews
// and sends, exactly like the retired quick hints.
//
// Design law (same as chat-final.css):
//   · one hairline border, hairline row separators — no boxy card, no shadow,
//     no gradient, no glow;
//   · logical insets (RTL mirrors automatically);
//   · no animation at all, so reduced-motion is honoured by construction;
//   · labels go through t(key, single localized fallback) — no mixed sigils;
//   · every row is a REAL wired button (no dead controls).
import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, History, Terminal, X } from 'lucide-react';
import { IcFile, IcFolderOpen, IcImage, IcPlus } from './icons';
import { useStore } from '../store';
import { useT } from '../i18n';
import { SLASH_COMMANDS, SLASH_GROUP_LABELS, SLASH_LABELS } from '../lib/modes';
import './chat-final.css';

/**
 * Structural mirror of the composer's capped `MentionItem` — declared here so
 * AttachMenu never imports Composer (no circular dependency). The composer
 * passes the very same flattened, MAX_MENTION_FILES-capped tree it always did.
 */
export interface MentionFileItem {
  rel: string;
  dir: boolean;
}

/** Stable empty list — no fresh array in render, no unstable store selector. */
const NO_MENTION_FILES: MentionFileItem[] = [];

export interface AttachMenuProps {
  /** Images are capped per message — the image row mirrors that real limit. */
  imageFull?: boolean;
  onAttachImage: () => void;
  onAttachDocument: () => void;
  onPresets: () => void;
  onRewind: () => void;
  /** v11.43 — the composer's real, capped workspace file list (old '@' source). */
  mentionPaths?: MentionFileItem[];
  /** v11.43 — the composer's real @path insert action; no new IPC / channel. */
  onMentionFile?: (rel: string) => void;
  /** Optional hairline dismiss glyph in the popover header. */
  onClose?: () => void;
}

/**
 * v11.42 — the expanded "Commands" submenu. Exported (and always expanded)
 * so the real registry rows can be SSR-tested without a test-only prop.
 *
 * One language per render: `t(uniqueKey, L(en, ar))`. The unique key prevents
 * an unrelated existing translation from changing the meaning; the localized
 * fallback keeps the line correct in both languages. A command with no label
 * degrades honestly to its bare token — no blank row, no invented copy.
 */
export function SlashCommandsSubmenu({ onPick }: { onPick: (cmd: string) => void }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  return (
    <div
      id="cf-attach-commands"
      className="cf-attach-sub"
      role="group"
      aria-label={t('slash.menu', L('Slash commands', 'أوامر السلاش'))}
    >
      {(Object.keys(SLASH_GROUP_LABELS) as (keyof typeof SLASH_GROUP_LABELS)[]).map((gid) => {
        const specs = SLASH_COMMANDS.filter((c) => c.group === gid);
        if (specs.length === 0) return null;
        const gl = SLASH_GROUP_LABELS[gid];
        return (
          <div key={gid} role="group" aria-label={lang === 'ar' ? gl.ar : gl.en}>
            <div className="cf-attach-subgroup" dir="auto">
              {lang === 'ar' ? gl.ar : gl.en}
            </div>
            {specs.map((spec) => {
              const label = SLASH_LABELS[spec.cmd];
              // Labels are bilingual inline (SLASH_LABELS carries EN+AR) — no
              // dynamic t() key, so the i18n key guard sees a stable surface.
              const desc = label ? L(label.en, label.ar) : spec.cmd;
              // Argument commands get a trailing space, ready for the value —
              // the same honest "fill, then review" contract as the real
              // Composer selectSlash() handler.
              const insert = spec.arg ? `${spec.cmd} ` : spec.cmd;
              return (
                <button
                  key={spec.cmd}
                  className="cf-attach-subrow"
                  onClick={() => onPick(insert)}
                  title={`${spec.cmd} — ${desc}`}
                >
                  <span className="cf-attach-subcmd" dir="ltr">{spec.cmd}</span>
                  <span className="cf-attach-subdesc" dir="auto">{desc}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * v11.43 — the REAL file list, now a hairline submenu of THIS "+" popover.
 *
 * `files` is the composer's capped flattened workspace tree (MAX_MENTION_FILES),
 * passed straight in — no new IPC, no second file source. A tiny local filter
 * replaces the old "type @query to fuzzy-match" behaviour without touching the
 * composer's value: power users can still type '@', everyone else picks here.
 * Every row calls the composer's OWN insertMention(@path) via `onPick`, then
 * the popover closes. No auto-send.
 */
export function MentionFilesSubmenu({
  files,
  onPick,
}: {
  files: MentionFileItem[];
  onPick: (rel: string) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = q ? files.filter((f) => f.rel.toLowerCase().includes(q)) : files;

  return (
    <div
      id="cf-attach-mentions"
      className="cf-attach-sub cf-attach-mentions-sub"
      role="group"
      data-testid="chat-mention-files"
      aria-label={t('chat.mention.files.v1143', L('Workspace files', 'ملفات مساحة العمل'))}
    >
      <input
        className="cf-attach-mentions-filter"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('chat.mention.filter.v1143', L('Filter files…', 'تصفية الملفات…'))}
        aria-label={t('chat.mention.filter.v1143', L('Filter files', 'تصفية الملفات'))}
      />
      <div className="cf-attach-mentions-count tnum" dir="auto">
        {t('chat.mention.count.v1143', L('{n} files', '{n} ملف'), { n: rows.length })}
      </div>
      {rows.length === 0 ? (
        <div className="cf-attach-mentions-empty" dir="auto">
          {t('chat.mention.empty.v1143', L('No matching files', 'لا ملفات مطابقة'))}
        </div>
      ) : (
        rows.map((f) => (
          <button
            key={f.rel}
            className="cf-attach-subrow cf-attach-mention-row"
            data-testid="chat-mention-file-row"
            onClick={() => onPick(f.rel)}
            title={`@${f.rel}`}
          >
            {f.dir ? (
              <IcFolderOpen size={12} className="cf-attach-mention-ico cf-attach-mention-dir shrink-0" aria-hidden />
            ) : (
              <IcFile size={12} className="cf-attach-mention-ico shrink-0" aria-hidden />
            )}
            <span className="cf-attach-mention-rel" dir="ltr">{f.rel}</span>
          </button>
        ))
      )}
    </div>
  );
}

/**
 * The popover BODY, exported so it can be SSR-tested in its open state without
 * a test-only `defaultOpen` prop. Rendered only while the menu is open.
 */
export function AttachMenuPanel({
  imageFull = false,
  onAttachImage,
  onAttachDocument,
  onPresets,
  onRewind,
  mentionPaths = NO_MENTION_FILES,
  onMentionFile,
  onClose,
}: AttachMenuProps) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [commandsOpen, setCommandsOpen] = useState(false);
  // v11.43 — the mention submenu is closed by default, so the SSR "closed
  // panel" contract (no expanded duplicate list) still holds.
  const [mentionsOpen, setMentionsOpen] = useState(false);
  // The REAL composer-insert action (the same path editor "send selection"
  // uses). No fabricated store channel, no auto-send — the user reviews.
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);

  return (
    <div className="cf-attach-pop" role="menu" aria-label={t('chat.attach.menu', L('Add to chat', 'أضف إلى المحادثة'))}>
      <div className="cf-attach-head">
        <span className="cf-attach-title" dir="auto">
          {t('chat.attach.menu', L('Add to chat', 'أضف إلى المحادثة'))}
        </span>
        <span className="flex-1" />
        <span className="cf-attach-count tnum">5</span>
        {onClose && (
          <button
            className="cf-attach-x"
            onClick={onClose}
            title={t('presets.close', L('Close', 'إغلاق'))}
            aria-label={t('presets.close', L('Close', 'إغلاق'))}
          >
            <X size={11} />
          </button>
        )}
      </div>

      <button
        role="menuitem"
        className="cf-attach-row"
        disabled={imageFull}
        onClick={onAttachImage}
        title={t('chat.attachImage', L('Attach image (vision)', 'إرفاق صورة (رؤية)'))}
      >
        <IcImage size={14} className="cf-attach-ico shrink-0" />
        <span className="cf-attach-label" dir="auto">
          {t('chat.attachImage', L('Attach image (vision)', 'إرفاق صورة (رؤية)'))}
        </span>
      </button>

      <button
        role="menuitem"
        className="cf-attach-row"
        onClick={onAttachDocument}
        title={t('chat.attach.document', L('Attach document', 'إرفاق مستند'))}
      >
        <IcFile size={14} className="cf-attach-ico shrink-0" />
        <span className="cf-attach-label" dir="auto">
          {t('chat.attach.document', L('Attach document', 'إرفاق مستند'))}
        </span>
      </button>

      <button
        role="menuitem"
        className="cf-attach-row"
        onClick={onPresets}
        title={t('presets.title', L('Insert a saved prompt preset', 'توجيهات جاهزة'))}
      >
        <BookMarked size={14} className="cf-attach-ico shrink-0" aria-hidden />
        <span className="cf-attach-label" dir="auto">
          {t('presets.title', L('Insert a saved prompt preset', 'توجيهات جاهزة'))}
        </span>
      </button>

      <button
        role="menuitem"
        className="cf-attach-row"
        onClick={onRewind}
        title={t('chat.rewind', L('Rewind to a checkpoint', 'استعادة نقطة تحقق'))}
      >
        <History size={14} className="cf-attach-ico shrink-0" aria-hidden />
        <span className="cf-attach-label" dir="auto">
          {t('chat.rewind', L('Rewind to a checkpoint', 'استعادة نقطة تحقق'))}
        </span>
      </button>

      {/* v11.42 — ONE disclosure row for ALL slash commands. It is a plain
          button with aria-expanded/aria-controls (not a 5th menuitem), so the
          v1137 "four items" contract stays intact while the submenu is a
          real, grouped, keyboard-reachable list of the canonical registry. */}
      <div className="cf-attach-cmds">
        <button
          className="cf-attach-row cf-attach-cmds-toggle"
          aria-expanded={commandsOpen}
          aria-controls="cf-attach-commands"
          aria-haspopup="true"
          onClick={() => setCommandsOpen((v) => !v)}
          title={t('slash.menu', L('Slash commands — insert into the composer', 'أوامر السلاش — إدراج في حقل الكتابة'))}
        >
          <Terminal size={14} className="cf-attach-ico shrink-0" aria-hidden />
          <span className="cf-attach-label" dir="auto">
            {t('slash.v1142.commands', L('Commands', 'الأوامر'))}
          </span>
          <span className="cf-attach-cmds-caret" aria-hidden>{commandsOpen ? '−' : '+'}</span>
        </button>
        {commandsOpen && (
          <SlashCommandsSubmenu
            onPick={(cmd) => {
              insertIntoComposer(cmd);
              onClose?.();
            }}
          />
        )}
      </div>

      {/* v11.43 — the file-mention list MOVED here from the floating '@' menu.
          A hairline disclosure row (not a 5th menuitem, so the v1137 four-item
          contract holds) expands the REAL capped workspace list. Picking a row
          uses the composer's own insertMention(@path) and closes the popover. */}
      <div className="cf-attach-mentions">
        <button
          className="cf-attach-row cf-attach-mentions-toggle"
          aria-expanded={mentionsOpen}
          aria-controls="cf-attach-mentions"
          aria-haspopup="true"
          onClick={() => setMentionsOpen((v) => !v)}
          title={t('chat.mention.file.v1143', L('Mention a workspace file', 'استشهاد بملف من مساحة العمل'))}
        >
          <IcFolderOpen size={14} className="cf-attach-ico shrink-0" aria-hidden />
          <span className="cf-attach-label" dir="auto">
            {t('chat.mention.file.v1143', L('Mention file', 'استشهاد بملف'))}
          </span>
          <span className="cf-attach-cmds-caret" aria-hidden>{mentionsOpen ? '−' : '+'}</span>
        </button>
        {mentionsOpen && (
          <MentionFilesSubmenu
            files={mentionPaths}
            onPick={(rel) => {
              onMentionFile?.(rel);
              onClose?.();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** ONE "+" trigger + the hairline popover. */
export function AttachMenu(props: AttachMenuProps) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="cf-attach" ref={rootRef}>
      <button
        className={`sc-iconbtn cf-attach-trigger${open ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="chat-attach-menu"
        onClick={() => setOpen((v) => !v)}
        title={t(
          'chat.attach.menu',
          lang === 'ar' ? 'أضف إلى المحادثة' : 'Add to chat — image, document, prompts, checkpoint',
        )}
        aria-label={t('chat.attach.menu', lang === 'ar' ? 'أضف إلى المحادثة' : 'Add to chat')}
      >
        <IcPlus size={13} />
      </button>
      {open && (
        <AttachMenuPanel
          imageFull={props.imageFull}
          onAttachImage={pick(props.onAttachImage)}
          onAttachDocument={pick(props.onAttachDocument)}
          onPresets={pick(props.onPresets)}
          onRewind={pick(props.onRewind)}
          mentionPaths={props.mentionPaths}
          onMentionFile={props.onMentionFile}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default AttachMenu;
