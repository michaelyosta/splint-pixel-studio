let audioContext = null;
let lastStrokeFeedbackAt = Number.NEGATIVE_INFINITY;
const STROKE_FEEDBACK_COOLDOWN_MS = 140;

function telegramHaptic(kind, intensity) {
  const haptics = globalThis.window?.Telegram?.WebApp?.HapticFeedback;
  if (!haptics) return;
  if (kind === 'fragment') {
    haptics.notificationOccurred?.('success');
    return;
  }
  haptics.impactOccurred?.(intensity === 'expressive' ? 'medium' : 'light');
}

function playTone(frequency, start, duration, gainValue) {
  const context = audioContext;
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playCalmCue(kind, intensity) {
  const AudioContextClass = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  const now = audioContext.currentTime + 0.005;
  const gain = intensity === 'expressive' ? 0.045 : intensity === 'balanced' ? 0.032 : 0.022;
  if (kind === 'fragment') {
    playTone(392, now, 0.22, gain);
    playTone(523.25, now + 0.11, 0.32, gain * 0.82);
  } else {
    playTone(293.66, now, 0.11, gain * 0.55);
  }
}

export function playCoreFeelFeedback(kind, experiment) {
  if (!experiment?.enabled || !experiment.variant?.enhanced) return;
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (kind === 'stroke') {
    if (now - lastStrokeFeedbackAt < STROKE_FEEDBACK_COOLDOWN_MS) return;
    lastStrokeFeedbackAt = now;
  }
  const intensity = experiment.variant.hapticIntensity || 'quiet';
  if (experiment.hapticsEnabled) {
    try {
      telegramHaptic(kind, intensity);
    } catch {
      // Haptics are optional and must never block painting.
    }
  }
  if (experiment.soundEnabled) {
    try {
      playCalmCue(kind, intensity);
    } catch {
      // Web Audio availability varies between Telegram WebViews.
    }
  }
}
