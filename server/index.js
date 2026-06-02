const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const config = require('./config');
const {
  rooms,
  createRoom, getRoom, deleteRoom,
  joinRoom, removePlayer, getActivePlayers,
  addCustomCard, pickCard, getExplainer, rotateExplainer, setExplainerBySocketId,
  scoreboard,
} = require('./rooms');
const { detectViolation, isCorrectGuess } = require('./normalize');
const cards = require('../data/cards.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../public')));

// ─── Socket.IO ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // ── Host creates a room ──────────────────────────────────────────────────
  socket.on('host:create', ({ name }, cb) => {
    const room = createRoom(socket.id, name || 'المضيف');
    socket.join(room.code);
    cb({ ok: true, code: room.code, role: 'host', hostToken: room.hostToken });
    emitLobby(room);
  });

  // ── Host reconnects (transient drop or page reload) ──────────────────────
  socket.on('host:reconnect', ({ code, hostToken }, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ ok: false, error: 'الغرفة لم تعد موجودة' });
    if (room.hostToken !== hostToken) return cb?.({ ok: false, error: 'رمز غير صالح' });

    // Cancel any pending room-closure grace timer and reclaim the host seat.
    if (room.hostGraceTimer) { clearTimeout(room.hostGraceTimer); room.hostGraceTimer = null; }
    room.host = socket.id;
    room.hostConnected = true;
    socket.join(code);

    cb?.({ ok: true, code });
    // Resync everything the host dashboard needs.
    emitLobby(room);
    if (room.currentCard) io.to(socket.id).emit('host:card', { card: room.currentCard });
    sendRoundStateTo(socket.id, room);
  });

  // ── Player (or host) joins a room ────────────────────────────────────────
  socket.on('player:join', ({ code, name }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'الغرفة غير موجودة' });
    if (!name?.trim()) return cb({ ok: false, error: 'أدخل اسمك أولاً' });

    const player = joinRoom(code, socket.id, name);
    socket.join(code);
    cb({ ok: true, role: 'guesser', name: player.name, score: player.score });
    emitLobby(room);
    // If a round is already in progress, bring this (re)joining player up to
    // speed so their screen reflects the live round instead of a stale state.
    sendRoundStateTo(socket.id, room);
  });

  // ── Host: pick a card ────────────────────────────────────────────────────
  socket.on('host:pick_card', ({ code, cardIndex }, cb) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    const card = pickCard(room, cardIndex ?? -1);
    if (!card) return cb?.({ ok: false, error: 'نفدت البطاقات' });
    cb?.({ ok: true });
    // Send full card only to host
    io.to(room.host).emit('host:card', { card, cardIndex: card.index });
    // Send explainer their card if already assigned
    const explainer = getExplainer(room);
    if (explainer) {
      io.to(explainer.socketId).emit('explainer:card', { card });
    }
  });

  // ── Host: add a custom card ──────────────────────────────────
  socket.on('host:add_card', ({ code, secret, forbidden }, cb) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    if (!secret?.trim()) return cb?.({ ok: false, error: 'أدخل الكلمة السرية' });
    const words = (forbidden || []).map(f => f.trim()).filter(Boolean);
    if (!words.length) return cb?.({ ok: false, error: 'أدخل كلمة محظورة على الأقل' });
    addCustomCard(room, { secret: secret.trim(), forbidden: words });
    cb?.({ ok: true });
    emitLobby(room);
  });

  // ── Host: assign explainer by socketId ──────────────────────────────────
  socket.on('host:assign_explainer', ({ code, socketId }, cb) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    const player = setExplainerBySocketId(room, socketId);
    if (!player) return cb?.({ ok: false });
    cb?.({ ok: true });
    emitLobby(room);
    if (room.currentCard) {
      io.to(player.socketId).emit('explainer:card', { card: room.currentCard });
    }
  });

  // ── Host: rotate to next explainer ──────────────────────────────────────
  socket.on('host:rotate_explainer', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    const player = rotateExplainer(room);
    if (!player) return cb?.({ ok: false });
    cb?.({ ok: true, socketId: player.socketId, name: player.name });
    emitLobby(room);
    if (room.currentCard) {
      io.to(player.socketId).emit('explainer:card', { card: room.currentCard });
    }
  });

  // ── Host: toggle streak ──────────────────────────────────────────────────
  socket.on('host:toggle_streak', ({ code, enabled }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    room.streakEnabled = !!enabled;
    io.to(code).emit('room:streak_toggle', { enabled: room.streakEnabled });
  });

  // ── Host: start round (runs a 3-2-1 countdown, then the live round) ──────
  socket.on('host:start_round', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return cb?.({ ok: false });
    if (!room.currentCard) return cb?.({ ok: false, error: 'اختر بطاقة أولاً' });
    if (room.explainerIndex < 0) return cb?.({ ok: false, error: 'اختر المشرح أولاً' });
    if (room.phase === 'round' || room.phase === 'countdown') return cb?.({ ok: false, error: 'الجولة جارية' });

    beginCountdown(room);
    cb?.({ ok: true });
  });

  // ── Host: skip round ────────────────────────────────────────────────────
  socket.on('host:skip', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'round') return;
    endRound(room, 'skip');
  });

  // ── Host: end game ──────────────────────────────────────────────────────
  socket.on('host:end_game', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    io.to(code).emit('game:ended', { scoreboard: scoreboard(room) });
    deleteRoom(code);
  });

  // ── Explainer: live typing ───────────────────────────────────────────────
  socket.on('explainer:typing', ({ code, text }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'round') return;
    const explainer = getExplainer(room);
    if (!explainer || explainer.socketId !== socket.id) return;

    room.explanation = text;

    // Broadcast text to host + guessers (not back to explainer)
    socket.to(code).emit('round:explanation', { text });

    // Check completed tokens for violations
    checkViolation(room, text);
  });

  // ── Guesser: submit guess ────────────────────────────────────────────────
  // Server-authoritative first-correct-guess race. Node processes socket events
  // one at a time on a single thread, so guesses are handled in server ARRIVAL
  // order. The explicit `roundWinnerSocketId` lock — set synchronously before any
  // further work — guarantees exactly one winner even if a guess was already in
  // flight, and stays correct if a future persistence layer adds `await` here.
  socket.on('guesser:guess', ({ code, guess }, cb) => {
    const arrivedAt = Date.now(); // authoritative arrival timestamp
    const room = getRoom(code);
    if (!room || room.phase !== 'round') return cb?.({ ok: false, reason: 'inactive' });

    // Round already won — lock out all further guesses.
    if (room.roundWinnerSocketId) return cb?.({ ok: false, reason: 'locked' });

    const explainer = getExplainer(room);
    if (explainer?.socketId === socket.id) return cb?.({ ok: false, reason: 'explainer' });

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return cb?.({ ok: false, reason: 'not_in_room' });
    if (!room.currentCard) return cb?.({ ok: false, reason: 'no_card' });

    if (!isCorrectGuess(guess, room.currentCard.secret)) {
      return cb?.({ ok: true, correct: false });
    }

    // ── First correct guess wins ──
    // Claim the win synchronously, before scoring or emitting, so a near-
    // simultaneous second correct guess sees the lock and is rejected.
    room.roundWinnerSocketId = socket.id;
    room.roundWinnerAt = arrivedAt;

    // points = max(10, remainingSeconds) → faster guess earns more
    const basePoints = Math.max(config.POINTS_MIN_CORRECT, room.remainingSeconds);
    let multiplier = 1;
    if (room.streakEnabled) {
      const idx = Math.min(player.streak, config.STREAK_MULTIPLIERS.length - 1);
      multiplier = config.STREAK_MULTIPLIERS[idx];
    }
    const guesserPoints = Math.round(basePoints * multiplier);
    const explainerPoints = explainer ? Math.round(guesserPoints * config.EXPLAINER_REWARD_RATIO) : 0;

    player.score += guesserPoints;
    player.streak += 1;
    room.lastWinnerId = socket.id;
    // Winning breaks everyone else's streak
    room.players.forEach(p => { if (p.socketId !== socket.id) p.streak = 0; });
    if (explainer) explainer.score += explainerPoints;

    cb?.({ ok: true, correct: true });
    endRound(room, 'correct', {
      winnerName: player.name,
      guesserPoints,
      explainerPoints,
      secret: room.currentCard.secret,
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      // ── Host dropped: keep the room alive for a grace period so the host can
      //    reconnect (transient drop or page reload) without losing the game.
      if (room.host === socket.id) {
        room.hostConnected = false;
        io.to(code).emit('room:host_disconnected');
        if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
        room.hostGraceTimer = setTimeout(() => {
          const r = getRoom(code);
          if (r && !r.hostConnected) closeRoom(r, 'انقطع المضيف عن الاتصال');
        }, config.HOST_RECONNECT_GRACE_MS);
        return;
      }

      // ── Player dropped: keep their record (score restored on rejoin), but
      //    mark them disconnected and handle the explainer-mid-round case.
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) continue;

      const wasExplainer = getExplainer(room)?.socketId === socket.id;
      removePlayer(code, socket.id);

      if (wasExplainer) {
        // End the round gracefully and force the host to reassign — the dead
        // socket must never stay selected as the explainer.
        if (room.phase === 'round') endRound(room, 'explainer_disconnect');
        room.explainerIndex = -1;
      }

      emitLobby(room);
      io.to(room.host).emit('host:player_left', { name: player.name });
    }
  });
});

// ─── Round helpers ───────────────────────────────────────────────────────────

// Bring a single (re)connecting socket up to speed if a round is live: replay
// the round:start, the current timer value, and the explanation typed so far.
// The Explainer additionally gets the card. No-op outside an active round.
function sendRoundStateTo(socketId, room) {
  if (room.phase !== 'round') return;
  const explainer = getExplainer(room);
  io.to(socketId).emit('round:start', {
    explainerName: explainer?.name,
    duration: config.ROUND_DURATION_SECONDS,
    scoreboard: scoreboard(room),
    streakEnabled: room.streakEnabled,
  });
  io.to(socketId).emit('round:tick', { remaining: room.remainingSeconds });
  if (room.explanation) io.to(socketId).emit('round:explanation', { text: room.explanation });
  if (explainer && explainer.socketId === socketId && room.currentCard) {
    io.to(socketId).emit('explainer:card', { card: room.currentCard });
  }
}

// Tear a room down: stop its timer, tell everyone, and free the state.
function closeRoom(room, reason) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  io.to(room.code).emit('room:closed', { reason });
  deleteRoom(room.code);
}

// Run a short 3-2-1 countdown before the live round. The Explainer gets the card
// up front so they can read it while everyone counts down; the timer only starts
// when the live round begins, so it never desyncs with the flourish.
function beginCountdown(room) {
  room.phase = 'countdown';
  const explainer = getExplainer(room);
  const seconds = config.PRE_ROUND_COUNTDOWN_SECONDS;

  io.to(room.code).emit('round:countdown', { seconds, explainerName: explainer?.name });
  io.to(room.host).emit('host:card', { card: room.currentCard });
  if (explainer && room.currentCard) {
    io.to(explainer.socketId).emit('explainer:card', { card: room.currentCard });
  }

  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    // Abort if the room/explainer vanished during the countdown.
    if (room.phase !== 'countdown') return;
    if (!getExplainer(room) || room.explainerIndex < 0) {
      room.phase = 'result';
      io.to(room.code).emit('round:end', {
        reason: 'explainer_disconnect', secret: room.currentCard?.secret, scoreboard: scoreboard(room),
      });
      return;
    }
    startRound(room);
  }, seconds * 1000);
}

function startRound(room) {
  room.phase = 'round';
  room.explanation = '';
  room.remainingSeconds = config.ROUND_DURATION_SECONDS;
  room.timerStart = Date.now();
  room.roundWinnerSocketId = null; // clear last round's winner lock
  room.roundWinnerAt = null;

  const explainer = getExplainer(room);

  // Tell everyone the round started (guessers/host don't get the card secret)
  io.to(room.code).emit('round:start', {
    explainerName: explainer?.name,
    duration: config.ROUND_DURATION_SECONDS,
    scoreboard: scoreboard(room),
    streakEnabled: room.streakEnabled,
  });

  // Lock the host's card view to show current card during round
  io.to(room.host).emit('host:card', { card: room.currentCard });

  // Send the card (with secret + forbidden) only to the explainer
  if (explainer) {
    io.to(explainer.socketId).emit('explainer:card', { card: room.currentCard });
  }

  // Server-side countdown
  room.timer = setInterval(() => {
    room.remainingSeconds -= 1;
    io.to(room.code).emit('round:tick', { remaining: room.remainingSeconds });

    if (room.remainingSeconds <= 0) {
      endRound(room, 'timeout');
    }
  }, 1000);
}

function endRound(room, reason, extra = {}) {
  if (room.phase !== 'round') return;

  // Final sweep on a natural timeout: the very last token typed may never have
  // been "completed" by a trailing separator, so it was skipped by the live
  // check. Evaluate it now (roundEnd=true). If it hides a forbidden word,
  // upgrade the outcome to a violation and reveal it. (Scoring is 0 either way;
  // this just labels the round correctly and is faithful to the spec's
  // "evaluate completed tokens … or at round end".)
  if (reason === 'timeout' && room.forbiddenSet) {
    const offending = detectViolation(room.explanation, room.forbiddenSet, true);
    if (offending) {
      reason = 'violation';
      const explainer = getExplainer(room);
      extra = { violatingWord: offending, explainerName: explainer?.name };
      if (explainer) io.to(explainer.socketId).emit('explainer:locked', { word: offending });
      io.to(room.code).emit('round:violation', { word: offending, explainerName: explainer?.name });
    }
  }

  room.phase = 'result'; // host must start the next round
  clearInterval(room.timer);
  room.timer = null;

  io.to(room.code).emit('round:end', {
    reason,          // 'correct' | 'timeout' | 'violation' | 'skip' | 'explainer_disconnect'
    secret: room.currentCard?.secret,
    scoreboard: scoreboard(room),
    ...extra,
  });
}

// Live, per-keystroke detection on the Explainer's text. Evaluates only
// COMPLETED tokens (the in-progress trailing token is never flagged). On the
// first violation: lock the Explainer, reveal the word to everyone, end the round.
function checkViolation(room, text) {
  if (!room.forbiddenSet || room.phase !== 'round') return;
  const offending = detectViolation(text, room.forbiddenSet, false);
  if (!offending) return;

  const explainer = getExplainer(room);
  if (explainer) io.to(explainer.socketId).emit('explainer:locked', { word: offending });
  io.to(room.code).emit('round:violation', { word: offending, explainerName: explainer?.name });
  endRound(room, 'violation', { violatingWord: offending, explainerName: explainer?.name });
}

// Emit lobby state (player list, roles) to everyone in the room
function emitLobby(room) {
  const active = getActivePlayers(room);
  const explainer = getExplainer(room);
  io.to(room.code).emit('room:lobby', {
    players: active.map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      isExplainer: p === explainer,
    })),
    phase: room.phase,
    streakEnabled: room.streakEnabled,
  });
  // Also send the card bank list (global + custom) to the host
  const allCards = [...cards, ...room.customCards];
  io.to(room.host).emit('host:card_bank', {
    cards: allCards.map((c, i) => ({
      index: i,
      secret: c.secret,
      used: room.usedCardIndices.has(i),
      custom: i >= cards.length,
    })),
  });
}

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Forbidden Words server running on http://localhost:${PORT}`));
