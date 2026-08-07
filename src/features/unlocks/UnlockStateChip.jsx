import { CheckCircle2, Crown, Lock, Sparkles } from 'lucide-react';
import {
  stateDescription,
  stateLabel,
  UNLOCK_STATES,
} from '../../lib/unlockState';

const ICONS = {
  [UNLOCK_STATES.AVAILABLE]: Sparkles,
  [UNLOCK_STATES.OWNED]: CheckCircle2,
  [UNLOCK_STATES.PROGRESSION_LOCKED]: Lock,
  [UNLOCK_STATES.PREMIUM_LOCKED]: Crown,
};

export default function UnlockStateChip({ state, reasonCode }) {
  const Icon = ICONS[state] || Lock;
  const label = stateLabel(state);
  const description = stateDescription(state);
  return (
    <span
      className={`unlock-chip unlock-chip--${state}`}
      data-unlock-state={state}
      data-reason-code={reasonCode || ''}
      title={description || label}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
