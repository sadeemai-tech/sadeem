// ============================================================
// SADEEM settings — Voice section (v10.2, extended v10.3, v11.4).
// Microphone voice input control plane: transcription provider,
// model override, mic device picker, dictation language + auto-send,
// an honest capability note, AND a real live test (v10.3): record
// → transcribe through the exact production pipeline
// (kdx:session:transcribe) → show the transcript inline. v11.4 —
// the live test mirrors the composer's capture law: 16 kHz mono
// PCM WAV unless the pinned family parses WebM/Opus.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { Btn, Spinner } from '../ui';
import { S1Page } from './GeneralSection';
import { GroupCard, InfoNote, Segmented, SettingRow, Toggle } from './controls';
import './s1-art.css';

type AsrChoice = 'auto' | 'openai' | 'groq' | 'zai' | 'off';

const ASR_PRESETS: { value: AsrChoice; label: string; model: string }[] = [
  { value: 'auto', label: 'Auto', model: 'active provider' },
  { value: 'openai', label: 'OpenAI', model: 'whisper-1' },
  { value: 'groq', label: 'Groq', model: 'whisper-large-v3' },
  { value: 'zai', label: 'Z.AI', model: 'glm-asr-2512' },
  { value: 'off', label: 'Off', model: '—' },
];

// v11.4 — mirror the composer's capture law: 16 kHz mono PCM WAV unless the
// pinned family's ASR route is known to parse WebM/Opus (then MediaRecorder).
const PCM_TARGET_RATE = 16000;
const WEBM_ASR_FAMILIES = new Set(['openai', 'groq', 'openrouter', 'moonshot', 'mistral', 'qwen']);

type TestState =
  | { phase: 'idle' }
  | { phase: 'recording'; secs: number }
  | { phase: 'busy' }
  | { phase: 'ok'; text: string }
  | { phase: 'fail'; code: string };

/** Honest Arabic-first failure copy — mirrors the composer voiceFail codes. */
function failText(code: string, ar: boolean): string {
  const known: Record<string, [string, string]> = {
    EMPTY_AUDIO: ['التسجيل فارغ — حاول مرة أخرى.', 'Recording was empty — try again.'],
    NO_PROVIDER: ['لا يوجد مزوّد نشط — اختر نموذجاً أولاً.', 'No active provider — pick a model first.'],
    NO_API_KEY: ['أضف مفتاح API لمزوّد التفريغ.', 'Add an API key for the transcription provider.'],
    NO_TRANSCRIPTION_ENDPOINT: [
      'المزوّد النشط لا يدعم تحويل الصوت إلى نص. الصوت مدعوم اليوم مع المزوّدات المتوافقة مع OpenAI (OpenAI وGroq وOpenRouter وMoonshot وMistral وQwen) ومع Z.AI/GLM — اختر واحداً أعلاه.',
      'The active provider has no speech-to-text route. Voice works today with OpenAI-compatible providers (OpenAI, Groq, OpenRouter, Moonshot, Mistral, Qwen) and Z.AI/GLM — pick one above.',
    ],
    VOICE_DISABLED: ['الإدخال الصوتي معطّل (المزوّد = Off).', 'Voice input is disabled (provider = Off).'],
    VOICE_FORMAT: [
      'مزوّد التفريغ المختار (GLM-ASR) يقبل صيغ WAV أو MP3 فقط — أعد التسجيل (يسجّل WAV الآن) أو بدّل المزوّد.',
      'The chosen voice provider (GLM-ASR) only accepts WAV or MP3 — re-record (it records WAV now) or switch the provider.',
    ],
    NOT_ALLOWED: [
      'رُفض الوصول إلى الميكروفون. اسمح لـ SADEEM من إعدادات النظام (ويندوز: الإعدادات ← الخصوصية ← الميكروفون؛ ماك: إعدادات النظام ← الخصوصية والأمان ← الميكروفون) ثم أعد المحاولة.',
      'Microphone access was denied. Allow SADEEM in your OS settings (Windows: Settings → Privacy → Microphone; macOS: System Settings → Privacy & Security → Microphone), then retry.',
    ],
    NO_DEVICE: ['لم يُعثر على ميكروفون.', 'No microphone was found.'],
    NO_MIC: ['لم يُعثر على ميكروفون أو رُفض الإذن.', 'No microphone found, or access was denied.'],
    EMPTY_TRANSCRIPT: ['لم يُكتشف كلام في التسجيل.', 'No speech detected in the recording.'],
    TIMEOUT: ['انتهت مهلة التفريغ.', 'Transcription timed out.'],
  };
  const hit = known[code];
  return hit ? (ar ? hit[0] : hit[1]) : code;
}

/** v11.4 — average-reduce Float32 mono audio down to 16 kHz (pure JS).
 *  Mirrors the composer helper (a shared util file is out of scope here). */
function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate <= PCM_TARGET_RATE || fromRate <= 0) return input;
  const ratio = fromRate / PCM_TARGET_RATE;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** v11.4 — Float32 mono chunks → 16 kHz mono 16-bit PCM WAV Blob (audio/wav). */
function float32ToWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const rate = sampleRate > PCM_TARGET_RATE ? PCM_TARGET_RATE : Math.max(1, Math.floor(sampleRate || PCM_TARGET_RATE));
  const data = downsampleTo16k(merged, sampleRate);
  const dataSize = data.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < data.length; i++, p += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function VoiceSection() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const activeProvider = settings.model?.provider ?? '';
  const current = settings.voice?.asrProvider ?? 'auto';
  const modelOverride = settings.voice?.asrModel ?? '';
  // v11.4 — dictation language + auto-send (consumed by the transcription pipeline)
  const voiceLang = settings.voice?.language ?? 'en-US';
  const autoSend = settings.voice?.autoSend === true;
  // v11.4 — mic device picker ('' = system default)
  const deviceId = settings.voice?.deviceId ?? '';
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  const refreshMics = async (): Promise<void> => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* keep the previous list */
    }
  };

  // ---- v10.3 live test state ----
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  // v11.4 — PCM capture graph for the live test (non-WebM families)
  const pcmCtxRef = useRef<AudioContext | null>(null);
  const pcmSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmProcRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[] | null>(null);

  useEffect(
    () => () => {
      // unmount mid-test: drop mic + PCM graph silently
      try {
        if (recRef.current && recRef.current.state === 'recording') recRef.current.onstop = null;
        recRef.current?.stop();
      } catch {
        /* already stopped */
      }
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      try {
        pcmProcRef.current?.disconnect();
        pcmSrcRef.current?.disconnect();
        void pcmCtxRef.current?.close();
      } catch {
        /* graph already gone */
      }
      pcmProcRef.current = null;
      pcmSrcRef.current = null;
      pcmCtxRef.current = null;
      pcmChunksRef.current = null;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  const pick = (v: AsrChoice) => updateSettings({ voice: { ...settings.voice, asrProvider: v } });
  const preset = ASR_PRESETS.find((p) => p.value === current);

  /** v11.4 — one shared transcription leg for both capture paths. */
  const runTranscription = async (blob: Blob, mime: string): Promise<void> => {
    setTest({ phase: 'busy' });
    try {
      const b64: string = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ''));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
      });
      if (!b64.split(',')[1]) {
        setTest({ phase: 'fail', code: failText('EMPTY_AUDIO', lang === 'ar') });
        return;
      }
      const res = await api.transcribeAudio(b64, mime);
      const text = res.ok && typeof res.text === 'string' ? res.text.trim() : '';
      if (res.ok && text) setTest({ phase: 'ok', text });
      else setTest({ phase: 'fail', code: res.ok ? failText('EMPTY_TRANSCRIPT', lang === 'ar') : String(res.error ?? '') });
    } catch (err) {
      setTest({ phase: 'fail', code: err instanceof Error ? err.message : String(err) });
    }
  };

  const releaseTestMic = (): void => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  const stopTest = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // v11.4 — PCM path: freeze capture, encode WAV, transcribe.
    const proc = pcmProcRef.current;
    if (proc) {
      proc.onaudioprocess = null;
      const chunks = pcmChunksRef.current ?? [];
      const rate = pcmCtxRef.current?.sampleRate ?? PCM_TARGET_RATE;
      pcmChunksRef.current = null;
      pcmSrcRef.current = null;
      pcmProcRef.current = null;
      releaseTestMic();
      try {
        void pcmCtxRef.current?.close();
      } catch {
        /* already closed */
      }
      pcmCtxRef.current = null;
      void runTranscription(chunks.length > 0 ? float32ToWavBlob(chunks, rate) : new Blob(), 'audio/wav');
      return;
    }
    try {
      recRef.current?.stop(); // onstop → transcribe
    } catch {
      setTest({ phase: 'idle' });
    }
  };

  const startTest = async (): Promise<void> => {
    if (test.phase === 'recording' || test.phase === 'busy') return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setTest({ phase: 'fail', code: failText('NO_MIC', false) });
      return;
    }
    // v11.4 — mirror the composer: the pinned provider wins over the active
    // one; WebM only for families whose ASR route parses it (else 16 kHz WAV).
    const pinned = String(settings.voice?.asrProvider ?? 'auto').trim();
    const family = pinned && pinned !== 'auto' && pinned !== 'off' ? pinned : activeProvider;
    const useWebm = WEBM_ASR_FAMILIES.has(family) && typeof MediaRecorder !== 'undefined';
    try {
      const devId = String(settings.voice?.deviceId ?? '');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: devId ? { deviceId: { exact: devId } } : true,
      });
      streamRef.current = stream;
      if (useWebm) {
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          releaseTestMic();
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          void runTranscription(blob, rec.mimeType || 'audio/webm');
        };
        rec.start();
        recRef.current = rec;
      } else {
        const ctx = new AudioContext({ sampleRate: PCM_TARGET_RATE });
        pcmCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        pcmChunksRef.current = [];
        proc.onaudioprocess = (e: AudioProcessingEvent) => {
          // the input buffer is reused by the audio thread — copy it
          pcmChunksRef.current?.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        src.connect(proc);
        const mute = ctx.createGain(); // zero-gain sink: no audible feedback
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);
        pcmSrcRef.current = src;
        pcmProcRef.current = proc;
      }
      setTest({ phase: 'recording', secs: 0 });
      timerRef.current = window.setInterval(() => {
        setTest((s) => (s.phase === 'recording' ? { ...s, secs: s.secs + 1 } : s));
      }, 1000);
    } catch (err) {
      releaseTestMic();
      try {
        void pcmCtxRef.current?.close();
      } catch {
        /* already closed */
      }
      pcmCtxRef.current = null;
      pcmSrcRef.current = null;
      pcmProcRef.current = null;
      pcmChunksRef.current = null;
      const name = err instanceof DOMException ? err.name : '';
      setTest({ phase: 'fail', code: failText(name === 'NotAllowedError' || name === 'SecurityError' ? 'NOT_ALLOWED' : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'NO_DEVICE' : 'NO_MIC', lang === 'ar') });
    }
  };

  return (
    <S1Page
      className="s1-voice"
      eyebrow={t('s1.eyebrow.voice', ar ? '٠٤ / الإدخال الصوتي' : '04 / VOICE INPUT')}
      titleKey="settings.nav.voice"
      titleFallback={ar ? 'الإدخال الصوتي' : 'Voice input'}
      glyph="voice"
      desc={t(
        'settings.voice.desc',
        ar
          ? 'الإملاء عبر الميكروفون في المحرّر — تحويل الكلام إلى نص عبر مزوّدك.'
          : 'Microphone dictation in the composer — speech to text through your provider.',
      )}
    >
      <GroupCard>
        <SettingRow
          label={t('settings.voice.asrProvider', 'Transcription provider')}
          hint={t(
            'settings.voice.asrProvider.hint',
            'Auto uses the active provider when it supports speech-to-text. Z.AI uses GLM-ASR, Groq uses Whisper-large-v3, OpenAI uses Whisper-1.',
          )}
        >
          <Segmented<AsrChoice>
            value={(ASR_PRESETS.some((p) => p.value === current) ? current : 'auto') as AsrChoice}
            options={ASR_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            onChange={pick}
            ariaLabel={t('settings.voice.asrProvider', 'Transcription provider')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.voice.asrModel', 'Model override')}
          hint={t(
            'settings.voice.asrModel.hint',
            'Leave empty for the preset model of the chosen provider.',
          )}
        >
          <input
            className="set-input"
            dir="ltr"
            value={modelOverride}
            placeholder={preset?.model || 'whisper-1'}
            onChange={(e) => updateSettings({ voice: { ...settings.voice, asrModel: e.target.value } })}
            style={{ width: 190, font: '12px var(--mono, monospace)' }}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.voice.device', 'Microphone')}
          hint={t(
            'settings.voice.device.hint',
            ar
              ? 'انقر القائمة لعرض الميكروفونات المتصلة. الأسماء تظهر بعد منح الإذن. الافتراضي = ميكروفون النظام.'
              : 'Click the list to enumerate connected microphones. Labels appear once mic permission is granted. Default = system microphone.',
          )}
        >
          <select
            className="set-input h-[26px] w-[210px] px-2 text-[11.5px] outline-none transition-colors"
            dir="ltr"
            value={deviceId}
            aria-label={t('settings.voice.device', 'Microphone')}
            onClick={() => void refreshMics()}
            onFocus={() => void refreshMics()}
            onChange={(e) => updateSettings({ voice: { ...settings.voice, deviceId: e.target.value } })}
          >
            <option value="">{ar ? 'الميكروفون الافتراضي للنظام' : 'System default microphone'}</option>
            {mics.map((d, i) => (
              <option key={d.deviceId || `mic-${i}`} value={d.deviceId}>
                {d.label || `${ar ? 'ميكروفون' : 'Microphone'} ${i + 1}`}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label={t('settings.voice.language', 'Dictation language')}
          hint={t(
            'settings.voice.language.hint',
            ar
              ? 'لغة الإملاء بصيغة BCP-47 (مثل en-US أو ar-SA) — تُمرَّر لخط أنابيب التفريغ.'
              : 'BCP-47 language hint (e.g. en-US or ar-SA) — passed to the transcription pipeline.',
          )}
        >
          <input
            className="set-input"
            dir="ltr"
            value={voiceLang}
            placeholder="en-US"
            onChange={(e) => updateSettings({ voice: { ...settings.voice, language: e.target.value } })}
            style={{ width: 190, font: '12px var(--mono, monospace)' }}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.voice.autoSend', 'Auto-send transcript')}
          hint={t(
            'settings.voice.autoSend.hint',
            ar
              ? 'إرسال النص المفرّغ تلقائياً عند انتهاء الإملاء (يتعيّنه خط أنابيب التفريغ).'
              : 'Send the transcript automatically when dictation finishes (consumed by the transcription pipeline).',
          )}
        >
          <Toggle
            checked={autoSend}
            onChange={(v) => updateSettings({ voice: { ...settings.voice, autoSend: v } })}
            label={t('settings.voice.autoSend', 'Auto-send transcript')}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.voice.test', 'Live test')}>
        <div className="flex items-center gap-2.5 flex-wrap">
          {test.phase === 'recording' ? (
            <Btn variant="primary" className="!h-7 !text-[11.5px]" onClick={stopTest}>
              <Square size={11} />
              {t('settings.voice.stop', 'Stop')} · <span className="tnum" dir="ltr">{test.secs}s</span>
            </Btn>
          ) : (
            <Btn
              variant="primary"
              className="!h-7 !text-[11.5px]"
              onClick={() => void startTest()}
              disabled={test.phase === 'busy'}
            >
              <Mic size={11} />
              {test.phase === 'busy' ? <Spinner size={11} /> : null}
              {t('settings.voice.record', 'Record 3s and transcribe')}
            </Btn>
          )}
          <span className="text-[10.5px] text-faint" dir="auto">
            {t(
              'settings.voice.testHint',
              'Speaks through the exact production pipeline the composer mic uses.',
            )}
          </span>
        </div>
        {test.phase === 'ok' && (
          <div
            className="mt-2 px-2.5 py-2 rounded-[8px] border border-[var(--line)] bg-[var(--bg1)] text-[11.5px] text-[var(--ink)]"
            dir="auto"
            role="status"
          >
            {test.text}
          </div>
        )}
        {test.phase === 'fail' && (
          <div
            className="mt-2 px-2.5 py-2 rounded-[8px] border border-[color-mix(in_srgb,var(--bad)_35%,transparent)] text-[11.5px] text-[var(--bad)]"
            dir="auto"
            role="alert"
          >
            {test.code}
          </div>
        )}
        {test.phase === 'ok' && (
          <button
            className="mt-1.5 text-[10.5px] text-faint underline underline-offset-2"
            onClick={() => {
              navigator.clipboard?.writeText(test.text).then(
                () => notify(lang === 'ar' ? 'نُسخ النص' : 'Transcript copied'),
                () => undefined,
              );
            }}
            dir="auto"
          >
            {t('settings.voice.copy', 'Copy transcript')}
          </button>
        )}
      </GroupCard>

      <InfoNote>
        {t(
          'settings.voice.note',
          ar
            ? `المزوّد النشط: ${activeProvider || 'لا شيء'}. يبقى التسجيل محلياً؛ تُرسل المقطوعة الصوتية القصيرة فقط إلى نقطة التفريغ التي تختارها. يدعم الصوت اليوم: المزوّدات المتوافقة مع OpenAI (OpenAI وGroq وOpenRouter وMoonshot وMistral وQwen) وZ.AI/GLM. لا يوفّر Anthropic ولا Ollama المحلي مسار تفريغ — اختر Auto مع مزوّد آخر أو ثبّت واحداً هنا. يسجّل الميكروفون WAV أحادي 16 kHz (يقبل GLM-ASR صيغ WAV/MP3 فقط).`
            : `Active provider: ${activeProvider || 'none'}. Recording stays local; only the short audio clip is sent to the transcription endpoint you choose. Voice works today with OpenAI-compatible providers (OpenAI, Groq, OpenRouter, Moonshot, Mistral, Qwen) and Z.AI/GLM. Anthropic and local Ollama expose no transcription route — pick Auto + another provider, or pin one here. The mic records 16 kHz mono WAV (GLM-ASR accepts only WAV/MP3).`,
        )}
      </InfoNote>
    </S1Page>
  );
}
