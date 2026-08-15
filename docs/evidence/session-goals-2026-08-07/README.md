# Session goals visual evidence — 2026-08-07

This evidence captures the existing goal-card control (`?sessionGoals=control`) for the 30-second / 3-minute / 10-minute player goal loop before the first paint and while the timer is running.

Recovery Canvas defaults to the explicit no-goals treatment. Use `?sessionGoals=hidden` to reproduce it deterministically; the treatment hides only the goal card and its local timer loop. Server progress/rewards, save status, target guidance, palette/dock and Specials remain active.

Verified viewports:

- 360×800;
- 390×844;
- 430×932.

For every viewport and both states, `metrics.json` confirms:

- no horizontal overflow;
- the goal card stays inside the viewport;
- the goal card does not overlap the top bar or Canvas;
- no visible text container scrolls or clips.

Browser acceptance also covers offline pause, reload/resume reconstruction, server-verified completion, transition to the next goal, and absence of duplicated completion rewards. The same suite passed on Desktop Chrome, Mobile iPhone, and Mobile Pixel.

The screenshots were visually reviewed after capture. The idle and running cards remain legible, preserve the playable Canvas area, and match the existing dark/cyan/gold visual language.
