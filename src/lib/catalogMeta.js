export const CATALOG_PAGE_SIZE = 12;

export const CREATOR_GRID_OPTIONS = [16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 192, 256, 384, 512, 768, 1024, 1200].map((size) => ({
  label: `${size}×${size}`,
  w: size,
  h: size,
}));

export function gridDetailMeta(size) {
  if (size > 160) return { title: 'Studio', load: 'Tiled', hint: 'Large maps load in bounded tiles with one Canvas and delta-only progress.' };
  if (size <= 24) return { title: 'Эскиз', load: 'Легко', hint: 'Крупные пиксели и короткая сессия.' };
  if (size <= 48) return { title: 'Баланс', load: 'Комфортно', hint: 'Хорошая детализация для большинства изображений.' };
  if (size <= 80) return { title: 'Детально', load: 'Дольше', hint: 'Сохраняет мелкие формы и текстуры.' };
  if (size <= 96) return { title: 'Очень детально', load: 'Требовательно', hint: 'Для мощных устройств и долгих сессий.' };
  return { title: 'Студийная', load: 'Экспериментально', hint: 'Максимум текущего renderer: лучше использовать на современных устройствах.' };
}

export const DIFFICULTIES = {
  easy: { label: 'Легко', width: 24, height: 24, colors: 8 },
  medium: { label: 'Средне', width: 32, height: 32, colors: 10 },
  hard: { label: 'Сложно', width: 40, height: 40, colors: 12 },
};

export const MOODS = [
  { id: '', label: 'Все' },
  { id: 'calm', label: 'Спокойно' },
  { id: 'cozy', label: 'Уютно' },
  { id: 'focus', label: 'Фокус' },
];

export const THEMES = [
  { id: '', label: 'Все' },
  { id: 'night-city', label: 'Ночной город' },
  { id: 'forest', label: 'Лес' },
  { id: 'space', label: 'Космос' },
  { id: 'cozy', label: 'Уют' },
  { id: 'travel', label: 'Путешествия' },
  { id: 'sea', label: 'Море' },
];

export function formatDifficulty(value) {
  return DIFFICULTIES[value]?.label || value || 'Своя';
}
