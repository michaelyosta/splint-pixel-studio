import { LogIn, ShieldCheck } from 'lucide-react';

export default function BrowserAuthPage({ status = 'anonymous', error = null, browserAuthEnabled = true, onLogin }) {
  const isLoading = status === 'loading' || status === 'unknown';
  const unavailable = !isLoading && browserAuthEnabled === false;
  return (
    <section className="browser-auth-page" data-browser-auth-page>
      <div className="browser-auth-card">
        <div className="browser-auth-icon" aria-hidden="true"><ShieldCheck size={28} /></div>
        <p className="eyebrow">SPLINT PIXEL STUDIO</p>
        <h1>{isLoading ? 'Проверяем сессию' : unavailable ? 'Вход временно недоступен' : 'Откройте студию в браузере'}</h1>
        <p className="browser-auth-copy">
          {unavailable
            ? 'Браузерный вход через Telegram сейчас не настроен на сервере. Попробуйте позже или откройте студию в Telegram.'
            : 'В браузере каталог можно просматривать после входа через официальный Telegram Login. Прогресс, профиль и доступы будут теми же, что в Mini App.'}
        </p>
        {error && <p className="browser-auth-error" role="alert">{error}</p>}
        {!isLoading && !unavailable && <button className="primary-button browser-auth-button" type="button" onClick={onLogin} data-browser-telegram-login>
          <LogIn size={18} /> Войти через Telegram
        </button>}
        <small className="browser-auth-note">Анонимные аккаунты и локальные дубликаты не создаются.</small>
      </div>
    </section>
  );
}
