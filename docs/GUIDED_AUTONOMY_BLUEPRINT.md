# Splint Pixel Studio: Guided Autonomy Blueprint

Research deliverable, companion to `GAME_EXPERIENCE_AUDIT.md` and
`GAME_EXPERIENCE_ROADMAP.md`. No production code was changed in this task.

## 0. Target experience in one paragraph

Splint becomes a guided creative game in which every session opens with one
clear promise ("раскрой фрагмент «Неон»", "добери 20 клеток до новой коллекции",
"заверши вторую картину Ночного города"), moves through a visible arc of small
wins, and ends either with a committed next step or an honest, celebrated stop.
The game directs most of the time; at designed moments it hands the player a
small set of consequential choices (theme, path length, challenge level, next
artwork, continue-or-stop), then immediately takes the chosen thread and guides
again. The player's progression is a visible transformation: scenes fill, sets
complete, roles are earned, and future rewards exist in the player's mind before
they are granted.

## 1. Design pillars

1. **One obvious next action.** On Home, Player, Completion and Profile, one
   primary CTA answers "what now?"; everything else is secondary or hidden.
2. **Guidance by default, freedom by design.** The spine is the default path;
   Choice Windows are deliberate intervals, never a permanent catalog wall.
3. **Anticipation before reward.** Every major reward is shown, hinted or
   silhouetted before it is earned.
4. **Meaning over labour.** XP, levels and unlocks track milestones and
   transformation, not cell counts; rewards have tiers and ceremony.
5. **Mastery without breaking calm.** Skill is visual search, route efficiency
   and precision; feedback is positive, optional, never punitive.
6. **Honest engagement.** No guilt, no artificial urgency, no hidden cost, no
   punishment for absence, no dark patterns (see audit section 6.2).

## 2. Player fantasy

**Proposed fantasy (grounded in existing product language): the player is a
restorer of pixel scenes.** The app already says "Картина раскрыта" and "фрагмент
раскрыт"; collections are themed worlds (night city, forest, space, cozy,
travel, sea). The player is not "user level 12" — the player is *someone who
reveals hidden light in small worlds and curates them into a visible gallery*.

Identity stages (server-derived, displayed on Profile and in unlock ceremonies):

| Stage | Condition (proposal) | Visible change |
|---|---|---|
| Новичок | default | Starter art, one guided mission |
| Раскрывающий | first completed artwork | First art in gallery, first reveal ceremony |
| Хранитель коллекции | first completed collection | Collection page gets a "restored" badge and hero art |
| Мастер света | 10 completed artworks across >= 3 themes | Profile title, completion frame, social badge |

This is not a new feature set: it reuses completed artworks, collections and
achievements that already exist; it changes what is *said* and *shown*.

## 3. Progression spine

### 3.1 Primary quest: "Путь Сплита"

A visible main line with numbered nodes. The spine answers:

- "Что игра хочет, чтобы я делал прямо сейчас?" — the current node.
- "Что будет после?" — the next node, shown with a silhouette/preview.
- "Почему я хочу туда попасть?" — each node states its reward before play.

Node types:

| Type | Meaning | Example | Reward on completion |
|---|---|---|---|
| starter | First guided picture | 16x16 "Первый свет" | First reveal, "Раскрывающий" role |
| theme arc | 2-3 pictures in one theme | Ночной город: 1+2+hero | Collection progress, next theme choice |
| hero piece | Signature picture of a chapter | Lantern Fox / Neon Cat | Chapter ceremony, new mechanic or unlock preview |
| collection arc | Complete a themed set | 4 pieces of a collection | Collection completion ceremony, badge, next unlock |
| mastery objective | Optional harder goal | Complete a picture without hints | Bonus milestone XP (not required) |

Side opportunities are clearly secondary: daily task, collections browsing,
catalog, feed. They are hidden until the current node is understood, and they
never look like equal siblings of the spine.

### 3.2 Spine skeleton (content-agnostic)

```text
[Chapter 1: Первый свет]
  node 1: starter picture (2 min) -> first reveal
  node 2: theme picture of player's choice (3-5 min)
  node 3: hero picture of the chapter (8-12 min)
  -> Choice Window: next theme / continue current theme / collection arc
[Chapter 2: Твой стиль]
  node 4: second theme arc
  node 5: collection arc (complete set)
  -> Unlock reveal: streak badge / master gallery preview
[Chapter 3+: Мастерская]
  hero pieces, mastery objectives, new mechanics every 2-3 nodes
```

The spine is data, not hardcode: a `journey_nodes` table (or, in the minimal
slice, a deterministic derivation from collections + templates + unlock rules)
orders pictures into chapters. The server owns it; the client only renders the
current node from the Director response.

## 4. Loops

### 4.1 Moment-to-moment loop (5-20 seconds)

```text
SEE TARGET (highlighted next cells)
  -> ACT (tap/brush)
  -> MICRO FEEDBACK (fill, haptic, number disappears)
  -> VISIBLE PROGRESS (zone %, guide count)
  -> MINI REVEAL (color finished / fragment finished)
  -> NEXT TARGET (auto-advance, always present)
```

Current state already has most of this loop technically. The change is that
every cycle also answers "why": the current node title, remaining-to-node and
the node reward are visible in the HUD, not only in a card above the canvas.

### 4.2 Session loop

```text
SESSION PROMISE (one line: what I will finish, what I get)
  -> EASY WIN (first 3-10 cells)
  -> BUILD MOMENTUM (zone/fragment completions with mini-reveals)
  -> CHALLENGE (hardest fragment or optional mastery objective)
  -> PAYOFF (node completion or visible collection progress)
  -> CHOICE / CLIFFHANGER (2-3 options, one recommended)
  -> NATURAL EXIT OR CONTINUE
```

Session arcs:

| Length | Promise | Arc | Payoff | Exit |
|---|---|---|---|---|
| 60 seconds | "Одна искра: закончи цвет" | 1 color -> color-complete chip | Color reveal, streak day credit | "Готово на сегодня" is celebrated |
| 3 minutes | "Один фрагмент" | easy win -> fragment -> mini reveal | Fragment reveal, daily progress | Choice: next fragment / stop |
| 10 minutes | "Раскрой картину" | easy win -> 2-3 fragments -> hardest fragment -> completion | Completion ceremony | Choice: next path / another art / stop |
| 20+ minutes | "Глава: hero piece" | multi-session arc with checkpoints | Chapter ceremony + unlock | Cliffhanger preview of next node |

### 4.3 Meta loop

```text
PLAY -> COMPLETE -> EARN (milestone) -> TRANSFORM (scene fills, set completes,
role earned) -> UNLOCK (reveal ceremony) -> CHOOSE NEXT PATH -> PLAY
```

XP alone is never transformation. Transformation is: a fragment visually
appearing in the finished artwork, a collection completing, a role title
changing, a locked node opening, a gallery wall filling.

## 5. Choice Windows

Definition: a designed interval where the game stops directing and offers 2-3
options with visible, different consequences; after selection, guidance resumes.

| Window | When | Options (2-3) | Why meaningful | Consequences differ | Paralysis avoidance | Re-control |
|---|---|---|---|---|---|---|
| CW1 Theme | After first picture | (a) Ночной город (b) Космос (c) Лес | Identity: player declares taste | Next 2-3 pictures differ | Each option shows its hero art + first picture | Node 2 starts automatically |
| CW2 Session start (returning) | Home, settled player | (a) Продолжить путь (recommended) (b) Короткая сессия (c) Только daily | Effort level is a real choice | Session length, reward tier differ | Primary is visually dominant | Chosen node opens |
| CW3 After completion | Completion ceremony | (a) Следующая по пути (b) Ещё одна из коллекции (c) Завершить на сегодня | Stop is legitimate and rewarded with honest "сегодня готово" | Next commitment differs | Rewards shown per option | Selection opens player or exit state |
| CW4 Weekly direction | Weekly goal start | (a) 4 короткие картины (b) 2 средние (c) 1 большая | Path length vs challenge | Goal target, estimated time differ | One option is recommended by Director | Weekly card tracks chosen path |
| CW5 Mastery objective | Start of node (optional) | (a) Расслабленно (b) Без подсказок (c) Без номеров | Optional difficulty | Bonus milestone XP, no penalty for (a) | Defaults to (a) | In-session toggle remains |
| CW6 Collection | Before collection arc | (a) Завершить текущую (b) Начать следующую | Collection strategy | Which collection completes next | One is "next in line" | Arc resumes |

Rules: never more than 3 options; every option carries estimated time and
reward preview; the Director recommends one; skipping a Choice Window is
allowed and defaults to the recommended option; the game never presents a
40-card grid as freedom.

## 6. Anticipation architecture

Principle: each major reward exists in the player's mind before it is granted.

| Surface | Current | Target |
|---|---|---|
| Home | Unlock card with requirements text | Current node + next node silhouette with reward label |
| Player HUD | Context goal text | Node title, remaining-to-node, node reward chip |
| Completion | Compare slider | Staged reveal + "что открылось" panel + next node preview |
| Collections | Counter card | Set poster with silhouettes; next item highlighted |
| Profile | Metric grid | Role title, gallery wall, next role condition |
| Locked content | Lock chip + requirements | Blurred/silhouetted preview + "ещё 1 картина" |
| Daily/weekly | Progress bar | "Осталось 25 клеток — и новая коллекция" |
| Mid-picture | zone chips | 80%+ state: "фрагмент почти раскрыт", teaser of reveal |

Implementation notes:

- Silhouettes can be generated from existing preview art (darkened/blurred)
  server-side or client-side; no new content pipeline required.
- "Почти открыто" state: when one requirement is unmet and progress > 75%,
  the Director returns `unlock_preview` with the subject.
- Unlock grants must always come from the existing server-authoritative
  `template_entitlements`/`collection_ownerships`; the UI only celebrates.

## 7. Reward ladder

| Level | Timing | Reward type | Frequency | Presentation | Persistence | Progression link |
|---|---|---|---|---|---|---|
| L0 | 0-2s | Input feedback | Every action | Fill, haptic, chip | None | None |
| L1 | 5-20s | Micro success | First goal (3-10 cells) | "Первая искра" chip + haptic | Session | Node progress |
| L2 | 30-90s | Small win | Zone/fragment/color completion | Mini-reveal, fragment appears in preview | Artwork state | Node progress |
| L3 | 3-5 min | Session milestone | Goal completion / streak day | Milestone banner, no toast | Streak row, session log | Daily/weekly progress |
| L4 | 8-15 min | Substantial payoff | Picture completion | Staged reveal ceremony | Artwork, gallery, role | Collection/unlock progress |
| L5 | multi-session | Major unlock | Collection/chapter completion | Reveal ceremony + preview of next | Entitlement, badge | Spine advances |
| L6 | multi-day | Identity/status payoff | Role title, badge, social recognition | Profile ceremony, feed badge | Persistent identity | Long-term spine |

Anti-inflation rules:

1. No per-cell XP toasts. Cell XP (if kept) is silent and capped; visible XP is
   milestone-only.
2. XP must not scale linearly with grid size. Either normalize by size/difficulty
   or grant XP per session/milestone; a 1200x1200 cannot be worth 1.44M XP.
3. A reward that has no ceremony does not exist; conversely, never spam ceremony
   (one big moment per tier, not one per batch).
4. Streak day credit is a record of activity, never a threat ("Серия N дней —
   сыграйте сегодня" becomes "Ты раскрыл свет N дней подряд").

## 8. Challenge and mastery model

**What is the skill in Splint?** Visual search (find the correct cells of the
selected color), route efficiency (paint large connected regions with few
strokes), precision (avoid wrong taps), pattern recognition (choose the
cheapest color), and planning (choose zone order). None of these are reflexes.

Mastery signals (all optional, all positive):

| Signal | Definition | Where shown |
|---|---|---|
| Точность | correct taps / total taps | Completion summary, Profile |
| Эффективность | strokes vs optimal cells | Fragment mini-reveal ("раскрыто за 6 касаний") |
| Комбо-поток | consecutive correct strokes | HUD chip with milestone at x10/x25/x50 |
| Без подсказок | completion with hints unused | Mastery objective, bonus milestone XP |
| Скорость (optional) | completion under par time | Only if player opted in |

Rules:

- No punishment: wrong tap feedback is a soft "not this color" chip, never a
  streak reset penalty beyond the local combo display.
- Difficulty is chosen, not inflicted: default remains relaxed.
- Mastery objectives are side content: they never gate the spine.
- Do not add reflex mini-games or timed pressure without A/B evidence.

## 9. FTUE (first 5 minutes)

Progressive disclosure: almost full guidance -> small decisions -> autonomy.

| Time to... | Target |
|---|---|
| First interaction | < 30s from open |
| First successful paint | < 60s |
| First visible transformation | < 90s (first fragment/color reveal) |
| First reward | < 3 min (streak day credit + milestone) |
| First choice | after first picture (CW1) |
| First unlock | Day 1 after 2-3 pictures (starter collection) |
| First "wow" | first completion compare slider |

Design:

1. First open: no dashboard. One card: "Первая картина — 2 минуты" with a
   preview of the finished starter art. Secondary link: "выбрать тему" (CW1
   moved earlier is optional, not default).
2. Player opens directly on the starter picture. Onboarding is diegetic: a
   glowing first target, one line "Закрась эти клетки цветом 1", no blocking
   overlay.
3. After first goal: chip "Первая искра" + haptic; goal advances.
4. After first picture: staged reveal (numbered grid -> grayscale -> color),
   then CW3-style options with the theme choice.
5. Home for returning players is the director surface (section 14), not the
   full dashboard.

## 10. First 7 days journey

| Horizon | Player goal | Unlocked mechanic | Content choice | Challenge | Reward | Visible future promise |
|---|---|---|---|---|---|---|
| 5 minutes | Finish starter picture | Reveal ceremony | Starter only | None (easy win) | First reveal, streak day 1 | "Следующая: твоя тема" |
| 30 minutes | Complete 1-2 pictures | CW1 theme choice, zone reveal | 3 themes | Slightly bigger grid | Collection 1/4, role "Раскрывающий" | Hero picture silhouette |
| Day 1 | 2-3 pictures, daily task | Daily challenge, streak day | Theme arc | Medium picture | Starter collection unlock | Master gallery preview |
| Day 2 | Daily + second theme | Weekly direction CW4 | Path length | Optional mastery | Second role progress | Collection 2 start |
| Day 3 | Complete a collection | Collection ceremony, badge | Collection arc | Hero piece | Badge + next unlock | Streak badge teaser |
| Day 7 | 5+ pictures, 2 collections | Mastery objectives, social badge | Hero pieces | Larger/silhouette picture | "Мастер света" progress, streak 7 | Next chapter node |
| 20 artworks | Master gallery arc | Long-term identity | Curated catalog | Varied difficulty | Role ceremony | New chapter content |

## 11. Completion ceremony (target)

Sequence after the last correct cell:

1. **Last action**: one-stroke completion haptic + freeze frame.
2. **Detection**: server-verified completion (existing contract).
3. **Visual reveal**: staged animation: numbered grid -> grayscale -> color
   (legacy can reuse compare slider; tiled uses the bounded preview).
4. **Haptic**: Telegram haptic notification sequence. Audio is explicitly not
   part of the target ceremony until a real Telegram WebView audio capability
   test exists; haptic-only is the default.
5. **Reward**: milestone XP (normalized, no per-cell toast), artwork saved.
6. **Progression change**: level-up or role/collection progress banner if any;
   unlock grants are celebrated, not silently refreshed.
7. **New content reveal**: next node preview with silhouette and reward label;
   if a collection completed, show the collection poster and badge.
8. **Next choice**: CW3 (path / same collection / stop), with the Director's
   recommendation marked; "Завершить на сегодня" is a full, non-shaming choice.

Current vs target: current has steps 1,2,3 (compare slider), 4 (haptics), 5
(+XP), 8 (links). Missing: staged reveal, progression-change banner, unlock
reveal, honest stop, next-node preview.

## 12. Return loop

Honest reasons to return:

1. **Unfinished personal goal**: an artwork at 78% is the strongest pull; Home
   must surface it as the primary node, not as one of six cards.
2. **New meaningful opportunity**: daily task (small, honest) and weekly
   direction are refreshed and actionable.
3. **Visible long-term destination**: next collection/chapter node with
   silhouette.
4. **Evolving content**: daily featured art and chapter progression change.
5. **Social/collection motivation**: collection badge, feed recognition.
6. **Continuation of a chosen path**: CW3/CW4 commitments persist.

What the player should remember hours after closing:

- "Мой фрагмент «Неон» почти раскрыт."
- "Ещё одна картина — и Ночной город станет моей первой коллекцией."
- "Завтра меня ждёт ежедневная картина и серия."

## 13. Game Director / Next Best Action

### 13.1 Is a central service needed?

Yes, but only as a thin composition layer. The facts and signals already exist;
the Director must not become a second source of truth.

### 13.2 Architecture

```text
PlayerState (user, level, XP, streak)
ProgressionFacts (unlock-service.collectProgressionFacts)
CurrentCommitment (active artwork + session goal, local -> reported)
SessionHistory (/colorings/history)
AvailableContent (templates + unlock flags)
RecentRewards (progression/analytics events)
DifficultyEstimate (cells, colors, est_minutes, zones)
RecommendationSignals (recommendations.buildRecommendations)
Daily/Weekly state (progression service)
                     |
                     v
           Director (server, deterministic)
                     |
                     v
        NextBestAction {
          primary_action: { type, subject, estimated_time, difficulty },
          secondary_actions: [0..2],
          reason,
          anticipated_reward,
          progression_effect,
          choice_window,
          presentation_variant
        }
```

Decision rules (deterministic priority):

1. Unfinished artwork -> `resume` (unless player just completed one).
2. Unlock ready (rules satisfied, not granted) -> `unlock_ready` with reveal at
   the next completion/session boundary, never in the middle of active painting.
3. Daily task -> `daily` (short session).
4. Current node -> `start` or `continue_path`.
5. Near unlock (>75% progress) -> `unlock_preview` with silhouette.
6. No active thread -> `featured_or_theme` with CW2.
7. Everything else -> `catalog` (explicit exploration).

Reuse map (do not duplicate):

| Need | Existing source |
|---|---|
| Facts | `unlock-service.collectProgressionFacts` |
| Unlock snapshot | `unlock-service.getUserUnlockSnapshot` / `getNextActionableUnlocks` |
| Recommendations | `recommendations.buildRecommendations` |
| Daily/weekly | `progression.getDailyChallengeStatus/getWeeklyChallengeStatus` |
| History | `/colorings/history` |
| Session goal | client `sessionGoals` (must be reported via track events added in Phase 0) |

New server surface: `GET /director/next` returning the bounded NextBestAction,
plus the journey-node data. Client renders, never re-ranks.

Honesty constraints for the Director:

- Every recommendation must be explainable (`reason`) and executable.
- No fake progress, no fake unlock teaser, no hidden cost.
- The Director may not increase time-in-app; it may only improve the quality
  of the next action.

## 14. Screen hierarchy (wire-level text)

### Home

```text
[Header: role + streak (compact)]
[PRIMARY: current node card — title, preview, estimated time, reward, CTA]
[SECONDARY: Choice Window row (2 options, one recommended)]
[EXPLORATION (collapsed links): каталог | коллекции | лента | профиль]
```

No streak/XP strips, no 8-card recommendation rail, no popular grid, no
community card on Home.

### Player

```text
[Top: back, node title, save dot, progress ring, menu]
[HUD: node promise + reward chip + remaining-to-node]
[Canvas: target highlight, guide, minimap for tiled]
[Goal card: current arc (first goal / fragment / picture)]
[Bottom: mode + palette]
```

### Completion

```text
[Staged reveal panel]
[Reward panel: milestone XP, role/collection/unlock changes]
[CW3: 3 options with rewards; recommended marked]
[Secondary: save/share/publish]
```

### Catalog (explicit exploration only)

```text
[Search/filters]
[Grid, unlock chips, "Почему рекомендовано" on cards]
[Back to path primary button]
```

### Profile

```text
[Hero: avatar, role title, status]
[Metrics: works, collections, streak, followers (compact)]
[Gallery wall: completed works]
[Collections: progress + next item]
[Achievements: next unlock]
[Primary: resume path / continue collection]
```

### Collections

```text
[Collection poster]
[Set silhouette list: completed, next, locked]
[CTA: continue current set]
```

## 15. First 5 minutes storyboard

| TIME | SCREEN | PLAYER ACTION | GAME RESPONSE | EMOTION | VISIBLE PROGRESS | PROMISE OF NEXT REWARD | FREEDOM | NEXT CTA |
|---|---|---|---|---|---|---|---|---|
| 0-10s | First open | Read card | "Первая картина — 2 минуты" + finished preview | Curious | None | "После неё ты выберешь свою тему" | Low (one card) | Start |
| 10-25s | Player | Tap Start | Starter opens; glowing first target, "Закрась цветом 1" | Ready | None | Goal chip | Low | Paint |
| 25-45s | Player | Paint 3-6 cells | Fill, haptic, "Первая искра" chip | Delight | First cells | Fragment reveal | Low | Continue |
| 45-90s | Player | Finish first fragment | Mini-reveal; fragment appears in preview | Flow | Fragment done | "Следующий фрагмент раскроет нос" | Low | Next target |
| 90-150s | Player | Finish picture | Staged reveal (grid -> grayscale -> color) | Wow | Artwork complete | "+40 XP, роль «Раскрывающий»" | Medium | CW3 |
| 150-180s | Completion | Choose "Следующая по пути" | Director opens next node: theme picture | Committed | Path node 2 | "Ещё 2 картины — коллекция" | Medium | Paint |
| 180-300s | Player | Start theme picture | Easy win + streak day credit | Motivated | 10-20% | Daily task + collection | Low-medium | Continue/stop |

## 16. Example 10-minute returning-player session

Player arrives with "Неоновый кот" at 78%.

| TIME | MOMENT | DETAILS |
|---|---|---|
| 0:00 | Session promise | Home primary: "Раскрой «Неоновый кот» — осталось 22% — коллекция 3/4" |
| 0:05 | Easy win | Open picture; camera lands on largest remaining fragment; 3 quick strokes |
| 0:30 | Momentum | Fragment 1 reveals; zone chip; goal advances |
| 2:00 | Challenge | Hardest fragment (small, scattered cells); optional "без подсказок" accepted |
| 3:30 | Payoff | Picture completes; staged reveal; role progress "Мастер света 2/10" |
| 4:00 | Unlock reveal | Collection 3/4 poster fills; "ещё 1 картина — и коллекция завершена"; silhouette of next art |
| 4:30 | CW3 | (a) Следующая по пути (recommended) (b) Другая из коллекции (c) Завершить на сегодня |
| 4:40 | Commitment | Player chooses (a); Director shows next node with reward preview |
| 5:00-10:00 | Continue or natural exit | Player may play the next node or close; if close, session seed is persisted: "Следующая картина ждёт" |

Emotional arc: clear -> excited -> focused -> proud -> curious -> committed.
At no point does the player ask "что мне делать?".

## 17. Anti-scope (what this blueprint deliberately does NOT do)

- No reflex mini-games, combat, timed penalties, energy/lives.
- No paid streak shields or pay-to-progress.
- No leaderboards, leagues or pressure-based social.
- No endless variable-ratio reward loops.
- No new dashboard cards; the target experience removes surfaces.
- No per-cell reward spam.
- No artificial urgency on daily/weekly tasks.
