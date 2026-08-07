# Splint Pixel Studio: Game Experience Audit

Research deliverable. No production code was changed in this task; the only
repository changes are the three experience documents (`GAME_EXPERIENCE_AUDIT.md`,
`GUIDED_AUTONOMY_BLUEPRINT.md`, `GAME_EXPERIENCE_ROADMAP.md`).

## 1. Executive diagnosis

Splint has a large and technically serious set of game systems: server-authoritative
XP/levels/streak/achievements, daily and weekly challenges, session goals, unlock
rules, recommendations, collections and a social layer. The absence is not
"gamification". The absence is **direction, anticipation and meaningful choice**:

1. Home is a dashboard of equivalent destinations, not a guided starting point.
2. XP and challenges measure labour (cells), not mastery or experience quality.
3. Choices exist but are inventory choices, not consequential decisions.
4. Completion has a good reveal primitive but a weak handoff to the next action.
5. The player has no identity fantasy and no skill to feel competent about.

The product, as experienced from code and tests, is a *feature-rich coloring
utility with game cosmetics*. The target is a *guided creative game*.

## 2. Method, scope and evidence base

### 2.1 What was audited

- Client flow: `src/App.jsx`, `src/views/PlayerView.jsx`, `src/components/BottomNavigation.jsx`,
  `src/api/client.js`, `src/features/goals/*`, `src/features/unlocks/*`,
  `src/features/coloring/*`, `src/lib/playLoop.js`, `src/lib/unlockState.js`,
  `src/lib/unlockRequests.js`, `src/lib/pixelColoring.js`.
- Server: `server/services/progression.js`, `server/services/progression-achievements.js`,
  `server/services/recommendations.js`, `server/services/unlock-service.js`,
  `server/routes/meta.js`, `server/routes/unlocks.js`, `server/routes/colorings.js`,
  migrations `015_product_engagement.sql`, `018_weekly_challenges.sql`,
  `020_unlockable_content.sql`, `server/db.js` seed rules.
- Docs: `docs/PROGRESSION_CHECKPOINT.md`, `docs/UNLOCKS_CHECKPOINT.md`,
  `docs/TILED_PLAYER_UX_CHECKPOINT.md`, `docs/PROJECT_MAP.md`, evidence READMEs.
- Tests and E2E: `test/*`, `src/lib/*.test.js`, `server/test/*`, `e2e/session-goals.spec.js`,
  `e2e/unlocks-recommendations.spec.js`, `e2e/tiled-completion.spec.js`.

### 2.2 Verification executed in this workspace

- `npm test`: **265 passed / 0 failed** (root unit tests, including tiled engine,
  session goals, unlock state, grid math).
- Repository branch: `codex/tiled-player-1200`; worktree clean before this task.
- The existing evidence directories confirm visual QA, accessibility, session-goal
  and tiled-player measurements on 360/390/430 widths with no horizontal overflow
  and bounded DOM (`docs/evidence/*`).

### 2.3 Honest limitations

- This session has no subagent/multi-agent tools, so the requested independent
  roles (Core Loop, Progression/Economy, FTUE, Psychology, UX/IA, Content Director,
  Analytics, Adversarial) were executed as eight separate structured passes by
  the main agent, then cross-checked adversarially.
- Screenshots exist in the repo, but this model has no image input, so visual
  claims are based on JSX/CSS structure, DOM metrics and E2E assertions, not on
  pixel review.
- Live user telemetry beyond the small event set in `server/routes/meta.js`
  does not exist yet; behavioural conclusions are therefore evidence-based
  inferences from code paths, not production funnels.

## 3. Current player journey (state machine)

Notation: `?` marks a transition with no strong direction (a "dead zone").

```text
OPEN APP
  -> HOME (parallel loading: catalog, today, streak, achievements, collections,
           profile, mine, product profile, unlocks snapshot, recommendations)
  -> ?
HOME
  -> SELECT CONTENT (recommendation strip / unlock journey / continue / featured /
                     daily / weekly / popular / community)
  -> ?
PLAYER OPEN (template + progress + zones; first time: onboarding overlay)
  -> FIRST PAINT (session goal "first-progress")
  -> SESSION GOALS (first-progress 30s -> zone 3m -> picture 10m)
  -> PROGRESS (per-cell XP, save batches, zone chips, combo)
  -> COMPLETION (server-verified artwork -> overlay dialog)
  -> POST-COMPLETION (share / save / publish / next / catalog)
  -> ?
NEXT SESSION (Home again)
  -> ?
```

### 3.1 Transition table

| Transition | Trigger | Screen | Primary CTA | Competing CTAs | Info shown | Player motivation | Expected emotion | Reward | Anticipation | Next-action clarity | Freedom | Friction | Exit probability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OPEN -> HOME | Launch / Telegram open | Home loading skeletons | None until load | None visible yet | Skeleton | Curiosity | Mild anticipation | None | None | Low | High | 6+ parallel requests before content | Medium |
| HOME -> HOME (settled) | Data loaded | Home | Featured/Continue card (rendered 4th) | Streak/XP strip, recommendations (up to 8), unlock journey, daily, weekly, popular (4), community | Greeting "выберите короткую сессию или продолжите картину"; streak; XP-to-level; unlock requirements | Open-ended | Overwhelmed / "что выбрать?" | None | XP bar and unlock bars exist but no destination | Low: 6+ equivalent CTAs | Too high | Scroll-heavy dashboard | Medium-high on first visit |
| HOME -> PLAYER | Any card click | Player | Paint first highlighted target | Goal card, palette, menu | Template, progress ring, context goal, goal card | Try the thing | Curiosity | None until first stroke | Weak | Medium (goal card gives 30s first target) | Medium | Onboarding overlay blocks first seconds | Low once player opens |
| PLAYER -> FIRST PAINT | Tap highlighted cell | Player | Canvas target | Palette, menu | Haptic, filled cell, goal timer starts | First visible transformation | Delight | +XP per cell (batch toast) | Low | High inside painting | Medium | Save queue runs async; toasts may interrupt | Low |
| FIRST PAINT -> GOAL DONE | 3-10 correct cells | Player | Goal card celebration | Continue painting | "Цель выполнена", haptic | Small win | Satisfied | XP | Next goal label | Medium | Medium | Celebration 5s | Low |
| GOAL -> PICTURE | 30s / 3m / 10m ladder | Player | Goal card | Menu | Timer, cells remaining | Finish the segment | Momentum or time pressure | XP | Zone chips | Medium | Medium | Timer implies pressure, but no penalty | Medium at natural breaks |
| COMPLETION | Last correct cell | Player overlay | Share (primary button) | Save, publish, next picture, catalog | Compare slider, confetti, +XP, title | Ceremony | Pride | Completion XP + artwork + unlocks | Unlock refresh happens behind the scenes, no reveal ceremony | Low: primary is share, next is a text link | Medium | Tiled preview can lag render | Medium |
| POST-COMPLETION -> NEXT SESSION | Close dialog / back | Player at 100% or Catalog | Back to catalog | Nothing new | Completed canvas | Loose end | "И что теперь?" | None | None | Low | High | No session seed, no cliffhanger | High after first completion |

### 3.2 Dead zones (`?`)

1. **After Home settles**: no answer to "what should I do right now". Greeting
   delegates choice to the player.
2. **At completion**: after the ceremony, the strongest affordance is sharing;
   the next commitment is a secondary link, and closing the dialog leaves the
   player on a fully completed canvas.
3. **Weekly challenge**: the Home weekly card navigates to the catalog instead
   of starting or explaining the weekly goal.
4. **New player**: before the first picture there is no promise, no mini-goal,
   no path; the unlock journey on Home shows requirements the player cannot yet
   act on ("Нужен уровень 2").
5. **After first picture**: no explicit "what opened because of this" moment;
   unlock state silently refreshes on Home.

## 4. Current loops

### 4.1 Moment-to-moment

```text
SEE TARGET (highlighted cluster / next zone)
  -> ACT (tap/brush)
  -> MICRO FEEDBACK (fill, haptic)
  -> SAVE (async batch)
  -> REWARD TOAST "+N XP"
  -> NEXT TARGET (route or guide)
```

Strengths: target highlighting exists, camera routing exists, wrong-cell feedback
exists, tiled guide auto-advances after a color is finished. Weakness: the loop
is closed by a labour counter (+N XP per batch), not by visible transformation
or mastery feedback.

### 4.2 Session loop

```text
OPEN -> GOAL CARD -> PAINT -> GOAL COMPLETED -> NEXT GOAL -> PICTURE COMPLETED
  -> COMPLETION DIALOG -> SHARE/SAVE/PUBLISH -> EXIT
```

Strengths: server-verified goals, offline pause, bounded durations. Weakness:
goals are cell counts; completion is an end state, not a handoff.

### 4.3 Meta loop

```text
PLAY -> EARN XP (per cell) -> LEVEL -> UNLOCK RULES -> RECOMMENDATIONS -> PLAY
```

XP is not transformation: levels change a number, unlocks are a permission flag.
The player's profile/world/collection does not visibly transform except a count
increment on the collections screen.

### 4.4 Daily/weekly

Daily: 20 correct cells on a deterministic template, +30 XP. Weekly: 100 new
cells, +100 XP. Both are counters with no presentation arc: progress bars exist,
the weekly card has no start action, completion has no ceremony.

## 5. Evidence from repository

### 5.1 Home is a dashboard, not a director

`src/App.jsx` `renderHome()` renders, in order: greeting, streak/XP strip,
`RecommendationsStrip` (up to 8 cards), `UnlockJourneyCard`, continue block or
featured block, daily card, weekly card, "popular" grid (4 cards), community card.
There is no single primary action; six or more CTAs compete on the first screen.
The weekly card's `onClick` is `navigatePrimary('catalog')` — it does not start
the weekly goal.

### 5.2 XP is cell labour, and it inflates with grid size

`server/services/progression.js`:

```js
export const XP_PER_LEVEL = 1_000;
export const XP_REWARDS = Object.freeze({
  correct_cell: 1,
  template_complete: 40,
  daily_challenge: 30,
  weekly_challenge: 100,
});
```

One correct cell = 1 XP. A 24x24 picture is worth ~576 XP, a 32x32 ~1024 XP, a
1200x1200 up to 1,440,000 XP. Leveling is proportional to grid size (labour),
not to challenge or experience quality. This also means "level 2 + 1 completed
artwork" (starter-path unlock) is reached by painting roughly one medium picture,
and large maps trivialise every XP-based unlock rule.

### 5.3 Reward presentation is noisy

`src/App.jsx` `applyAuthoritativeRewards` calls `showNotice('+'+amount+' XP')`
for every non-idempotent save response. The save queue sends up to 64 cells per
batch, so a single picture can fire ~16 "+64 XP" toasts. Micro-rewards become
noise and the completion reward (+40 XP) is drowned by cell XP.

### 5.4 Session goals are cell counters with hard timers

`src/features/goals/sessionGoals.js`: first-progress 30s (3-10 cells), zone 3m
(48-256 cells), picture 10m (256-1024 cells). Timer expiry simply advances to
the next goal with text "Время вышло — следующая цель уже идёт". There is no
skill signal: accuracy, efficiency, combo and hints are not part of goals.
Combo exists but is displayed only in the bottom sheet and resets on wrong taps.
Hints are 5 local-only, not server-authoritative.

### 5.5 Unlock system is a permission check, not a journey

`server/services/unlock-service.js` is technically excellent: durable rules,
concurrency-safe grants, bounded snapshots, stable reason codes. But the seeded
path (`server/db.js`) is: starter collection requires level 2 + 1 completed
artwork; master gallery requires completing the starter collection; streak badge
requires streak 3; premium gallery is purchase-only. There is no editorial
sequence of pictures, no hero-piece reveal, no "next unlock" preview inside the
player. `getNextActionableUnlocks` ranks by unmet rules/progress, but the UI
shows only two subjects on a card.

### 5.6 Recommendations are affinity-ranked inventory

`server/services/recommendations.js` scores by theme/collection/difficulty
affinity and returns up to 8 cards. Every card opens the same player; there is
no reason for a player to prefer one over another beyond artwork taste, and no
decision moment. Cold start uses a stable hash — good determinism, but no
onboarding intent.

### 5.7 Completion is a strong reveal with a weak handoff

`src/views/PlayerView.jsx`: compare slider before/after, confetti, haptics,
"Картина раскрыта!", +XP row, then actions: Share (primary), Save, Publish,
"Следующая: <title>", "К каталогу". The reveal is good; the next commitment is
secondary. For tiled art the full result may still be rendering, so the preview
can be a thumbnail. There is no staged reveal (numbered -> grayscale -> color),
no collection-completion moment, no "what just unlocked" reveal.

### 5.8 Analytics are minimal and not experience-oriented

`server/routes/meta.js` whitelist: `open_level`, `first_pixel`, `zone_complete`,
`reach_25/50/75/100`, publish/share/download, create, like, comment, camera and
engine events. There is no `app_open`, `primary_action_seen/started`,
`reward_shown/claimed`, `choice_window_seen/selected`, `unlock_preview_seen`,
`session_natural_exit`, `next_session_started`. The first 5 minutes cannot be
measured beyond `first_pixel`.

### 5.9 Tiled player is a technical strength

`docs/TILED_PLAYER_UX_CHECKPOINT.md` and E2E confirm bounded DOM (one canvas,
~130 nodes), camera persistence, minimap, color-complete auto-advance, wrong-cell
chips, haptics, and 1200x1200 paint-ability. This makes large art *playable*,
but does not make it a *game*: the guidance is at the "where is the next cell"
level, not at the "why am I doing this" level.

### 5.10 Unit tests

`npm test` in this workspace: 265/265 pass. The tests cover engine correctness,
session-goal state machine, unlock normalization, recommendation bounding and
grid math. They do not test emotional arcs, next-action clarity or reward
meaningfulness — which is the gap this audit addresses.

## 6. External research synthesis

Sources were retrieved from OpenAlex/PubMed-style APIs during this task:

- Ryan, Rigby, Przybylski (2006), "The Motivational Pull of Video Games: A
  Self-Determination Theory Approach", *Motivation and Emotion*,
  DOI 10.1007/s11031-006-9051-8.
- Nunes & Drèze (2006), "The Endowed Progress Effect: How Artificial Advancement
  Increases Effort", *Journal of Consumer Research*, DOI 10.1086/500480.
- Kivetz, Urminsky & Zheng (2006), "The Goal-Gradient Hypothesis Resurrected",
  *Journal of Marketing Research*, DOI 10.1509/jmkr.43.1.39.
- Sweetser & Wyeth (2005), "GameFlow: A Model for Evaluating Player Enjoyment
  in Games", *Computers in Entertainment* 3(3), DOI 10.1145/1077246.1077253;
  and Revisiting GameFlow heuristics (2012).
- Zagal et al. / CHI (2022), "A Game of Dark Patterns: Designing Healthy,
  Highly-Engaging Mobile Games", DOI 10.1145/3491101.3519837.
- Product summaries for Duolingo and Animal Crossing: New Horizons were fetched
  from Wikipedia's REST API.

### 6.1 What the research says, mapped to Splint

| Framework / effect | Principle | Concrete Splint mechanic (current or proposed) |
|---|---|---|
| SDT: competence | Player needs to feel effective | Current: wrong-tap error, combo, % progress. Missing: accuracy/efficiency signal, progressive challenge. |
| SDT: autonomy | Meaningful choices | Current: 40-card inventory. Missing: 2-3 consequential Choice Windows. |
| SDT: relatedness | Social recognition | Current: feed/likes/comments. Missing: identity titles, collection badges, recognition after completion. |
| Flow/GameFlow | Clear goals, immediate feedback, challenge-skill balance | Current: session goals and target highlighting are clear. Missing: difficulty selection, escalating challenge, "you got better" feedback. |
| Endowed progress | Artificial advancement increases effort | Current: first goal 3-10 cells, 20-cell daily, unlock progress bars. Use honestly: always show real server-verified progress; never fake a grant. |
| Goal-gradient | Effort accelerates near a visible goal | Current: unlock requirements show progress; weekly bar exists. Missing: "almost there" presentation at completion of a picture or collection. |
| Curiosity/anticipation | Future reward must exist in mind before receipt | Current: locks and bars. Missing: silhouettes, previews of locked content, next-unlock teaser inside player, reveal sequence. |
| Collection motivation | Completion of sets | Current: collection cards with counters. Missing: collection arc, hero pieces, completion ceremony. |
| Dark patterns | Guilt/FOMO/time pressure harm trust | Current risk: Home says "сыграйте сегодня" when streak is 0; timer-expiry copy; no shields; weekly card without action. All are mild, but they are present. |

### 6.2 Ethical boundary

The blueprint must never add: paid shields as monetisation, punishment for
absence, artificial urgency, hidden costs, deceptive UI, variable-ratio loops
for their own sake, or time-in-app optimisation. The streak must remain a record
of a good habit, not a threat.

## 7. Benchmark teardown

Ten products, three groups. Transferable items are marked, and non-transferable
items are called out; no mechanic is copied blindly.

### 7.1 Group A: closest competitors (coloring / casual creative)

| Product | What's next? | First success | Anticipation | Future reward | Where's choice | Meaningful? | Session start | Session end | Why another step | Transferable | Not transferable |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Happy Color | Free catalog + daily picture; browsing is the default | Seconds (large cells, first tap) | Weak; mostly visual | Daily streak/energy | Catalog grid | Low: any picture | Resume last / catalog | Completion popup + share | Visual appeal of next art | Daily featured, completion moment, large easy cells | Energy/lives pressure; pay-to-skip |
| Pixel Art Color by Number | Album/category grid | Seconds | Low | Album completion | Grid | Low | Grid | Save/share | Album completion | Album/collection framing | Ads/reward-video dependency |
| Colorfy / Zen Color | Category list | Seconds | Low | None/weak | Grid | Low | Grid | Save | None | Clean palette UX | No progression to copy |

### 7.2 Group B: progression exemplars

| Product | What's next? | First success | Anticipation | Future reward | Where's choice | Meaningful? | Session start | Session end | Why another step | Transferable | Not transferable |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Candy Crush Saga | Map with next level; locked map nodes | ~1 minute (level 1 easy) | Locked nodes + level previews | Stars, boosters, new mechanics | Star choice on replay (3 vs 1 star) | Medium | Map auto-advance to next level | Level result screen with next level | "One more level" goal-gradient | Linear map, star mastery, result->next handoff | Reflex/match-3 physics; lives; hard pay gates |
| Duolingo | Path with next lesson; daily quests | Under 1 minute | Path nodes, league positions, quests | XP, badges, streak | Path branches (limited) | Medium | "Continue" primary lesson | Celebration -> next lesson | Streak + path progress + daily quest | Strong default primary CTA, path spine, celebration -> next, honest streak | XP inflation risk; league pressure |
| Hades | Narrative + mirror + weapon unlocks after every run | Minutes (first escape attempt) | Foreshadowing of bosses/gods; unlock teasers | Boons, weapons, story beats | Mirror/weapon/boon builds | High: build consequences | Pick weapon + boon -> run | Death/escape -> narrative + upgrade -> next run | "See what comes next" across systems | Connected meta loop, unlock teasers, choice consequence | Roguelike combat complexity |
| Pokémon GO | Daily tasks + research + nearby | Minutes | Eggs, silhouettes, quest lines | Eggs, evolutions, event research | Which research/raid | Medium-high | Map with nearby | Task completion | Egg hatching, collection | Collection + silhouette anticipation, daily quest line | Location/AR infrastructure |

### 7.3 Group C: guided-autonomy exemplars

| Product | What's next? | First success | Anticipation | Future reward | Where's choice | Meaningful? | Session start | Session end | Why another step | Transferable | Not transferable |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Animal Crossing: NH | Nook tasks + daily announcements; free-form after | Minutes | Museum/collection slots, house expansions | Furniture, museum, island changes | Nearly unlimited | Medium-high | Island with announcement | Natural free-form | Visible island transformation | Daily announcement, "do 2-3 things then free", visible world transformation | Full simulation scope |
| Stardew Valley | Quest journal + calendar; free-form | Minutes | Calendar events, upgrades | Crops, relationships, buildings | Many activities | High: consequences | Farm at day start | Sleep -> summary -> next day | Summary + next-day promises | Day summary, goal journal, honest stop | Complex crafting/economy |
| Sky: Children of the Light | Guided spirits -> constellation; social | Minutes | Constellation nodes, spirit previews | Cosmetics, story, wings | Spirit order + cosmetics | Medium | Guided path | Light ceremony | Constellation completion + social gifting | Constellation/collection spine, ceremony moments | MMO social scope |

### 7.4 Teardown synthesis

Transferable patterns:

1. One obvious primary CTA at session start (Duolingo "Continue", Candy Crush map, ACNH announcement).
2. A visible spine with locked nodes and previews (Duolingo path, Candy Crush map, Sky constellation).
3. Completion -> next commitment handoff (Candy Crush result screen, Duolingo celebration, Stardew day summary).
4. Collection + silhouette anticipation (Pokémon GO, Sky, ACNH museum).
5. Meaningful consequence in choices (Hades builds, Stardew activity tradeoffs).
6. Honest daily loop that is a small set of tasks, not an open inventory (Duolingo quests, ACNH daily announcements).

Non-transferable:

1. Reflex match-3 physics, combat, AR, real-time social, complex economy.
2. Time pressure as a retention lever (energy, leagues) - explicitly forbidden by this task.
3. Unlimited open world without guidance (Stardew's freedom works only after a long guided intro and a rich simulation).

## 8. Top root causes

For each root cause: why it is a cause and not a symptom, what code confirms it,
falsification test, and the player moment that changes.

### RC1. Systems exist in parallel; there is no progression spine

**Statement.** Splint has many destinations (recommendations, unlocks, daily,
weekly, continue, catalog, feed, collections) and no single "what the game wants
me to do now".

**Why cause, not symptom.** A symptom (e.g., "users don't return") could be
explained by content volume or performance; but the code shows the UI itself
never answers "what next" — it presents an open dashboard by construction
(`renderHome` order, six+ CTAs, weekly card without action). Even with 1,000
pictures, the same wall of equal cards would exist.

**Code evidence.** `src/App.jsx` Home sections; `RecommendationsStrip` renders
up to 8 independent open buttons; `UnlockJourneyCard` renders requirement text
but no path; weekly card navigates to catalog.

**Falsification test.** If this hypothesis were false, a new player would
already choose one CTA quickly and the rest would be clearly secondary. In the
code, every CTA is the same style, same size, same result (open player or
catalog), and the primary (continue/featured) is rendered after the
recommendations and unlock journey.

**Moment that changes.** The first 10 seconds after Home settles: player should
see one primary mission and at most one secondary choice.

**Is this XP compensation?** No. The fix removes surfaces rather than adding
badges.

### RC2. Rewards measure labour, and presentation hides meaning

**Statement.** XP is per correct cell and scales with grid size; rewards are
presented as repeated toasts; challenges are cell counters.

**Why cause, not symptom.** Reward value is defined by the server formula
(`XP_REWARDS.correct_cell = 1`, `XP_PER_LEVEL = 1000`). A 1200x1200 picture
grants up to 1.44M XP, so progression is a labour meter. The UI then surfaces
that meter as "+N XP" toasts per save batch.

**Code evidence.** `server/services/progression.js`; `src/App.jsx`
`applyAuthoritativeRewards`; daily target `Math.min(20, cellCount)` and weekly
target 100 cells.

**Falsification test.** If rewards were meaningful, completing a picture or a
collection would visibly change the player's state more than a level number, and
the reward cadence would have distinct tiers. In code, the completion reward is
the same currency as cell rewards and is dwarfed by them.

**Moment that changes.** The 3-5 minute session milestone and the completion
moment: player should feel "I finished something" with a tiered payoff, not a
repeat of the same toast.

**Is this XP compensation?** This is the opposite: the proposal devalues cell
XP and raises milestone rewards.

### RC3. Choices are inventory, not decisions

**Statement.** Freedom is a catalog of equivalent pictures; there are no
Choice Windows with 2-3 consequential options.

**Why cause, not symptom.** Decision paralysis is structurally encoded: every
recommendation/popular/catalog card opens the same player with the same goal
system. No option changes session length, challenge, reward tier or next
content in a way the UI explains.

**Code evidence.** `RecommendationsStrip` cards; `renderHome` popular grid;
`continueToRecommendation` just opens another coloring; there is no
`choice_window` concept in code or analytics.

**Falsification test.** If choices were meaningful, choosing one would change
the following session (e.g., different goal, different reward, different next
content). In code, all paths converge on the same player state.

**Moment that changes.** After completion and at session start: 2-3 options
with visible consequences.

**Is this XP compensation?** No.

### RC4. Completion reveals but does not hand off

**Statement.** The completion ceremony is a good reveal primitive with a weak
next-action structure: share is primary, next is a link, and post-completion
leaves the player on a 100% canvas.

**Why cause, not symptom.** The ceremony code exists and is technically good
(compare slider, confetti), but the transition graph after completion contains
two dead zones (`?`): post-completion state and next session start. The
handoff is not a designed commitment point.

**Code evidence.** `src/views/PlayerView.jsx` completion actions order; `onContinue`
uses the next recommendation; closing the dialog returns to a completed player;
back button goes to catalog.

**Falsification test.** If the handoff were strong, completion would visibly
lead to a choice ("continue path / another in collection / done today") with an
expected reward for each. It currently leads to share/publish/catalog.

**Moment that changes.** The 8-15 minute payoff and the next session: player
should leave with a reason to come back, not with a completed file.

**Is this XP compensation?** No.

### RC5. No skill, no mastery signal, no identity

**Statement.** Coloring-by-numbers in Splint is visual search + tapping; the
game never tells the player "you got better", and there is no fantasy of who
the player is becoming.

**Why cause, not symptom.** The code has no accuracy, efficiency, route-quality
or mastery objective; combo is decorative; difficulty is metadata only;
profile is a metrics page ("Любит раскрашивать пиксели по номерам").

**Code evidence.** `src/lib/pixelColoring.js` `findRewardingColor` picks the
smallest color (good micro-guidance, not mastery); `src/features/goals/*`
count cells; `server/services/progression-achievements.js` counts completions;
profile copy in `src/App.jsx` `renderProfile`.

**Falsification test.** If mastery existed, there would be a measurable skill
dimension (accuracy, efficiency, optional challenge) and a visible identity
progression. There is neither.

**Moment that changes.** The 30-90 second small win and the multi-day return:
player should feel "I became more precise/faster" and "I am becoming a
restorer/collector".

**Is this XP compensation?** No; the proposal adds skill signals, not badges.

## 9. PX findings

Severity scale: PX0 experience breaker, PX1 large engagement loss, PX2 visible
weakening, PX3 polish.

| # | Severity | Player moment | Code/screen | Expected emotion | Actual likely emotion | Why the gap | Design principle |
|---|---|---|---|---|---|---|---|
| 1 | PX1 | First seconds on Home | `renderHome` 6+ equivalent CTAs | "I know what to do" | "What do I pick?" | No primary action; no path | ONE PRIMARY CTA + ONE secondary + optional exploration |
| 2 | PX1 | First 5 minutes | Recommendations strip before continue/featured | Guided start | Inventory browsing | Cold-start cards are affinity, not mission | Guide first, browse later |
| 3 | PX1 | Every 64 cells | `applyAuthoritativeRewards` toast "+64 XP" | Small satisfying win | Reward noise | Reward frequency/meaning mismatch | Tiered reward ladder; no per-cell toasts |
| 4 | PX1 | First completion | Completion dialog share-primary | "What's next?" | "Should I share?" | Next commitment is a secondary link | Completion -> commitment handoff |
| 5 | PX1 | Post-completion | Player at 100%, back -> catalog | Natural exit seed | Dead end | No cliffhanger/session seed | Seed next session at every completion |
| 6 | PX1 | Weekly goal | Weekly card -> catalog | "Let me do weekly" | "This opens a catalog?" | Card CTA is wrong | CTA must start the stated goal |
| 7 | PX1 | New player | Unlock journey shows level 2 + 1 artwork | "I can get there" | "That's far/abstract" | No immediate path or preview | Show near-term unlock with preview and 1 action |
| 8 | PX2 | Session goal timer | "Время вышло" copy | Flow | Mild pressure/confusion | Timer without consequence | Timers as arcs, not threats |
| 9 | PX2 | Streak 0 day | Home "сыграйте сегодня" | Positive habit | Mild guilt | Streak as obligation | Streak as record; no guilt copy |
| 10 | PX2 | Level-up | XP bar on Profile | Transformation | Number change | No ceremony | Level-up moment with visible unlock/identity change |
| 11 | PX2 | Collection progress | Collections screen counters | Collection arc | Flat list | No hero piece, no next-in-set | Collection arc with hero + next item |
| 12 | PX2 | Tiled guide | "Цвет N · Видно M" (loaded tiles only) | Accurate target | "Is M all there is?" | Guide counts loaded tiles | Frame as loaded area, or track totals |
| 13 | PX2 | Mastery | Combo hidden in bottom sheet | Flow feeling | Invisible | Combo has no meaning | Visible combo with milestone feedback |
| 14 | PX3 | Onboarding | 3-step overlay inside player | Guided first steps | Interruptive text | Overlay blocks canvas | Diegetic target hint, no blocking card |
| 15 | PX3 | Unlock grant | Silent refresh on Home | "Something opened!" | "Did it?" | Grant has no reveal | Unlock reveal ceremony |
| 16 | PX3 | Creator flow | Success screen | Pride | Neutral | No identity/progress hook | Created work feeds profile/collection |
| 17 | PX3 | Save status | Top bar "Синхронизация..." | Trust | Anxiety | Technical status shown as primary HUD | Quiet save trust; no HUD noise |

## 10. Systems: keep, change, remove

### Keep (foundation)

- Server-authoritative progression/rewards/unlocks (anti-cheat and trust).
- Tiled 1200x1200 player, minimap, guide, camera persistence, haptics.
- Completion compare slider (strong reveal primitive).
- Session goal state machine (server-revision-triggered, offline-safe).
- Unlock snapshot + stable reason codes + recommendations engine as raw signals.
- Collections, feed/likes/comments as social layer.
- Bounded DOM, accessibility and E2E discipline.

### Change (highest leverage)

- XP economy: milestone-based, bounded per-cell XP, no per-batch toasts.
- Home: one primary CTA, one secondary choice, optional exploration.
- Completion: staged reveal, unlock reveal, next-commitment handoff.
- Session goals: presented as arcs with meaningful payoff, not cell timers.
- Unlock UI: near-term previews and silhouettes, reveal ceremony.
- Weekly CTA: start/explain the goal instead of opening catalog.
- Streak copy: record of habit, no guilt.
- Profile: identity (title/role), not only metrics.
- Analytics: experience funnel events.

### Remove or pause

- Home popular grid and community card (duplicate navigation, no direction).
- Per-cell XP toasts.
- Weekly card redirect to catalog.
- Local 5-hint mechanic (either serverize or remove; client-only hints are
  meaningless and cannot be rewarded honestly).
- "Показать обучение снова" menu item (onboarding should be contextual, not a
  menu entry).
- Any future: energy/lives, paid streak shields, leagues/leaderboard pressure,
  artificial urgency, time-in-app optimisation.

## Appendix A. Research cycles and falsification log

This task ran three full reasoning/research cycles. Each cycle collected
evidence, formed hypotheses, attempted falsification, considered alternatives,
and updated the problem model.

### Cycle 1: "Missing systems" -> "missing direction"

- Hypothesis: Splint needs more game systems (more badges, more quests).
- Evidence: all systems already exist and are server-authoritative
  (`progression.js`, `unlock-service.js`, achievements, daily/weekly).
- Falsification attempt: if systems were the problem, the weakest system would
  be visibly broken; instead the systems are robust and the flow is directionless
  (`renderHome`, completion handoff, weekly CTA). More systems would add noise.
- Alternative explanation considered: content scarcity. Counter-evidence: the
  problem is structural (equivalent cards -> same player), so more content
  would not change the model.
- Model update: the gap is guidance, anticipation and choice, not feature count.

### Cycle 2: "Progression is disconnected" -> "labour economy + no mastery"

- Hypothesis: meta progression is disconnected from moment-to-moment play.
- Evidence: per-cell XP, per-batch toasts, session goals as cell counters,
  combo without meaning, difficulty as metadata only.
- Falsification attempt: would milestone-only XP break the loop? The completion
  reward already exists (+40) but is drowned by cell XP; therefore the economy
  is a labour meter, and rewards lack tiers.
- Alternative explanation considered: the completion ceremony is the real
  problem, not XP. Counter-evidence: both are true, but the ceremony's handoff
  problem is separate (Cycle 3) and the economy problem is provable from the
  formula.
- Model update: rewards must be tiered and milestone-based; skill signals must
  be added without reflex mechanics.

### Cycle 3: "Freedom is missing" -> "freedom is mispositioned as inventory"

- Hypothesis: users want more freedom.
- Evidence: freedom exists as a catalog/recommendation wall; the absence is
  meaningful choice at designed moments.
- Falsification attempt: would adding 3 Choice Windows be enough? Only if the
  spine and Director make the chosen path visible; otherwise choices are fake.
  The blueprint therefore pairs Choice Windows with the progression spine and
  an honest stop option.
- Alternative explanation considered: social layer is the missing pull.
  Counter-evidence: social exists but completion -> social flow is generic
  (share/publish); identity and collection recognition are the transferable
  parts, not more feed features.
- Model update: guided autonomy = strong default spine + 2-3 consequential
  options at defined boundaries + honest stop.

### Final falsification question

If a player opens Splint and none of the six pull signals ("ещё один шаг",
"хочу посмотреть, что дальше", "я стал лучше", "почти открыл", "хочу
закончить", "что предложат дальше") is felt, which of the five root causes is
responsible? The answer in every trace is RC1 (no spine) or RC4 (no handoff);
the other three amplify those two. The roadmap therefore starts with Home and
completion, not with new systems.
