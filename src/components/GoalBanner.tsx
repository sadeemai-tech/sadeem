// GoalBanner — FINAL POLISH: a slim ruled banner carrying the agent's active
// goal in the editorial serif, with a real mono progress/status tag. All state
// is preserved: pct comes from goal_progress/goal_done events, the fraction
// from the backed todo list, and dismiss still calls the store's clearGoal.
import { useStore } from '../store';
import { useT } from '../i18n';
import { X } from 'lucide-react';
import './chat-final.css';

export function GoalBanner() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const activeGoal = useStore((s) => s.activeGoal);
  const todos = useStore((s) => s.todos);
  const clearGoal = useStore((s) => s.clearGoal);

  if (!activeGoal || !activeGoal.goal) return null;
  const pct = typeof activeGoal.pct === 'number' ? Math.max(0, Math.min(100, Math.round(activeGoal.pct))) : null;
  const done = todos.filter((td) => td.status === 'completed').length;
  // fraction progress when a todo list backs the goal, percent otherwise
  const frac = todos.length > 0 ? `${done}/${todos.length}` : null;
  const trackPct = pct ?? (todos.length > 0 ? Math.round((done / todos.length) * 100) : null);
  const complete = trackPct !== null && trackPct >= 100;
  const tag = frac ?? (pct !== null ? `${pct}%` : '—');

  return (
    <div className="goal-banner" role="status">
      <span className="goal-eyebrow">{t('goal.title', 'GOAL')}</span>
      <span className="goal-title-serif" dir="auto" title={activeGoal.goal}>
        {activeGoal.goal}
      </span>
      <span className="goal-tag tnum" dir="ltr">{tag}</span>
      <span className="goal-state" dir="auto">
        {complete
          ? t('goal.stateDone', lang === 'ar' ? 'مكتمل' : 'DONE')
          : t('goal.stateActive', lang === 'ar' ? 'نشط' : 'ACTIVE')}
      </span>
      <button
        className="ibtn !w-8 !h-8 !-my-2 !-me-1.5 shrink-0"
        title={t('goal.clear', 'Clear goal')}
        aria-label={t('goal.clear', 'Clear goal')}
        onClick={() => void clearGoal()}
      >
        <X size={11} />
      </button>
      <span className="goal-track" aria-hidden>
        <i style={{ width: `${trackPct === null ? 6 : Math.max(4, trackPct)}%` }} />
      </span>
    </div>
  );
}

export default GoalBanner;
