import { CheckCircle2, Clock3, Flame, Star, Target, TimerReset } from 'lucide-react';

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function liveStatusText(goal, celebration) {
  if (celebration?.type === 'completed') return `Цель «${celebration.label}» выполнена`;
  if (celebration?.type === 'expired') return 'Время цели вышло, следующая уже идёт';
  if (!goal.painted) return `Цель «${goal.label}» ожидает первого штриха`;
  if (goal.status === 'paused') return `Цель «${goal.label}» на паузе`;
  return `Цель «${goal.label}» идёт`;
}

export default function SessionGoalCard({
  goal,
  reward,
  streak,
  celebration,
  nextActionLabel = 'Продолжить',
  onNextAction,
}) {
  if (!goal) return null;
  const timerText = formatClock(Math.max(0, goal.remainingMs));
  const paused = goal.status === 'paused';
  const celebrating = Boolean(celebration);

  return (
    <section
      className={`session-goal-card${celebrating ? ' is-celebrating' : ''}${goal.status === 'expired' ? ' is-expired' : ''}`}
      data-goal-id={goal.id}
      data-goal-status={goal.status}
      data-painted={goal.painted ? 'true' : 'false'}
      data-elapsed-ms={Math.floor(goal.elapsedMs || 0)}
      data-done-cells={goal.done}
      data-target-cells={goal.target}
      data-celebration={celebrating ? celebration.type : ''}
    >
      <div className="session-goal-head">
        <span className="session-goal-kind">
          <Target size={14} aria-hidden="true" />
          <b>{goal.label}</b>
          <small>{goal.sublabel}</small>
        </span>
        <span className={`session-goal-timer${paused ? ' is-paused' : ''}`}>
          {!goal.painted ? (
            <>
              <Clock3 size={13} aria-hidden="true" />
              {timerText} · старт после штриха
            </>
          ) : paused ? (
            <>
              <TimerReset size={13} aria-hidden="true" />
              пауза · {timerText}
            </>
          ) : (
            <>
              <Clock3 size={13} aria-hidden="true" />
              {timerText}
            </>
          )}
        </span>
      </div>
      <div
        className="session-goal-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={goal.progressPercent}
        aria-label={`${goal.label}: ${goal.progressPercent}%`}
      >
        <i style={{ width: `${goal.progressPercent}%` }} />
      </div>
      <div className="session-goal-meta">
        <span className="session-goal-progress">
          {goal.done} / {goal.target} клеток · ещё {Math.max(0, goal.remaining)}
        </span>
        <span className="session-goal-reward">
          <Star size={13} aria-hidden="true" />
          {reward?.amount ? `+${reward.amount} XP · подтверждено сервером` : 'XP после проверки сервером'}
        </span>
        {streak != null && (
          <span className="session-goal-streak">
            <Flame size={13} aria-hidden="true" />
            {streak} дн.
          </span>
        )}
      </div>
      {celebrating && (
        <div className="session-goal-celebration" data-celebration-type={celebration.type}>
          <span className="session-goal-celebration-copy">
            {celebration.type === 'completed' ? (
              <>
                <CheckCircle2 size={15} aria-hidden="true" />
                Цель «{celebration.label}» выполнена
              </>
            ) : (
              'Время вышло — следующая цель уже идёт'
            )}
          </span>
          <button type="button" className="session-goal-next" onClick={onNextAction}>
            {nextActionLabel}
          </button>
        </div>
      )}
      <span className="sr-only session-goal-live" role="status" aria-live="polite">
        {liveStatusText(goal, celebration)}
      </span>
    </section>
  );
}
