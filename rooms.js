// In-memory room state management.
// Structured so a persistence layer can be bolted on later.

const crypto = require('crypto');
const { ROUND_DURATION_SECONDS, STREAK_ENABLED_DEFAULT, ROOM_CODE_DIGITS } = require('./config');
const { buildForbiddenSet } = require('./normalize');
const cards = require('../data/cards');

const rooms = {}; // roomCode → RoomState

function generateCode() {
  const max = Math.pow(10, ROOM_CODE_DIGITS);
  let code;
  do {
    code = String(Math.floor(Math.random() * max)).padStart(ROOM_CODE_DIGITS, '0');
  } while (rooms[code]);
  return code;
}

function createRoom(hostSocketId, hostName) {
  const code = generateCode();
  rooms[code] = {
    code,
    host: hostSocketId,
    // Secret handed only to the host client; required to reclaim the host seat
    // after a reconnect, so a random client can't hijack the room.
    hostToken: crypto.randomBytes(16).toString('hex'),
    hostConnected: true,
    hostGraceTimer: null,
    hostName,
    players: [],          // [{ socketId, name, score, streak, sessionKey }]
    usedCardIndices: new Set(),
    currentCard: null,    // { secret, forbidden }
    forbiddenSet: null,   // normalized Set — built when card is picked
    explainerIndex: -1,   // index into players array
    phase: 'lobby',       // lobby | countdown | round | result
    timer: null,
    countdownTimer: null,
    timerStart: null,
    remainingSeconds: ROUND_DURATION_SECONDS,
    explanation: '',
    streakEnabled: STREAK_ENABLED_DEFAULT,
    lastWinnerId: null,         // winner of the PREVIOUS round (for streak tracking)
    roundWinnerSocketId: null,  // explicit lock: set the instant a correct guess wins
    roundWinnerAt: null,        // server arrival timestamp of the winning guess
  };
  return rooms[code];
}

function getRoom(code) {
  return rooms[code] || null;
}

function deleteRoom(code) {
  const room = rooms[code];
  if (room?.timer) clearInterval(room.timer);
  if (room?.countdownTimer) clearTimeout(room.countdownTimer);
  if (room?.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  delete rooms[code];
}

// Add or restore a player. Returns the player object.
function joinRoom(code, socketId, name) {
  const room = rooms[code];
  if (!room) return null;

  const sessionKey = name.trim().toLowerCase();
  // Restore disconnected player
  const existing = room.players.find(p => p.sessionKey === sessionKey);
  if (existing) {
    existing.socketId = socketId;
    existing.disconnected = false;
    return existing;
  }

  const player = { socketId, name: name.trim(), score: 0, streak: 0, sessionKey, disconnected: false };
  room.players.push(player);
  return player;
}

function removePlayer(code, socketId) {
  const room = rooms[code];
  if (!room) return;
  const player = room.players.find(p => p.socketId === socketId);
  if (player) player.disconnected = true;
}

function getActivePlayers(room) {
  return room.players.filter(p => !p.disconnected);
}

// Pick a card (by index, or random if index === -1). Returns null if bank exhausted.
function pickCard(room, cardIndex = -1) {
  const available = cards
    .map((c, i) => i)
    .filter(i => !room.usedCardIndices.has(i));
  if (!available.length) return null;

  const idx = cardIndex >= 0 && !room.usedCardIndices.has(cardIndex)
    ? cardIndex
    : available[Math.floor(Math.random() * available.length)];

  room.usedCardIndices.add(idx);
  const card = cards[idx];
  room.currentCard = { ...card, index: idx };
  // Build forbidden set: secret word + all 5 forbidden words
  room.forbiddenSet = buildForbiddenSet([card.secret, ...card.forbidden]);
  return room.currentCard;
}

function getExplainer(room) {
  return room.players[room.explainerIndex] || null;
}

function rotateExplainer(room) {
  const active = room.players.filter(p => !p.disconnected);
  if (!active.length) return null;
  const currentExplainer = room.players[room.explainerIndex];
  const currentActiveIdx = currentExplainer
    ? active.findIndex(p => p.socketId === currentExplainer.socketId)
    : -1;
  const nextActive = active[(currentActiveIdx + 1) % active.length];
  room.explainerIndex = room.players.findIndex(p => p.socketId === nextActive.socketId);
  return nextActive;
}

function setExplainerBySocketId(room, socketId) {
  const idx = room.players.findIndex(p => p.socketId === socketId);
  if (idx >= 0) room.explainerIndex = idx;
  return room.players[idx] || null;
}

// Public scoreboard snapshot (safe to send to all clients)
function scoreboard(room) {
  return room.players.map(p => ({
    name: p.name,
    score: p.score,
    streak: p.streak,
    disconnected: p.disconnected,
    isExplainer: room.players.indexOf(p) === room.explainerIndex,
  }));
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  deleteRoom,
  joinRoom,
  removePlayer,
  getActivePlayers,
  pickCard,
  getExplainer,
  rotateExplainer,
  setExplainerBySocketId,
  scoreboard,
};
