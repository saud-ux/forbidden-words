// Game configuration constants — change here, no code editing needed
module.exports = {
  ROUND_DURATION_SECONDS: 60,
  POINTS_MIN_CORRECT: 10,           // floor for correct-guess points
  EXPLAINER_REWARD_RATIO: 0.5,      // explainer earns 50% of guesser's points
  STREAK_MULTIPLIERS: [1, 1.2, 1.5, 2.0], // index = streak length (capped at last)
  STREAK_ENABLED_DEFAULT: false,    // host can toggle on
  ROOM_CODE_DIGITS: 4,
  MAX_PLAYERS_PER_ROOM: 20,
  DEBOUNCE_MS: 75,                  // server won't re-broadcast identical text faster than this
  HOST_RECONNECT_GRACE_MS: 30000,  // keep a room alive this long after the host drops
  PRE_ROUND_COUNTDOWN_SECONDS: 3,  // 3-2-1 flourish before the timer starts
};
