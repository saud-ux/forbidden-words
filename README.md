# الكلمات المحظورة — Forbidden Words

A real-time Arabic Taboo-style multiplayer party game. One player (the Explainer) describes a secret word without using any of 5 forbidden words. Everyone else races to guess it.

## Quick Start

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## How to Play

1. **Host** enters their name → clicks **إنشاء غرفة جديدة** → gets a 4-digit room code.
2. **Players** enter their name + room code → click **انضم**.
3. Host picks a card from the bank (or random), assigns an Explainer, then starts the round.
4. The **Explainer** sees the secret word + forbidden words, types their description live.
5. **Guessers** watch the text appear in real time and type guesses.
6. Round ends on: correct guess / 60-second timeout / forbidden-word violation.

## Screens

| Role | What they see |
|------|--------------|
| Host | Full card, live typed text, timer, scoreboard, all controls |
| Explainer | Secret word + forbidden list, typing textarea, timer |
| Guesser | Live explanation stream, guess input, timer |

## Project Structure

```
forbidden-words/
├── server/
│   ├── index.js      # Express + Socket.IO server
│   ├── rooms.js      # In-memory room state
│   ├── normalize.js  # Arabic text normalization + detection
│   └── config.js     # Game constants
├── data/
│   └── cards.js      # 54-card Arabic bank
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── package.json
```

## Deployment

### Railway

1. Push to a GitHub repo.
2. Create a new Railway project → **Deploy from GitHub repo**.
3. Railway auto-detects Node.js and runs `npm start`.
4. No environment variables needed — Railway injects `PORT` automatically.

### Render

1. Push to a GitHub repo.
2. New **Web Service** → connect repo.
3. Build command: `npm install`  
   Start command: `npm start`
4. `PORT` is injected automatically.

> **Note:** This game requires a persistent Node.js server for Socket.IO. Static hosts (Netlify, Vercel edge functions, GitHub Pages) will **not** work.

## Configuration

Edit [`server/config.js`](server/config.js) to change:

| Constant | Default | Description |
|----------|---------|-------------|
| `ROUND_DURATION_SECONDS` | 60 | Seconds per round |
| `POINTS_MIN_CORRECT` | 10 | Floor points for a correct guess |
| `EXPLAINER_REWARD_RATIO` | 0.5 | Explainer earns 50% of guesser's points |
| `STREAK_MULTIPLIERS` | `[1, 1.2, 1.5, 2.0]` | Per-consecutive-win multipliers |
| `STREAK_ENABLED_DEFAULT` | false | Streak off by default; host can toggle |

## Detection logic (server-authoritative)

All forbidden-word and guess checking happens **server-side** in
[`server/normalize.js`](server/normalize.js), with a test suite in
[`server/normalize.test.js`](server/normalize.test.js) (`npm test`).

- **Normalization** strips tashkeel/tatweel, unifies alef variants (أإآٱ→ا),
  ى→ي, ة→ه, ؤ→و, ئ→ي, drops standalone ء, and lowercases Latin.
- **Prefix tolerance** (و ف ب ك ل ال + combos وال/بال/فال/كال/لل) is applied to the
  Explainer's *input tokens*, so the targets stay clean and no false fragments leak.
- **Completed-token-only**: the token currently being typed is never flagged, so
  typing `كرامة` never trips on its prefix `كرة`. A token is checked once a
  separator follows it (or at round end).
- **Multi-word answers** (`كرة القدم`) forbid each individual word, so leaking any
  part of the answer is caught.

> **Known trade-off:** the spec's "drop standalone ء" rule makes `ماء` (water)
> normalize to `ما`, which collides with the very common word `ما` ("what"/"not").
> On a card where `ماء` is forbidden, saying `ما` will trip the filter. This is
> faithful to the spec; if you'd rather not drop final hamza, adjust the
> `.replace(/ء/g, '')` line in `normalize.js`.

## Reconnection & state restore

State is held in memory per room (structured in [`server/rooms.js`](server/rooms.js)
so a persistence layer can be added later).

- **Players** rejoin by name — their score, streak, and role are restored, and if a
  round is live they are immediately resynced (timer, explainer, explanation so far).
- **A player joining mid-round** is dropped straight into the active round.
- **The Explainer dropping mid-round** ends the round gracefully with the secret
  revealed; the explainer slot is cleared so the Host must reassign before starting.
- **The Host** is issued a secret `hostToken` at room creation. If the host drops,
  the room is kept alive for `HOST_RECONNECT_GRACE_MS` (30s); reconnecting with the
  token reclaims the host seat, cancels the teardown, and resyncs the dashboard.
  After the grace period with no reconnect, the room closes.

## Adding Cards

Edit [`data/cards.js`](data/cards.js). Each card:

```js
{ secret: "كلمة سرية", forbidden: ["كلمة1", "كلمة2", "كلمة3", "كلمة4", "كلمة5"] }
```

Cards the **host** adds in-game (➕ إضافة) are persisted to `data/custom-cards.json`
(git-ignored runtime data) and preloaded into every future room, so they survive a
server restart and are shared across rooms.

## Juice & tension

Client-side feedback layered on top of the server events:

- **3-2-1 → انطلق! countdown** before each round (`round:countdown`).
- **Confetti + green flash** on a correct guess; **red flash + hard screen-shake** on a violation.
- **Final-10-seconds panic**: a pulsing red vignette plus an escalating tick → heartbeat.
- **Live wrong-guess pings**: a subtle room-wide chip whenever anyone guesses wrong (the guess itself is never leaked).
- **Near-miss feedback** (`🔥 قريب جدًا!`): a guess one edit away from the answer is flagged via server-side Levenshtein distance ([`isNearMiss`](server/normalize.js)).
- **Hot-streak flame** (`🔥×N`) in the scoreboards when streak scoring is on.

All visual effects honor `prefers-reduced-motion`.
