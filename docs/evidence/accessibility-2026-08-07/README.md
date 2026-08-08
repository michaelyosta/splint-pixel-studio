# Accessibility evidence - 2026-08-07

Команда воспроизведения:

```text
$env:ACCESSIBILITY_EVIDENCE="1"; npm run test:e2e -- --project=chromium --grep "Accessibility evidence"
```

Собрано 6 снимков в Chromium. Точные значения - в metrics.json.

Локальные проверки (не заменяют физический screen reader или реальный Telegram WebView):

- classic-360: 360x800, no-horizontal-overflow=true, DOM=134, canvas=1, backing=162000, live-regions=4, text-overflow=0
- classic-390: 390x844, no-horizontal-overflow=true, DOM=134, canvas=1, backing=192660, live-regions=4, text-overflow=0
- classic-430: 430x932, no-horizontal-overflow=true, DOM=134, canvas=1, backing=250260, live-regions=4, text-overflow=0
- reduced-motion-390: 390x844, no-horizontal-overflow=true, DOM=134, canvas=1, backing=192660, live-regions=4, text-overflow=0
- forced-colors-390: 390x844, no-horizontal-overflow=true, DOM=134, canvas=1, backing=192660, live-regions=4, text-overflow=0
- tiled-1200-390: 390x844, no-horizontal-overflow=true, DOM=132, canvas=1, backing=216116, live-regions=3

Проверено keyboard-only: стрелки/Home/End/цифры, Enter/Space для закраски, + и - для масштаба, 0 для обзора. Palette и HUD работают с клавиатуры.
Live-фидбек ограничен: один sr-only status на сессию и один на канвас, без per-cell DOM.
Reduced motion: переходы и анимации обнулены; закрашивание остаётся рабочим.
Forced colors: выбранный цвет получает outline Highlight, не полагаясь на цвет.
HUD по дизайну лежит поверх канваса; dock, actions и summary не пересекаются между собой.

Ограничения: metrics собраны в Chromium dev-server прогоне; iPhone/Pixel и Android keyboard/contrast и физический screen reader остаются внешними release-gates.
