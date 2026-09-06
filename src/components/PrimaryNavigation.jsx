import { Compass, ImagePlus, UserRound } from 'lucide-react';

const ITEMS = [
  { id: 'catalog', label: 'Каталог', Icon: Compass },
  { id: 'create', label: 'Создать', Icon: ImagePlus, primary: true },
  { id: 'profile', label: 'Профиль', Icon: UserRound },
];

export default function PrimaryNavigation({ activeView, onNavigate, portal = false }) {
  const className = [
    'primary-navigation',
    'primary-navigation--bottom',
    portal ? 'primary-navigation--portal-bottom' : '',
    'app-tab-bar',
    'app-tab-bar--redesigned',
  ].filter(Boolean).join(' ');

  return (
    <nav className={className} aria-label="Основная навигация" data-navigation-placement={portal ? 'portal-bottom' : 'bottom'}>
      {ITEMS.map(({ id, label, Icon, primary }) => {
        const active = activeView === id || (id === 'profile' && activeView === 'gallery') || (id === 'create' && ['creator', 'packs'].includes(activeView));
        const itemClassName = [
          'primary-navigation__item',
          active ? 'active' : '',
          primary ? 'app-tab-bar__create' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={id}
            type="button"
            className={itemClassName}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            onClick={() => onNavigate(id)}
          >
            {!primary
              ? <Icon size={19} aria-hidden="true" />
              : <span className="app-tab-bar__plus" aria-hidden="true">+</span>}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
