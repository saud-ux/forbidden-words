/* ── Forbidden Words — client app ─────────────────────────── */
'use strict';

const socket = io({ transports: ['websocket', 'polling'] });

// ── Connection guard ──────────────────────────────────────────
function setLandingConnecting(on) {
  const btns = [$('btn-create'), $('btn-join')];
  btns.forEach(b => { if (b) b.disabled = on; });
  let banner = document.getElementById('conn-banner');
  if (on) {
    if (!banner) {
      banner = document.createElement('p');
      banner.id = 'conn-banner';
      banner.style.cssText = 'text-align:center;color:#f59e0b;margin-top:8px;font-size:.9rem';
      banner.textContent = 'جاري الاتصال بالخادم…';
      const card = document.querySelector('.landing-card');
      if (card) card.appendChild(banner);
    }
  } else {
    if (banner) banner.remove();
  }
}
setLandingConnecting(true);
socket.on('connect', () => setLandingConnecting(false));
socket.on('disconnect', () => setLandingConnecting(true));

// ── State ─────────────────────────────────────────────────────
const state = {
  role: null,       // 'host' | 'explainer' | 'guesser'
  roomCode: null,
  playerName: null,
  hostToken: null,  // issued at room creation; used to reclaim host on reconnect
  roundDuration: 60,
  streakEnabled: false,
  currentExplainerName: null,
  hostHasCard: false,
  hostHasExplainer: false,
};

function refreshStartBtn() {
  const btn = $('btn-start-round');
  if (btn) btn.disabled = !(state.hostHasCard && state.hostHasExplainer);
}

// ── Sound (HTML5 Audio API) ────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, type, duration, gainVal = 0.3, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + duration + 0.05);
  } catch (_) {}
}

function soundCorrect() {
  playTone(523, 'sine', .15, .3);
  playTone(659, 'sine', .15, .3, .15);
  playTone(784, 'sine', .25, .3, .3);
}
function soundViolation() {
  playTone(180, 'sawtooth', .4, .35);
  playTone(140, 'sawtooth', .3, .35, .3);
}
function soundTimeout() {
  playTone(330, 'triangle', .4, .25);
  playTone(220, 'triangle', .6, .25, .3);
}
function soundTick() {
  playTone(880, 'square', .06, .12);
}
function soundGuessWrong() {
  playTone(250, 'square', .12, .15);
}

// ── Screens ────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(el) { if (typeof el === 'string') el = $(el); el?.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = $(el); el?.classList.add('hidden'); }

function timerArcOffset(remaining, total) {
  const CIRC = 326.73;
  return CIRC - (remaining / total) * CIRC;
}

function updateTimer(arcId, numId, remaining, total) {
  const arc = $(arcId);
  const num = $(numId);
  if (!arc || !num) return;
  arc.style.strokeDashoffset = timerArcOffset(remaining, total);
  num.textContent = remaining;
  arc.classList.toggle('warning', remaining <= 20 && remaining > 10);
  arc.classList.toggle('danger',  remaining <= 10);
  if (remaining > 0 && remaining <= 10) soundTick();
}

function renderScoreboard(players, containerId) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'score-row' + (p.isExplainer ? ' explainer' : '');
    row.innerHTML = `<span class="player-name">${esc(p.name)}${p.isExplainer ? ' 🎤' : ''}</span><span class="player-pts">${p.score}</span>`;
    el.appendChild(row);
  });
}

function renderScoreboardCompact(players, containerId) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'sc-chip' + (p.isExplainer ? ' is-explainer' : '');
    chip.innerHTML = `${esc(p.name)} <span class="sc-pts">${p.score}</span>`;
    el.appendChild(chip);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showResultOverlay(overlayId, contentId, reason, data) {
  const overlay = $(overlayId);
  const content = $(contentId);
  if (!overlay || !content) return;

  let html = '';
  if (reason === 'correct') {
    soundCorrect();
    html = `<div class="result-content">
      <h2 style="color:var(--green)">🎉 إجابة صحيحة!</h2>
      <p>أجاب <strong>${esc(data.winnerName)}</strong> بشكل صحيح</p>
      <div class="secret-reveal">${esc(data.secret)}</div>
      <p>+${data.guesserPoints} نقطة</p>
      ${data.explainerPoints ? `<p style="color:var(--text-dim)">الشارح: +${data.explainerPoints} نقطة</p>` : ''}
    </div>`;
  } else if (reason === 'violation') {
    soundViolation();
    html = `<div class="result-content">
      <h2 style="color:var(--red)">⛔ مخالفة!</h2>
      <p>قال الشارح الكلمة المحظورة: <strong style="color:var(--red)">${esc(data.violatingWord || '')}</strong></p>
      <div class="secret-reveal">${esc(data.secret)}</div>
      <p style="color:var(--text-dim)">0 نقطة لهذه الجولة</p>
    </div>`;
  } else if (reason === 'timeout') {
    soundTimeout();
    html = `<div class="result-content">
      <h2 style="color:var(--text-dim)">⏰ انتهى الوقت!</h2>
      <div class="secret-reveal">${esc(data.secret)}</div>
      <p style="color:var(--text-dim)">0 نقطة لهذه الجولة</p>
    </div>`;
  } else if (reason === 'skip') {
    html = `<div class="result-content">
      <h2 style="color:var(--text-dim)">⏭ تم التخطي</h2>
      <div class="secret-reveal">${esc(data.secret)}</div>
    </div>`;
  } else {
    html = `<div class="result-content">
      <h2>انتهت الجولة</h2>
      <div class="secret-reveal">${esc(data.secret || '')}</div>
    </div>`;
  }

  content.innerHTML = html;
  show(overlay);
  // Auto-dismiss after 4 seconds
  setTimeout(() => hide(overlay), 4000);
}

// ══════════════════════════════════════════════════════════════
// LANDING SCREEN
// ══════════════════════════════════════════════════════════════
$('btn-create').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  if (!name) return showError('أدخل اسمك أولاً');
  socket.emit('host:create', { name }, res => {
    if (!res.ok) return showError('حدث خطأ، حاول مجدداً');
    state.role = 'host';
    state.roomCode = res.code;
    state.playerName = name;
    state.hostToken = res.hostToken; // needed to reclaim the host seat on reconnect
    $('host-room-code').textContent = res.code;
    showScreen('screen-host');
  });
});

$('btn-join').addEventListener('click', doJoin);
$('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
$('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });

function doJoin() {
  const name = $('inp-name').value.trim();
  const code = $('inp-code').value.trim();
  if (!name) return showError('أدخل اسمك أولاً');
  if (!code) return showError('أدخل كود الغرفة');
  socket.emit('player:join', { code, name }, res => {
    if (!res.ok) return showError(res.error || 'فشل الانضمام');
    state.role = 'guesser'; // may change to explainer via server events
    state.roomCode = code;
    state.playerName = res.name;
    $('guesser-room-code').textContent = 'غرفة: ' + code;
    showScreen('screen-guesser');
  });
}

function showError(msg) {
  const el = $('landing-error');
  el.textContent = msg;
  show(el);
  setTimeout(() => hide(el), 3000);
}

// ══════════════════════════════════════════════════════════════
// HOST SCREEN
// ══════════════════════════════════════════════════════════════

// Random card
$('btn-random-card').addEventListener('click', () => {
  socket.emit('host:pick_card', { code: state.roomCode, cardIndex: -1 }, res => {
    if (!res?.ok) console.warn('pick card failed', res);
  });
});

// Add custom card — open modal
$('btn-add-card').addEventListener('click', () => {
  $('inp-card-secret').value = '';
  document.querySelectorAll('.inp-forbidden').forEach(i => i.value = '');
  hide('modal-add-error');
  show('modal-add-card');
  $('inp-card-secret').focus();
});

$('btn-cancel-add-card').addEventListener('click', () => hide('modal-add-card'));

// Close modal on overlay click
$('modal-add-card').addEventListener('click', e => {
  if (e.target === $('modal-add-card')) hide('modal-add-card');
});

$('btn-submit-add-card').addEventListener('click', () => {
  const secret = $('inp-card-secret').value.trim();
  const forbidden = [...document.querySelectorAll('.inp-forbidden')]
    .map(i => i.value.trim()).filter(Boolean);
  const errEl = $('modal-add-error');

  if (!secret) {
    errEl.textContent = 'أدخل الكلمة السرية';
    show(errEl); return;
  }
  if (!forbidden.length) {
    errEl.textContent = 'أدخل كلمة محظورة على الأقل';
    show(errEl); return;
  }
  hide(errEl);
  $('btn-submit-add-card').disabled = true;

  socket.emit('host:add_card', { code: state.roomCode, secret, forbidden }, res => {
    $('btn-submit-add-card').disabled = false;
    if (!res?.ok) {
      errEl.textContent = res?.error || 'فشل الإضافة';
      show(errEl); return;
    }
    hide('modal-add-card');
    showToast(`✅ تمت إضافة: ${esc(secret)}`, 'green');
  });
});

// Start round
$('btn-start-round').addEventListener('click', () => {
  socket.emit('host:start_round', { code: state.roomCode }, res => {
    if (!res?.ok) alert(res?.error || 'فشل بدء الجولة');
  });
});

// Skip round
$('btn-skip-round').addEventListener('click', () => {
  socket.emit('host:skip', { code: state.roomCode });
});

// Rotate explainer
$('btn-rotate').addEventListener('click', () => {
  socket.emit('host:rotate_explainer', { code: state.roomCode }, res => {
    if (!res?.ok) return;
    // UI updates via room:lobby event
  });
});

// Assign explainer from dropdown
$('sel-explainer').addEventListener('change', () => {
  const socketId = $('sel-explainer').value;
  if (!socketId) return;
  socket.emit('host:assign_explainer', { code: state.roomCode, socketId });
});

// Toggle streak
let streakEnabled = false;
$('btn-toggle-streak').addEventListener('click', () => {
  streakEnabled = !streakEnabled;
  $('streak-status').textContent = streakEnabled ? 'تشغيل' : 'إيقاف';
  socket.emit('host:toggle_streak', { code: state.roomCode, enabled: streakEnabled });
});

// End game
$('btn-end-game').addEventListener('click', () => {
  if (confirm('هل أنت متأكد من إنهاء اللعبة؟')) {
    socket.emit('host:end_game', { code: state.roomCode });
  }
});

// ── Host socket events ─────────────────────────────────────────
socket.on('host:card_bank', ({ cards }) => {
  const list = $('card-bank-list');
  list.innerHTML = '';
  cards.forEach(c => {
    const item = document.createElement('div');
    item.className = 'card-bank-item' +
      (c.used   ? ' used'   : '') +
      (c.custom ? ' custom' : '');
    item.textContent = c.secret;
    item.dataset.index = c.index;
    if (!c.used) {
      item.addEventListener('click', () => {
        socket.emit('host:pick_card', { code: state.roomCode, cardIndex: c.index });
        document.querySelectorAll('.card-bank-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });
    }
    list.appendChild(item);
  });
});

socket.on('host:card', ({ card }) => {
  show('host-current-card'); hide('host-no-card');
  $('host-secret').textContent = card.secret;
  const ul = $('host-forbidden-list');
  ul.innerHTML = '';
  card.forbidden.forEach(w => {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  });
  state.hostHasCard = true;
  refreshStartBtn();
});

socket.on('room:lobby', ({ players, phase, streakEnabled: se }) => {
  state.streakEnabled = se;
  streakEnabled = se;
  $('streak-status').textContent = se ? 'تشغيل' : 'إيقاف';

  // If this player WAS the explainer but is no longer, switch back to guesser
  if (state.role === 'explainer') {
    const me = players.find(p => p.socketId === socket.id);
    if (me && !me.isExplainer) {
      state.role = 'guesser';
      hide('exp-input-area');
      hide('exp-card');
      show('exp-waiting');
      hide('exp-violation-overlay');
      hide('exp-result-overlay');
      $('guesser-live-text').textContent = 'في انتظار الشارح…';
      $('guesser-live-text').classList.remove('has-text');
      hide('guesser-input-area');
      hide('guesser-violation-overlay');
      hide('guesser-result-overlay');
      showScreen('screen-guesser');
    }
  }

  // Update explainer dropdown
  const sel = $('sel-explainer');
  const current = sel.value;
  sel.innerHTML = '<option value="">— اختر —</option>';
  players.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.socketId;
    opt.textContent = p.name + (p.isExplainer ? ' 🎤' : '');
    if (p.isExplainer) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!players.find(p => p.isExplainer)) sel.value = current;
  state.hostHasExplainer = !!players.find(p => p.isExplainer);
  refreshStartBtn();

  // Players list (for manual assign buttons)
  const pl = $('host-players-list');
  pl.innerHTML = '';
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `<span>${esc(p.name)}</span><button class="btn btn-sm btn-ghost" data-id="${esc(p.socketId)}">شارح</button>`;
    row.querySelector('button').addEventListener('click', () => {
      socket.emit('host:assign_explainer', { code: state.roomCode, socketId: p.socketId });
    });
    pl.appendChild(row);
  });

  renderScoreboard(players, 'host-scoreboard');
});

socket.on('round:start', ({ explainerName, duration, scoreboard: sb, streakEnabled: se }) => {
  state.roundDuration = duration;
  state.currentExplainerName = explainerName;

  // Show timer, explanation area, skip button
  show('host-timer-area'); show('host-explanation-area'); show('btn-skip-round');
  hide('btn-start-round');
  $('host-explanation-text').textContent = '';
  hide('host-violation-toast');

  updateTimer('host-timer-arc', 'host-timer-num', duration, duration);
  renderScoreboard(sb, 'host-scoreboard');
});

socket.on('round:tick', ({ remaining }) => {
  updateTimer('host-timer-arc', 'host-timer-num', remaining, state.roundDuration);
});

socket.on('round:explanation', ({ text }) => {
  if (state.role === 'host') {
    $('host-explanation-text').textContent = text;
  }
});

socket.on('round:violation', ({ word, explainerName }) => {
  const toast = $('host-violation-toast');
  $('vio-msg').textContent = `${explainerName} قال الكلمة المحظورة: "${word}"`;
  show(toast);
  soundViolation();
});

socket.on('round:end', (data) => {
  hide('host-timer-area'); hide('host-explanation-area');
  hide('btn-skip-round'); show('btn-start-round');
  state.hostHasCard = false; // host must pick next card
  refreshStartBtn();

  renderScoreboard(data.scoreboard, 'host-scoreboard');

  // Show result toast on host
  if (data.reason === 'correct') {
    showToast(`🎉 ${esc(data.winnerName)} أجاب بشكل صحيح! الكلمة: ${esc(data.secret)}`, 'green');
  } else if (data.reason === 'violation') {
    // violation toast already shown
  } else if (data.reason === 'timeout') {
    showToast(`⏰ انتهى الوقت! الكلمة كانت: ${esc(data.secret)}`, 'dim');
  }
  // Reset for next round — host must pick a new card
  hide('host-current-card'); show('host-no-card');
});

socket.on('host:player_left', ({ name }) => {
  showToast(`${esc(name)} غادر اللعبة`, 'dim');
});

// ── Simple toast for host ──────────────────────────────────────
function showToast(html, type) {
  let toast = document.getElementById('host-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'host-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;left:20px;max-width:400px;margin:auto;padding:12px 16px;border-radius:12px;font-size:.9rem;font-weight:600;z-index:200;animation:fadeIn .2s ease;';
    document.body.appendChild(toast);
  }
  const colors = { green: '#26d47c', red: '#e8365d', dim: '#8a8599' };
  toast.style.background = 'var(--bg2)';
  toast.style.border = `1px solid ${colors[type] || colors.dim}`;
  toast.style.color = colors[type] || colors.dim;
  toast.innerHTML = html;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ══════════════════════════════════════════════════════════════
// EXPLAINER SCREEN
// ══════════════════════════════════════════════════════════════

// When this player is assigned as explainer (may happen before or after joining)
socket.on('explainer:card', ({ card }) => {
  // Switch to explainer screen if on guesser screen
  if (state.role === 'guesser' || state.role === 'explainer') {
    state.role = 'explainer';
    $('exp-room-code').textContent = 'غرفة: ' + state.roomCode;
    showScreen('screen-explainer');
  }
  show('exp-card'); hide('exp-waiting');
  $('exp-secret').textContent = card.secret;
  const ul = $('exp-forbidden-list');
  ul.innerHTML = '';
  card.forbidden.forEach(w => {
    const li = document.createElement('li'); li.textContent = w; ul.appendChild(li);
  });
});

socket.on('round:start', ({ explainerName, duration, scoreboard: sb }) => {
  if (state.role === 'explainer') {
    show('exp-input-area');
    const ta = $('exp-textarea');
    ta.value = '';
    ta.disabled = false;
    ta.focus();
    hide('exp-waiting');
    hide('exp-violation-overlay');
    hide('exp-result-overlay');
    updateTimer('exp-timer-arc', 'exp-timer-num', duration, duration);
    renderScoreboardCompact(sb, 'exp-scoreboard');
  }
  if (state.role === 'guesser') {
    state.currentExplainerName = explainerName;
    const badge = $('guesser-explainer-name');
    badge.innerHTML = `الشارح: <strong>${esc(explainerName)}</strong>`;
    show(badge);
    show('guesser-input-area');
    hide('guesser-violation-overlay');
    hide('guesser-result-overlay');
    $('guesser-inp').value = '';
    $('guesser-inp').disabled = false;
    $('btn-guess').disabled = false;
    hide('guesser-guess-feedback');
    $('guesser-live-text').textContent = '';
    $('guesser-live-text').classList.remove('has-text');
    updateTimer('guesser-timer-arc', 'guesser-timer-num', duration, duration);
    renderScoreboardCompact(sb, 'guesser-scoreboard');
  }
});

socket.on('round:tick', ({ remaining }) => {
  if (state.role === 'explainer') updateTimer('exp-timer-arc', 'exp-timer-num', remaining, state.roundDuration);
  if (state.role === 'guesser') updateTimer('guesser-timer-arc', 'guesser-timer-num', remaining, state.roundDuration);
  state.roundDuration = state.roundDuration; // no-op, just reminder
});

// Typing — debounced emit
let typingDebounce = null;
$('exp-textarea').addEventListener('input', () => {
  const text = $('exp-textarea').value;
  clearTimeout(typingDebounce);
  typingDebounce = setTimeout(() => {
    socket.emit('explainer:typing', { code: state.roomCode, text });
  }, 75);
});

socket.on('explainer:locked', ({ word }) => {
  $('exp-textarea').disabled = true;
  $('exp-vio-word').textContent = `الكلمة: "${word}"`;
  show('exp-violation-overlay');
  soundViolation();
});

socket.on('round:end', (data) => {
  if (state.role === 'explainer') {
    hide('exp-input-area');
    $('exp-textarea').disabled = true;
    setTimeout(() => {
      showResultOverlay('exp-result-overlay', 'exp-result-content', data.reason, data);
      renderScoreboardCompact(data.scoreboard, 'exp-scoreboard');
    }, data.reason === 'violation' ? 1500 : 0);
  }
  if (state.role === 'guesser') {
    $('guesser-inp').disabled = true;
    $('btn-guess').disabled = true;
    showResultOverlay('guesser-result-overlay', 'guesser-result-content', data.reason, data);
    renderScoreboardCompact(data.scoreboard, 'guesser-scoreboard');
  }
});

// ══════════════════════════════════════════════════════════════
// GUESSER SCREEN
// ══════════════════════════════════════════════════════════════

socket.on('round:explanation', ({ text }) => {
  if (state.role === 'guesser') {
    const el = $('guesser-live-text');
    el.textContent = text;
    el.classList.toggle('has-text', text.length > 0);
  }
});

socket.on('round:violation', ({ word, explainerName }) => {
  if (state.role === 'guesser') {
    $('guesser-vio-msg').textContent = `${explainerName} قال الكلمة المحظورة: "${word}"`;
    show('guesser-violation-overlay');
    soundViolation();
    $('guesser-inp').disabled = true;
    $('btn-guess').disabled = true;
  }
});

function submitGuess() {
  const guess = $('guesser-inp').value.trim();
  if (!guess) return;
  socket.emit('guesser:guess', { code: state.roomCode, guess }, res => {
    if (!res) return;
    const fb = $('guesser-guess-feedback');
    if (res.correct) {
      fb.textContent = '✅ إجابة صحيحة!';
      fb.className = 'guess-feedback correct';
      show(fb);
    } else if (res.ok) {
      // A genuine wrong guess (the round is still live).
      soundGuessWrong();
      fb.textContent = '❌ خطأ، حاول مجدداً';
      fb.className = 'guess-feedback wrong';
      show(fb);
      setTimeout(() => hide(fb), 1500);
      $('guesser-inp').value = '';
      $('guesser-inp').focus();
    }
    // res.ok === false → round already ended / someone else won / locked:
    // stay silent; the round:end overlay handles the reveal.
  });
}

$('btn-guess').addEventListener('click', submitGuess);
$('guesser-inp').addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });

// ══════════════════════════════════════════════════════════════
// COMMON EVENTS
// ══════════════════════════════════════════════════════════════

socket.on('room:streak_toggle', ({ enabled }) => {
  state.streakEnabled = enabled;
});

socket.on('room:host_disconnected', () => {
  showBanner('انقطع اتصال المضيف… في انتظار إعادة الاتصال');
});

socket.on('room:closed', ({ reason }) => {
  alert(reason || 'أُغلقت الغرفة');
  location.reload();
});

socket.on('game:ended', ({ scoreboard: sb }) => {
  const list = $('final-scoreboard');
  list.innerHTML = '';
  const sorted = [...sb].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i === 0 ? ' winner-row' : '');
    row.innerHTML = `<span class="player-name">${i === 0 ? '🥇 ' : ''}${esc(p.name)}</span><span class="player-pts">${p.score}</span>`;
    list.appendChild(row);
  });
  showScreen('screen-ended');
});

$('btn-play-again').addEventListener('click', () => location.reload());

// ── Reconnection ───────────────────────────────────────────────
socket.on('disconnect', () => showBanner('انقطع الاتصال… جاري إعادة المحاولة'));
socket.on('connect',    () => {
  hideBanner();
  // Skip the very first connect (no session yet) — only act on a true reconnect.
  if (!state.roomCode || !state.playerName) return;

  if (state.role === 'host') {
    // Reclaim the host seat with the token issued at room creation.
    socket.emit('host:reconnect', { code: state.roomCode, hostToken: state.hostToken }, res => {
      if (!res?.ok) { alert(res?.error || 'تعذّر استعادة الغرفة'); location.reload(); }
    });
  } else {
    // Rejoin by name — the server restores our score and resyncs any live round.
    socket.emit('player:join', { code: state.roomCode, name: state.playerName }, () => {});
  }
});

let bannerEl = null;
function showBanner(msg) {
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e8923a;color:#111;text-align:center;padding:8px;font-size:.9rem;font-weight:700;z-index:300;';
    document.body.prepend(bannerEl);
  }
  bannerEl.textContent = msg;
  bannerEl.style.display = 'block';
}
function hideBanner() { if (bannerEl) bannerEl.style.display = 'none'; }

// round:tick handler needs access to state.roundDuration — set it on round:start
socket.on('round:start', ({ duration }) => { state.roundDuration = duration; });
