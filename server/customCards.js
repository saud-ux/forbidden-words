'use strict';
// Lightweight file persistence for host-added custom cards so they survive a
// server restart and are available to every future room (not just the room that
// added them). Stored as a JSON array in data/custom-cards.json.
//
// Kept intentionally simple — synchronous fs, no locking. The write volume is
// tiny (a card is added by a human clicking a button), so this is plenty.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/custom-cards.json');

// Read the persisted custom cards. Returns a fresh array each call so a room can
// safely mutate its own copy without touching the on-disk store.
function loadCustomCards() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: only keep well-formed cards.
    return parsed
      .filter(c => c && typeof c.secret === 'string' && Array.isArray(c.forbidden))
      .map(c => ({ secret: c.secret, forbidden: c.forbidden }));
  } catch (_) {
    return []; // missing/corrupt file → start empty
  }
}

// Append one card to the persistent store. Best-effort: a write failure must
// never crash a live game, so errors are swallowed (the card still works for the
// current room, it just won't survive a restart).
function saveCustomCard(card) {
  try {
    const all = loadCustomCards();
    all.push({ secret: card.secret, forbidden: card.forbidden });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (_) {}
}

module.exports = { loadCustomCards, saveCustomCard };
