// In-memory room state management.
// Structured so a persistence layer can be bolted on later.

const crypto = require('crypto');
const { ROUND_DURATION_SECONDS, STREAK_ENABLED_DEFAULT, ROOM_CODE_DIGITS } = require('./config');
const { buildForbiddenSet } = require('./normalize');
const cards = require('../data/cards');
const { loadCustomCards, saveCustomCard } = require('./customCards');

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
    customCards: loadCustomCards(), // host-added cards, persisted across rooms/restarts
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
//
// Reconnect vs. duplicate-name rule:
//   • A record with this name that is currently DISCONNECTED is the same person
//     coming back → restore their seat and score (this is how rejoin works).
//   • A record with this name that is still CONNECTED is a DIFFERENT person who
//     happens to want a taken name → give them a numbered suffix so the two are
//     never merged. (This was the duplicate-name session-collision bug: two
//     players called "محمد" used to overwrite each other and share one score.)
function joinRoom(code, socketId, name) {
  const room = rooms[code];
  if (!room) return null;

  const trimmed = name.trim();
  const sessionKey = trimmed.toLowerCase();

  const existing = room.players.find(p => p.sessionKey === sessionKey);
  if (existing && existing.disconnected) {
    existing.socketId = socketId;
    existing.disconnected = false;
    return existing;
  }

  let displayName = trimmed;
  let finalKey = sessionKey;
  if (existing && !existing.disconnected) {
    let n = 2;
    while (room.players.some(p => p.sessionKey === `${sessionKey} (${n})`)) n++;
    displayName = `${trimmed} (${n})`;
    finalKey = `${sessionKey} (${n})`;
  }

  const player = { socketId, name: displayName, score: 0, streak: 0, sessionKey: finalKey, disconnected: false };
  room.players.push(player);
  return player;
}

function removePlayer(code, socketId) {
  const room = rooms[code];
  if (!room) return;
  const player = room.players.find(p => p.socketId === socketId);
  if (player) player.disconnected = true;
}

// Fully remove a player who chose to LEAVE (not a transient disconnect). Unlike
// removePlayer, this drops the record entirely so their name frees up and they
// don't linger as a ghost in the scoreboard. Keeps explainerIndex pointing at
// the correct player after the splice. Returns the removed player (or null).
function leaveRoom(code, socketId) {
  const room = rooms[code];
  if (!room) return null;
  const idx = room.players.findIndex(p => p.socketId === socketId);
  if (idx < 0) return null;

  const [player] = room.players.splice(idx, 1);
  if (room.explainerIndex === idx) room.explainerIndex = -1;
  else if (room.explainerIndex > idx) room.explainerIndex -= 1;
  return player;
}

function getActivePlayers(room) {
  return room.players.filter(p => !p.disconnected);
}

// Add a custom card to a room AND persist it so future rooms get it too.
// Returns its index in the combined bank.
function addCustomCard(room, { secret, forbidden }) {
  const idx = cards.length + room.customCards.length;
  room.customCards.push({ secret, forbidden });
  saveCustomCard({ secret, forbidden });
  return idx;
}

// Pick a card (by index, or random if index === -1). Returns null if bank exhausted.
// Indices 0..cards.length-1 → global bank; cards.length+ → custom cards.
function pickCard(room, cardIndex = -1) {
  const allCards = [...cards, ...room.customCards];
  const available = allCards
    .map((c, i) => i)
    .filter(i => !room.usedCardIndices.has(i));
  if (!available.length) return null;

  const idx = cardIndex >= 0 && !room.usedCardIndices.has(cardIndex)
    ? cardIndex
    : available[Math.floor(Math.random() * available.length)];

  room.usedCardIndices.add(idx);
  const card = allCards[idx];
  room.currentCard = { ...card, index: idx };
  // Build forbidden set: secret word + all forbidden words
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
  leaveRoom,
  removePlayer,
  getActivePlayers,
  addCustomCard,
  pickCard,
  getExplainer,
  rotateExplainer,
  setExplainerBySocketId,
  scoreboard,
};
