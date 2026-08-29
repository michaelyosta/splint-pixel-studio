import { Compass, ImagePlus, Send, Sparkles, UserRound } from 'lucide-react';

const ITEMS = [
  { id: 'home', label: 'Главная', Icon: Sparkles },
  { id: 'catalog', label: 'Каталог', Icon: Compass },
  { id: 'create', label: 'Создать', Icon: ImagePlus, primary: true },
  { id: 'feed', label: 'Сообщество', Icon: Send },
  { id: 'profile', label: 'Профиль', Icon: UserRound },
];

export default function BottomNavigation({ activeView, onNavigate }) {
  return (
    <nav className="app-tab-bar app-tab-bar--redesigned" aria-label="Основная навигация">
      {ITEMS.map(({ id, label, Icon, primary }) => {
        const active = activeView === id || (id === 'profile' && activeView === 'gallery') || (id === 'create' && ['creator', 'manual', 'packs'].includes(activeView));
        return (
          <button
            key={id}
            type="button"
            className={`${active ? 'active ' : ''}${primary ? 'app-tab-bar__create' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            onClick={() => onNavigate(id)}
          >
            {primary ? <span className="app-tab-bar__plus" aria-hidden="true">+</span> : <Icon size={19} aria-hidden="true" />}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
