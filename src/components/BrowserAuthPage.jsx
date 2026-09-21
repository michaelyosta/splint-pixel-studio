import { ExternalLink, ShieldCheck } from 'lucide-react';
import { TELEGRAM_MINI_APP_BOT_URL } from '../lib/telegram.js';

export default function BrowserAuthPage({ status = 'anonymous', error = null }) {
  const isLoading = status === 'loading' || status === 'unknown';
  return (
    <section className="browser-auth-page" data-browser-auth-page>
      <div className="browser-auth-card">
        <div className="browser-auth-icon" aria-hidden="true"><ShieldCheck size={28} /></div>
        <p className="eyebrow">SPLINT PIXEL STUDIO</p>
        <h1>{isLoading ? 'Проверяем среду' : 'Откройте SPLINT в Telegram'}</h1>
        <p className="browser-auth-copy">
          {isLoading
            ? 'Проверяем, запущена ли студия внутри Telegram.'
            : 'Для входа откройте @splint_pixel_studio_bot и нажмите Open. Telegram Mini App передаст подписанные данные сессии и откроет тот же профиль и прогресс.'}
        </p>
        {error && <p className="browser-auth-error" role="alert">{error}</p>}
        {!isLoading && <a
          className="primary-button browser-auth-button"
          href={TELEGRAM_MINI_APP_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-browser-mini-app-launch
        >
          <ExternalLink size={18} /> Открыть в Telegram
        </a>}
        <small className="browser-auth-note">В обычном браузере отдельный аккаунт не создаётся.</small>
      </div>
    </section>
  );
}
