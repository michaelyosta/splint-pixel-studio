# Splint Pixel Studio: Game Experience Roadmap

Research deliverable, companion to `GAME_EXPERIENCE_AUDIT.md` and
`GUIDED_AUTONOMY_BLUEPRINT.md`. No production code was changed in this task.

## 0. Guiding principle

Do not rebuild the product. Prove the core model first: **guidance -> small
success -> feedback -> anticipation -> reward -> choice -> commitment**. If the
first three roadmap items do not make Splint substantially more compelling on
their own, the roadmap is wrong.

## 1. Prioritized hypotheses

### H1. One primary action on Home changes first-session behaviour

- **Current experience**: Home is a dashboard with 6+ equivalent CTAs
  (recommendations, unlock journey, continue/featured, daily, weekly, popular,
  community).
- **Proposed experience**: Home shows one primary node card ("Продолжить путь")
  with preview, time, reward, and one secondary Choice Window (2 options).
- **Expected player effect**: fewer decision points, faster first action,
  clearer "why am I here".
- **Expected metric effect**: `primary_action_started / app_open` increases;
  first-paint rate in session 1 increases; abandonment before first action drops.
- **Implementation scope**: client Home + minimal Director signal
  (`/director/next` or reuse `next_actionable` + history). No schema change.
- **Risk**: players who liked free browsing may feel constrained; content is
  small, so the primary card may repeat.
- **Test**: A/B or staged rollout with analytics events
  (`app_open`, `primary_action_seen/started`).
- **Success criteria**: primary-action start rate > 40% of app opens;
  first-paint within 60s for new users improves; no D1 regression. Until the
  Phase 0 baseline exists, these targets are directional hypotheses, not
  product promises.
- **Rollback criteria**: primary-action start rate flat and first-paint rate
  worsens; revert to dashboard without data loss.

### H2. Reward presentation and XP economy change perceived progression quality

- **Current**: +1 XP per cell, toasts per save batch (up to ~16 per picture),
  XP proportional to grid size, completion reward (+40) drowned by cell XP.
- **Proposed**: visible XP only for milestones; per-cell XP capped or
  normalized by grid size/difficulty; completion/collection rewards carry the
  ceremony; no per-batch toasts.
- **Expected player effect**: rewards feel like achievements, not accounting;
  bigger grids stop being the only "optimal" choice.
- **Expected metric effect**: completion -> next commitment rises; reward
  dismissals/toast noise disappear; no D1 loss.
- **Implementation scope**: `server/services/progression.js` formula/pacing,
  `src/App.jsx` reward handling, tests for new economy.
- **Risk**: economy changes break existing tests and player expectations;
  daily/weekly XP semantics must stay honest.
- **Test**: unit tests for new XP caps and dedupe; staged rollout.
- **Success criteria**: per-session toast count drops to 0-2; completion ->
  next commitment improves vs Phase 0 baseline; level-up ceremonies visible.
- **Rollback criteria**: D1 return drops or completion rate drops; restore
  formula while keeping telemetry.

### H3. Completion must hand off to a committed next action

- **Current**: completion dialog's primary CTA is Share; next picture is a
  text link; closing leaves a 100% canvas; back goes to catalog.
- **Proposed**: staged reveal -> reward panel (role/collection/unlock changes)
  -> CW3 (path / same collection / honest stop); "Завершить на сегодня" is a
  full choice with its own small ceremony.
- **Expected player effect**: the player leaves with a memory and a reason to
  return, not with a file.
- **Expected metric effect**: completion -> next commitment rate rises;
  next-session start within 24h rises; natural-exit events rise without D1 loss.
- **Implementation scope**: `src/views/PlayerView.jsx` completion overlay,
  `src/App.jsx` handlers, analytics events.
- **Risk**: ceremony length may fatigue; share/publish paths must remain
  reachable.
- **Test**: E2E for new completion flow; staged rollout.
- **Success criteria**: >= 35% of completions lead to an immediate next
  commitment or an explicit "done today" (not silent close); D1 return >=
  baseline. Thresholds are provisional until baseline telemetry exists.
- **Rollback criteria**: completion-to-next drops or D1 drops; restore old
  dialog.

### H4. Choice Windows increase felt autonomy without losing direction

- **Current**: no choice windows; freedom is a catalog of equivalent pictures.
- **Proposed**: 2-3 option Choice Windows at defined moments (CW1 theme after
  first picture, CW3 post-completion, CW4 weekly direction, CW5 optional
  mastery); each option shows time and reward; recommended option marked.
- **Expected player effect**: autonomy need (SDT) is met inside a guided spine;
  choice selection creates commitment.
- **Expected metric effect**: choice selection rate > 70% when shown; selected
  path completion rate > baseline; no decision-paralysis exits.
- **Implementation scope**: client Choice Window component + Director options;
  content metadata; analytics events.
- **Risk**: choices without content variety become fake; too many windows
  create fatigue.
- **Test**: E2E + staged rollout of CW3 first, then CW1/CW4.
- **Success criteria**: choice selection rate high; no more than 2 Choice
  Windows per 10-minute session; stop option is selected without shame and
  correlates with higher D1 return.
- **Rollback criteria**: selection rate < 50% or completion rate drops; remove
  the window and default to recommended action.

### H5. Guided first five minutes outrank the current onboarding overlay

- **Current**: app opens to a dashboard; onboarding is a 3-step blocking card
  inside the player; first paint happens only after choosing from many cards.
- **Proposed**: first open -> one starter card -> direct player -> diegetic
  glowing target -> "Первая искра" -> staged first completion -> CW1.
- **Expected player effect**: first-session players feel carried and rewarded;
  no "what do I pick" moment.
- **Expected metric effect**: Time to First Success drops; first-completion
  rate in session 1 rises; D1 return rises.
- **Implementation scope**: client first-run flag + starter card + onboarding
  replacement; analytics; small curated starter template.
- **Risk**: forced path may annoy explorers; starter must be genuinely short.
- **Test**: E2E + staged rollout for new users only.
- **Success criteria**: first paint < 60s for >= 70% of new users;
  first completion in session 1 >= 30%; D1 >= baseline.
- **Rollback criteria**: first-paint or completion rates worse; revert to
  current Home for new users.

## 2. Implementation phases

Phase order is evidence-driven: measurement first, then the surfaces that
create the pull (Home, rewards, completion), then the spine and choices.

### MVP scope control

The guided-autonomy model can be tested with a deliberately small surface.
Everything else is deferred, not designed away:

| In MVP (Phases 0-3) | Deferred |
|---|---|
| Home primary node card | Silhouette previews (Phase 4) |
| One Choice Window component (CW3 first) | CW1 theme window (Phase 5) |
| Completion reward panel + unlock reveal | Identity roles (Phase 6) |
| Milestone XP, no per-cell toasts | Mastery objectives (Phase 5) |
| Session seed on Home | Weekly direction CW4 (Phase 5) |

MVP rule: no new surface may be added to Home; every new surface replaces an
existing one or lives inside the completion/player flow.

### Phase 0: Measurement / baseline

Goal: make the experience measurable without changing player-facing behaviour.

- Expand analytics whitelist in `server/routes/meta.js` and client track calls
  (`src/App.jsx`, `src/views/PlayerView.jsx`).
- Events: `app_open`, `primary_action_seen`, `primary_action_started`,
  `first_paint` (exists), `first_success`, `goal_completed`, `goal_abandoned`,
  `artwork_completed`, `reward_shown`, `reward_claimed_or_viewed`,
  `unlock_preview_seen`, `unlock_completed`, `choice_window_seen`,
  `choice_selected`, `recommendation_opened`, `session_natural_exit`,
  `session_interrupt_exit`, `next_session_started`.
- Add baseline dashboard query for funnel metrics.
- Size: S. Priority: P0. No schema change.

### Phase 1: First 5 minutes

Goal: replace the dashboard with a guided first session.

- Home: one primary node card + one secondary Choice Window; remove popular
  grid and community card from Home; weekly card gets a real action.
- First-run: starter card -> direct player; diegetic onboarding replaces the
  blocking 3-step overlay.
- Recommendations become a secondary/exploration surface (visible behind
  "Ещё варианты"), not the primary rail; the endpoint stays, the hierarchy
  changes.
- Minimal Director: `GET /director/next` (or client-side priority from existing
  signals) returning `primary_action`, `secondary_actions`, `reason`,
  `anticipated_reward`, `estimated_time`.
- Files: `src/App.jsx`, `src/views/PlayerView.jsx`, `src/components/BottomNavigation.jsx`
  (only if Home changes navigation), `src/App.css`, `src/api/client.js`,
  `server/routes/director.js` (new), `server/services/director.js` (new),
  `server/test/director.test.js`, `e2e/first-five-minutes.spec.js`.
- Size: M. Priority: P0/P1. Telemetry required: Phase 0 events.
- Starter template: derive from an existing catalog asset or a small curated
  16x16 piece; no new content pipeline is required for Phase 1.

### Phase 2: Core session loop

Goal: make the moment-to-moment and session loop feel like a game, not labour.

- XP economy: no per-batch toasts; visible milestone XP; cell XP capped or
  normalized by grid size/difficulty. Concrete minimal change: award cell XP
  as `min(cells_painted, ceil(total_cells / 20))` per painting plus a
  difficulty multiplier, so a 1200x1200 painting is not worth 1.44M XP; the
  exact formula is validated by progression tests. Completion and collection
  rewards carry the ceremony (the ceremony sequence itself is Phase 3; Phase 2
  fixes what is rewarded and how it is presented).
- Zone/fragment reveal: mini-reveal animation on completion; fragment appears
  in the artwork preview.
- Mastery signals: visible combo chip (x10/x25/x50), accuracy/efficiency
  summary at completion, optional "без подсказок" objective.
- Files: `server/services/progression.js`, `server/test/progression*.test.js`,
  `src/App.jsx` (`applyAuthoritativeRewards`), `src/features/coloring/*`,
  `src/features/goals/*`, `src/views/PlayerView.jsx`, `src/App.css`.
- Size: M. Priority: P1. Risk: economy tests; staged rollout.

### Phase 3: Completion -> next action

Goal: turn the completion moment into a commitment point.

- Staged reveal (numbered -> grayscale -> color) or keep compare slider as the
  final stage.
- Reward panel showing role/collection/unlock changes; unlock reveal instead
  of silent refresh.
- CW3: path / same collection / "Завершить на сегодня".
- Session seed: if player stops, Home's primary card returns to the exact
  artwork or next node with a cliffhanger line.
- Files: `src/views/PlayerView.jsx`, `src/App.jsx`, `src/features/unlocks/*`,
  `src/App.css`, `e2e/tiled-completion.spec.js` updates, analytics events.
- Size: M. Priority: P1.

### Phase 4: Progression spine

Goal: make "Путь Сплита" a first-class server-owned structure.

- Migration 021: `journey_nodes` (id, chapter, node_type, subject_id,
  position, title, reward_preview, choice_options) or a deterministic
  derivation from existing collections/templates/unlock rules.
- Director becomes the single source of the next action; reuse
  `collectProgressionFacts`, `getUserUnlockSnapshot`, `buildRecommendations`,
  daily/weekly services.
- Unlock previews and silhouettes on Home, Collections and Player; "почти
  открыто" state at >75% progress.
- Identity roles in Profile and completion ceremonies.
- Files: `server/migrations/021_journey_nodes.sql` (+sqlite twin),
  `server/services/director.js`, `server/routes/director.js`,
  `server/services/unlock-service.js` (preview additions),
  `server/db.js` seeds, `src/lib/unlockState.js`, `src/features/unlocks/*`,
  `src/App.jsx`, `src/App.css`, server tests + E2E.
- Size: L. Priority: P1/P2. Dependency: Phase 1 Home surface.

### Phase 5: Choice Windows

Goal: systematic autonomy inside the spine.

- CW1 theme choice after first picture; CW3 post-completion; CW4 weekly
  direction; CW5 optional mastery; CW6 collection next-in-line. MVP order:
  CW3 first (immediate payoff handoff), then CW1; CW4/CW5/CW6 are P3 and only
  if content variety supports them.
- Component: `src/features/choices/ChoiceWindow.jsx` (new), styles, Director
  `choice_window` payload, content metadata (difficulty, est_minutes already
  exist; add chapter/arc fields).
- Analytics: `choice_window_seen`, `choice_selected` with option id.
- Size: M. Priority: P2. Dependency: Phase 4 spine.

### Phase 6: Long-term meta / identity / social

Goal: multi-day identity and recognition.

- Collection completion ceremonies and badges; hero pieces per chapter.
- Role titles ("Раскрывающий", "Хранитель коллекции", "Мастер света") with
  Profile ceremony.
- Social recognition: badge on published works, completion frame, feed
  highlight.
- Content tiers: curate more hero pieces and chapter nodes; add metadata for
  arcs.
- Files: `server/services/progression-achievements.js` (role conditions),
  `server/routes/profiles.js`, `src/App.jsx` profile, feed rendering, content
  seed metadata.
- Size: L. Priority: P2/P3.

## 3. Experiments

Run in order; each experiment isolates one model assumption:

1. E1 (H1): Home primary action vs current dashboard.
2. E2 (H2): Reward economy + presentation.
3. E3 (H3): Completion handoff.
4. E4 (H4): CW3 first, then CW1/CW4.
5. E5 (H5): Guided first 5 minutes (new users only).

Each experiment requires: hypothesis (section 1), analytics events, staged
rollout, success/rollback criteria, and a written result note in
`docs/experience-experiments.md` (new; research artifact).

## 4. Analytics events and funnel

Funnel:

```text
OPEN
  -> PRIMARY ACTION SEEN
  -> PRIMARY ACTION STARTED
  -> FIRST PAINT
  -> FIRST SUCCESS (first goal)
  -> FIRST MEANINGFUL PAYOFF (first completion)
  -> SECOND COMMITMENT (next action started)
  -> SECOND SESSION
  -> DAY 1 RETURN
```

Events (server whitelist additions marked `[new]`):

`app_open [new]`, `primary_action_seen [new]`, `primary_action_started [new]`,
`first_paint`, `first_success [new]`, `goal_completed [new]`,
`goal_abandoned [new]`, `artwork_completed [new]`, `reward_shown [new]`,
`reward_claimed_or_viewed [new]`, `unlock_preview_seen [new]`,
`unlock_completed [new]`, `choice_window_seen [new]`, `choice_selected [new]`,
`recommendation_opened [new]`, `session_natural_exit [new]`,
`session_interrupt_exit [new]`, `next_session_started [new]`.

Existing events to keep: `open_level`, `zone_complete`, `reach_25/50/75/100`,
`publish`, `share_*`, `download_result`, `create_coloring`, `like`, `comment`.

## 5. Success metrics

Do not optimise total time spent. Primary metrics:

| Metric | Definition | Phase |
|---|---|---|
| Time to First Fun | first_paint within 60s for new users | 1 |
| Time to First Success | first goal completion time | 1 |
| First payoff rate | % users completing first picture in session 1 | 1 |
| Next-action clarity proxy | primary_action_started / primary_action_seen | 1 |
| Voluntary continuation | natural exit after a completed node, then next_session_started | 3 |
| Artwork start -> completion | % started pictures completed within 7 days | 2 |
| Completion -> next commitment | next action started within 10 min of completion | 3 |
| Recommendation -> start | recommendation_opened -> first_paint rate | 1 |
| Unlock preview -> pursuit | preview seen -> target opened | 4 |
| Choice selection rate | choice_selected / choice_window_seen | 5 |
| Session abandonment points | exit distribution before first paint / mid-goal / at completion | 0 |
| D1/D3/D7 return | cohort return rates | all |
| Progression depth | median completed artworks per active user | 4 |

## 6. Technical feasibility

| Recommendation | Client files | Server files | Schema/API/migration | Telemetry | Tests | Compatibility risk | Tiled/legacy impact | Telegram WebView constraints | Priority | Size |
|---|---|---|---|---|---|---|---|---|---|---|
| Home primary CTA | `src/App.jsx`, `src/App.css` | `routes/director.js` (new), `services/director.js` (new) | `GET /director/next` | app_open, primary_* | director unit + E2E | Low | None | Keep payload bounded (<50 KB) | P0/P1 | M |
| Analytics baseline | `src/App.jsx`, `src/views/PlayerView.jsx` | `routes/meta.js` | None | new events | server whitelist tests | Low | None | None | P0 | S |
| XP economy | `src/App.jsx` | `services/progression.js` | None (formula change on existing metadata) | reward events | progression tests update | Medium (existing tests/assumptions) | Tiled XP must stay bounded | None | P1 | M |
| Diegetic onboarding | `src/App.jsx`, `src/views/PlayerView.jsx` | None | None | first_success | E2E | Low | Onboarding for tiled maps must not block | No overlay animation heavy loads | P1 | S |
| Completion ceremony | `src/views/PlayerView.jsx`, `src/App.jsx`, `src/App.css` | None (or director for next) | None | artwork_completed, choice_* | E2E tiled-completion updates | Low | Tiled preview must stay bounded | Haptics only; audio conditional | P1 | M |
| Journey spine + Director | `src/lib/unlockState.js`, `src/features/unlocks/*`, `src/App.jsx` | `services/director.js`, `routes/director.js`, `services/unlock-service.js` | `journey_nodes` migration 021 | unlock_preview_seen, unlock_completed | server + E2E | Medium (new source of truth must reuse existing) | Director never reads cell arrays | Bounded payload; no heavy previews | P1/P2 | L |
| Choice Windows | `src/features/choices/ChoiceWindow.jsx` (new), `src/App.css` | `services/director.js` | None (director payload) | choice_window_seen/selected | E2E | Low | None | 2-3 options only; no modal spam | P2 | M |
| Identity roles | `src/App.jsx` profile | `services/progression-achievements.js`, `routes/profiles.js` | Optional role table | role events | server tests | Low | None | None | P2 | M |
| Unlock previews/silhouettes | `src/features/unlocks/*`, `src/App.css` | `services/unlock-service.js` | None (client-side darkened previews) | unlock_preview_seen | E2E | Low | None | Preview images must be bounded | P2 | S/M |
| Collection ceremonies | `src/App.jsx`, collections view | `services/progression.js`/achievements | Optional badge fields | unlock_completed | server + E2E | Low | None | Haptics only | P2/P3 | M |
| Social recognition | feed/profile rendering | `routes/feed.js`, `routes/posts.js` | Optional badge on posts | publish events | E2E | Low | None | None | P3 | S |
| Audio (conditional) | player | None | None | none | E2E | Medium | None | Telegram WebView audio support uncertain; haptics first | P3 | S |

## 7. Risks and dependencies

Risks:

1. Content scarcity: the spine needs curated starter/hero/collection nodes.
   Mitigation: Phase 1 can run with one starter + existing catalog; Phase 4
   needs more hero pieces and metadata.
2. Economy change may break existing tests and daily/weekly semantics; keep
   server-authoritative invariants and run full progression suites.
3. Director as new source of truth can drift from unlock/recommendation
   services; mandate reuse of existing facts and one code path.
4. Tiled/legacy parity: any new reward or ceremony must behave identically;
   tiled responses stay bounded, never load cell maps.
5. Telegram WebView: no guaranteed audio; limited animation budget; keep
   ceremonies haptic + CSS-light.
6. Streak and daily tasks must not become pressure systems; success criteria
   include D1/D7 and qualitative "stop" behaviour.

Dependencies:

- Phase 1 depends on Phase 0 telemetry.
- Phase 3 depends on Phase 2 reward presentation (else handoff is hollow).
- Phase 4 depends on Phase 1 Home surface.
- Phase 5 depends on Phase 4 spine content.
- Phase 6 depends on Phase 4 identity data.

## 8. What NOT to build yet

- Audio without WebView proof.
- Energy, lives, timers with punishment, paid streak shields.
- Leaderboards, leagues, guilds, real-time chat.
- Endless procedurally generated content.
- Per-cell XP toasts or any per-action reward spam.
- New dashboard cards or new Home sections.
- Purchase-adjacent progression until payment mode is production-ready.
- Reflex mini-games, combat, or time-attack pressure.

## 9. First-three-items self-check

If we implement only Phase 0 (measurement), Phase 1 (first 5 minutes) and
Phase 2 (core session loop with economy and reveal feedback), does Splint
become substantially more interesting?

Yes. The change is structural, not cosmetic:

- A new user no longer faces a dashboard; they are guided into a short first
  picture and get their first transformation within minutes.
- Returning users see one primary node instead of six equivalent cards.
- Rewards stop being accounting noise and become milestone moments.
- Zone/fragment reveals make every 30-90 seconds feel like visible progress.

That combination is enough to test the entire guided-autonomy model. If those
three phases do not move first-session completion and D1 return, the problem
is not pacing or UI; it is the core coloring activity itself, and Phase 4+
spine work should not proceed without revisiting that finding.

## 10. Next research artifact

Create `docs/experience-experiments.md` when E1 starts: hypothesis, variant
diff, event definitions, cohort rules, success/rollback numbers, and a written
decision per experiment. This file is a research artifact, not production code.
