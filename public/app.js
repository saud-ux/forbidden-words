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
  role: null,
  roomCode: null,
  playerName: null,
  hostToken: null,
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

// ── Session persistence ────────────────────────────────────────
const SESSION_KEY = 'fw_session';
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: state.role, roomCode: state.roomCode,
      playerName: state.playerName, hostToken: state.hostToken,
    }));
  } catch (_) {}
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch (_) { return null; }
}
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }

(function hydrateSession() {
  const s = loadSession();
  if (s && s.roomCode && s.playerName) {
    state.role = s.role;
    state.roomCode = s.roomCode;
    state.playerName = s.playerName;
    state.hostToken = s.hostToken;
  }
})();

// ── Sound ──────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }
function playTone(freq, type, duration, gainVal = 0.3, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + duration + 0.05);
  } catch (_) {}
}
function soundCorrect()    { playTone(523,'sine',.15,.3); playTone(659,'sine',.15,.3,.15); playTone(784,'sine',.25,.3,.3); }
function soundViolation()  { playTone(180,'sawtooth',.4,.35); playTone(140,'sawtooth',.3,.35,.3); }
function soundTimeout()    { playTone(330,'triangle',.4,.25); playTone(220,'triangle',.6,.25,.3); }
function soundTick()       { playTone(880,'square',.06,.12); }
function soundGuessWrong() { playTone(250,'square',.12,.15); }
function soundCountBeep()  { playTone(440,'triangle',.18,.25); }
function soundGo()         { playTone(523,'sine',.12,.3); playTone(784,'sine',.25,.3,.1); }
function soundHeartbeat()  { playTone(70,'sine',.14,.4); playTone(60,'sine',.18,.4,.16); }
function soundNear()       { playTone(660,'triangle',.12,.22); playTone(560,'triangle',.16,.22,.12); }

// ── Screens ────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(el) { if (typeof el === 'string') el = $(el); el?.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = $(el); el?.classList.add('hidden'); }

function timerArcOffset(remaining, total) { return 326.73 - (remaining / total) * 326.73; }

function updateTimer(arcId, numId, remaining, total) {
  const arc = $(arcId), num = $(numId);
  if (!arc || !num) return;
  arc.style.strokeDashoffset = timerArcOffset(remaining, total);
  num.textContent = remaining;
  arc.classList.toggle('warning', remaining <= 20 && remaining > 10);
  arc.classList.toggle('danger',  remaining <= 10);
  setPanic(remaining > 0 && remaining <= 10);
  if (remaining > 5 && remaining <= 10) soundTick();
  else if (remaining > 0 && remaining <= 5) soundHeartbeat();
}

let panicVignette = null;
function setPanic(on) {
  if (on && !panicVignette) {
    panicVignette = document.createElement('div');
    panicVignette.id = 'panic-vignette';
    document.body.appendChild(panicVignette);
  }
  document.body.classList.toggle('panic', on);
}

function streakFlame(p) {
  if (!state.streakEnabled || !p.streak || p.streak < 2) return '';
  return ` <span class="streak-flame">🔥${p.streak}</span>`;
}

function renderScoreboard(players, containerId) {
  const el = $(containerId); if (!el) return;
  el.innerHTML = '';
  [...players].sort((a,b) => b.score - a.score).forEach(p => {
    const row = document.createElement('div');
    row.className = 'score-row' + (p.isExplainer ? ' explainer' : '');
    row.innerHTML = `<span class="player-name">${esc(p.name)}${p.isExplainer?' 🎤':''}${streakFlame(p)}</span><span class="player-pts">${p.score}</span>`;
    el.appendChild(row);
  });
}

function renderScoreboardCompact(players, containerId) {
  const el = $(containerId); if (!el) return;
  el.innerHTML = '';
  [...players].sort((a,b) => b.score - a.score).forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'sc-chip' + (p.isExplainer ? ' is-explainer' : '');
    chip.innerHTML = `${esc(p.name)} <span class="sc-pts">${p.score}</span>${streakFlame(p)}`;
    el.appendChild(chip);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showResultOverlay(overlayId, contentId, reason, data) {
  const overlay = $(overlayId), content = $(contentId);
  if (!overlay || !content) return;
  let html = '';
  if (reason === 'correct') {
    soundCorrect();
    html = `<div class="result-content"><h2 style="color:var(--green)">🎉 إجابة صحيحة!</h2><p>أجاب <strong>${esc(data.winnerName)}</strong> بشكل صحيح</p><div class="secret-reveal">${esc(data.secret)}</div><p>+${data.guesserPoints} نقطة</p>${data.explainerPoints?`<p style="color:var(--text-dim)">الشارح: +${data.explainerPoints} نقطة</p>`:''}</div>`;
  } else if (reason === 'violation') {
    soundViolation();
    html = `<div class="result-content"><h2 style="color:var(--red)">⛔ مخالفة!</h2><p>قال الشارح الكلمة المحظورة: <strong style="color:var(--red)">${esc(data.violatingWord||'')}</strong></p><div class="secret-reveal">${esc(data.secret)}</div><p style="color:var(--text-dim)">0 نقطة لهذه الجولة</p></div>`;
  } else if (reason === 'timeout') {
    soundTimeout();
    html = `<div class="result-content"><h2 style="color:var(--text-dim)">⏰ انتهى الوقت!</h2><div class="secret-reveal">${esc(data.secret)}</div><p style="color:var(--text-dim)">0 نقطة لهذه الجولة</p></div>`;
  } else if (reason === 'skip') {
    html = `<div class="result-content"><h2 style="color:var(--text-dim)">⏭ تم التخطي</h2><div class="secret-reveal">${esc(data.secret)}</div></div>`;
  } else {
    html = `<div class="result-content"><h2>انتهت الجولة</h2><div class="secret-reveal">${esc(data.secret||'')}</div></div>`;
  }
  content.innerHTML = html;
  show(overlay);
  setTimeout(() => hide(overlay), 4000);
}

// ══════════════════════════════════════════════════════════════
// CONFIRM MODAL — replaces bare browser confirm() everywhere
// ══════════════════════════════════════════════════════════════
let _confirmCb = null;
function askConfirm(message, onYes) {
  $('confirm-message').textContent = message;
  _confirmCb = onYes;
  show('modal-confirm');
}
$('btn-confirm-yes').addEventListener('click', () => {
  hide('modal-confirm');
  const cb = _confirmCb; _confirmCb = null;
  cb?.();
});
$('btn-confirm-no').addEventListener('click', () => { hide('modal-confirm'); _confirmCb = null; });
$('modal-confirm').addEventListener('click', e => {
  if (e.target === $('modal-confirm')) { hide('modal-confirm'); _confirmCb = null; }
});

// ══════════════════════════════════════════════════════════════
// LANDING SCREEN
// ══════════════════════════════════════════════════════════════
$('btn-create').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  if (!name) return showError('أدخل اسمك أولاً');
  socket.emit('host:create', { name }, res => {
    if (!res.ok) return showError('حدث خطأ، حاول مجدداً');
    state.role = 'host'; state.roomCode = res.code;
    state.playerName = name; state.hostToken = res.hostToken;
    $('host-room-code').textContent = res.code;
    showScreen('screen-host');
    saveSession();
  });
});
$('btn-join').addEventListener('click', doJoin);
$('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
$('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });

function doJoin() {
  const name = $('inp-name').value.trim(), code = $('inp-code').value.trim();
  if (!name) return showError('أدخل اسمك أولاً');
  if (!code) return showError('أدخل كود الغرفة');
  socket.emit('player:join', { code, name }, res => {
    if (!res.ok) return showError(res.error || 'فشل الانضمام');
    state.role = 'guesser'; state.roomCode = code; state.playerName = res.name;
    $('guesser-room-code').textContent = 'غرفة: ' + code;
    showScreen('screen-guesser');
    saveSession();
  });
}

function showError(msg) {
  const el = $('landing-error'); el.textContent = msg; show(el);
  setTimeout(() => hide(el), 3000);
}

// ══════════════════════════════════════════════════════════════
// HOST SCREEN
// ══════════════════════════════════════════════════════════════
$('btn-random-card').addEventListener('click', () => {
  socket.emit('host:pick_card', { code: state.roomCode, cardIndex: -1 }, res => {
    if (!res?.ok) console.warn('pick card failed', res);
  });
});

$('btn-add-card').addEventListener('click', () => {
  $('inp-card-secret').value = '';
  document.querySelectorAll('.inp-forbidden').forEach(i => i.value = '');
  hide('modal-add-error'); show('modal-add-card'); $('inp-card-secret').focus();
});
$('btn-cancel-add-card').addEventListener('click', () => hide('modal-add-card'));
$('modal-add-card').addEventListener('click', e => { if (e.target === $('modal-add-card')) hide('modal-add-card'); });

$('btn-submit-add-card').addEventListener('click', () => {
  const secret = $('inp-card-secret').value.trim();
  const forbidden = [...document.querySelectorAll('.inp-forbidden')].map(i => i.value.trim()).filter(Boolean);
  const errEl = $('modal-add-error');
  if (!secret) { errEl.textContent = 'أدخل الكلمة السرية'; show(errEl); return; }
  if (!forbidden.length) { errEl.textContent = 'أدخل كلمة محظورة على الأقل'; show(errEl); return; }
  hide(errEl); $('btn-submit-add-card').disabled = true;
  socket.emit('host:add_card', { code: state.roomCode, secret, forbidden }, res => {
    $('btn-submit-add-card').disabled = false;
    if (!res?.ok) { errEl.textContent = res?.error || 'فشل الإضافة'; show(errEl); return; }
    hide('modal-add-card'); showToast(`✅ تمت إضافة: ${esc(secret)}`, 'green');
  });
});

$('btn-start-round').addEventListener('click', () => {
  socket.emit('host:start_round', { code: state.roomCode }, res => {
    if (!res?.ok) alert(res?.error || 'فشل بدء الجولة');
  });
});
$('btn-skip-round').addEventListener('click', () => { socket.emit('host:skip', { code: state.roomCode }); });
$('btn-rotate').addEventListener('click', () => { socket.emit('host:rotate_explainer', { code: state.roomCode }, () => {}); });
$('sel-explainer').addEventListener('change', () => {
  const socketId = $('sel-explainer').value;
  if (!socketId) return;
  socket.emit('host:assign_explainer', { code: state.roomCode, socketId });
});

let streakEnabled = false;
$('btn-toggle-streak').addEventListener('click', () => {
  streakEnabled = !streakEnabled;
  $('streak-status').textContent = streakEnabled ? 'تشغيل' : 'إيقاف';
  socket.emit('host:toggle_streak', { code: state.roomCode, enabled: streakEnabled });
});

// End game — keeps host on game:ended screen to see final scoreboard
$('btn-end-game').addEventListener('click', () => {
  askConfirm('هل أنت متأكد من إنهاء اللعبة؟', () => {
    socket.emit('host:end_game', { code: state.roomCode });
  });
});

// Host exit — ends game AND returns immediately to main menu
$('btn-exit-host')?.addEventListener('click', () => {
  askConfirm('الخروج سيُنهي اللعبة لجميع اللاعبين. هل أنت متأكد؟', () => {
    socket.emit('host:end_game', { code: state.roomCode });
    clearSession();
    // Small delay so server can broadcast game:ended to players before we reload
    setTimeout(() => location.reload(), 400);
  });
});

// ── Host socket events ─────────────────────────────────────────
socket.on('host:card_bank', ({ cards }) => {
  const list = $('card-bank-list'); list.innerHTML = '';
  cards.forEach(c => {
    const item = document.createElement('div');
    item.className = 'card-bank-item' + (c.used?' used':'') + (c.custom?' custom':'');
    item.textContent = c.secret; item.dataset.index = c.index;
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
  const ul = $('host-forbidden-list'); ul.innerHTML = '';
  card.forbidden.forEach(w => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
  state.hostHasCard = true; refreshStartBtn();
});

socket.on('room:lobby', ({ players, phase, streakEnabled: se }) => {
  state.streakEnabled = se; streakEnabled = se;
  $('streak-status').textContent = se ? 'تشغيل' : 'إيقاف';

  if (state.role === 'explainer') {
    const me = players.find(p => p.socketId === socket.id);
    if (me && !me.isExplainer) {
      state.role = 'guesser'; saveSession();
      hide('exp-input-area'); hide('exp-card'); show('exp-waiting');
      hide('exp-violation-overlay'); hide('exp-result-overlay');
      $('guesser-live-text').textContent = 'في انتظار الشارح…';
      $('guesser-live-text').classList.remove('has-text');
      hide('guesser-input-area'); hide('guesser-violation-overlay'); hide('guesser-result-overlay');
      showScreen('screen-guesser');
    }
  }

  const sel = $('sel-explainer');
  const current = sel.value;
  sel.innerHTML = '<option value="">— اختر —</option>';
  players.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.socketId; opt.textContent = p.name + (p.isExplainer ? ' 🎤' : '');
    if (p.isExplainer) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!players.find(p => p.isExplainer)) sel.value = current;
  state.hostHasExplainer = !!players.find(p => p.isExplainer);
  refreshStartBtn();

  const pl = $('host-players-list'); pl.innerHTML = '';
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

socket.on('round:start', ({ explainerName, duration, scoreboard: sb }) => {
  state.roundDuration = duration; state.currentExplainerName = explainerName;
  show('host-timer-area'); show('host-explanation-area'); show('btn-skip-round');
  hide('btn-start-round'); $('host-explanation-text').textContent = ''; hide('host-violation-toast');
  updateTimer('host-timer-arc', 'host-timer-num', duration, duration);
  renderScoreboard(sb, 'host-scoreboard');
});
socket.on('round:tick', ({ remaining }) => { updateTimer('host-timer-arc', 'host-timer-num', remaining, state.roundDuration); });
socket.on('round:explanation', ({ text }) => { if (state.role === 'host') $('host-explanation-text').textContent = text; });
socket.on('round:violation', ({ word, explainerName }) => {
  $('vio-msg').textContent = `${explainerName} قال الكلمة المحظورة: "${word}"`;
  show('host-violation-toast'); soundViolation();
});
socket.on('round:end', (data) => {
  hide('host-timer-area'); hide('host-explanation-area'); hide('btn-skip-round'); show('btn-start-round');
  state.hostHasCard = false; refreshStartBtn();
  renderScoreboard(data.scoreboard, 'host-scoreboard');
  if (data.reason === 'correct') showToast(`🎉 ${esc(data.winnerName)} أجاب بشكل صحيح! الكلمة: ${esc(data.secret)}`, 'green');
  else if (data.reason === 'timeout') showToast(`⏰ انتهى الوقت! الكلمة كانت: ${esc(data.secret)}`, 'dim');
  hide('host-current-card'); show('host-no-card');
});
socket.on('host:player_left', ({ name }) => { showToast(`${esc(name)} غادر اللعبة`, 'dim'); });

function showToast(html, type) {
  let toast = document.getElementById('host-toast');
  if (!toast) {
    toast = document.createElement('div'); toast.id = 'host-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;left:20px;max-width:400px;margin:auto;padding:12px 16px;border-radius:12px;font-size:.9rem;font-weight:600;z-index:200;animation:fadeIn .2s ease;';
    document.body.appendChild(toast);
  }
  const colors = { green:'#26d47c', red:'#e8365d', dim:'#8a8599' };
  toast.style.background = 'var(--bg2)'; toast.style.border = `1px solid ${colors[type]||colors.dim}`; toast.style.color = colors[type]||colors.dim;
  toast.innerHTML = html; toast.style.display = 'block';
  clearTimeout(toast._timer); toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ══════════════════════════════════════════════════════════════
// EXPLAINER SCREEN
// ══════════════════════════════════════════════════════════════
socket.on('explainer:card', ({ card }) => {
  if (state.role === 'guesser' || state.role === 'explainer') {
    state.role = 'explainer'; $('exp-room-code').textContent = 'غرفة: ' + state.roomCode;
    showScreen('screen-explainer'); saveSession();
  }
  show('exp-card'); hide('exp-waiting');
  $('exp-secret').textContent = card.secret;
  const ul = $('exp-forbidden-list'); ul.innerHTML = '';
  card.forbidden.forEach(w => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
});

socket.on('round:start', ({ explainerName, duration, scoreboard: sb }) => {
  if (state.role === 'explainer') {
    show('exp-input-area');
    const ta = $('exp-textarea'); ta.value = ''; ta.disabled = false; ta.focus();
    hide('exp-waiting'); hide('exp-violation-overlay'); hide('exp-result-overlay');
    updateTimer('exp-timer-arc', 'exp-timer-num', duration, duration);
    renderScoreboardCompact(sb, 'exp-scoreboard');
  }
  if (state.role === 'guesser') {
    state.currentExplainerName = explainerName;
    const badge = $('guesser-explainer-name');
    badge.innerHTML = `الشارح: <strong>${esc(explainerName)}</strong>`; show(badge);
    show('guesser-input-area'); hide('guesser-violation-overlay'); hide('guesser-result-overlay');
    $('guesser-inp').value = ''; $('guesser-inp').disabled = false; $('btn-guess').disabled = false;
    hide('guesser-guess-feedback');
    $('guesser-live-text').textContent = ''; $('guesser-live-text').classList.remove('has-text');
    updateTimer('guesser-timer-arc', 'guesser-timer-num', duration, duration);
    renderScoreboardCompact(sb, 'guesser-scoreboard');
  }
});

socket.on('round:tick', ({ remaining }) => {
  if (state.role === 'explainer') updateTimer('exp-timer-arc', 'exp-timer-num', remaining, state.roundDuration);
  if (state.role === 'guesser') updateTimer('guesser-timer-arc', 'guesser-timer-num', remaining, state.roundDuration);
});

let typingDebounce = null;
$('exp-textarea').addEventListener('input', () => {
  const text = $('exp-textarea').value;
  clearTimeout(typingDebounce);
  typingDebounce = setTimeout(() => { socket.emit('explainer:typing', { code: state.roomCode, text }); }, 75);
});

socket.on('explainer:locked', ({ word }) => {
  $('exp-textarea').disabled = true; $('exp-vio-word').textContent = `الكلمة: "${word}"`;
  show('exp-violation-overlay'); soundViolation();
});

socket.on('round:end', (data) => {
  if (state.role === 'explainer') {
    hide('exp-input-area'); $('exp-textarea').disabled = true;
    setTimeout(() => {
      showResultOverlay('exp-result-overlay', 'exp-result-content', data.reason, data);
      renderScoreboardCompact(data.scoreboard, 'exp-scoreboard');
    }, data.reason === 'violation' ? 1500 : 0);
  }
  if (state.role === 'guesser') {
    $('guesser-inp').disabled = true; $('btn-guess').disabled = true;
    showResultOverlay('guesser-result-overlay', 'guesser-result-content', data.reason, data);
    renderScoreboardCompact(data.scoreboard, 'guesser-scoreboard');
  }
});

// ══════════════════════════════════════════════════════════════
// GUESSER SCREEN
// ══════════════════════════════════════════════════════════════
socket.on('round:explanation', ({ text }) => {
  if (state.role === 'guesser') {
    const el = $('guesser-live-text'); el.textContent = text;
    el.classList.toggle('has-text', text.length > 0);
  }
});

socket.on('round:violation', ({ word, explainerName }) => {
  if (state.role === 'guesser') {
    $('guesser-vio-msg').textContent = `${explainerName} قال الكلمة المحظورة: "${word}"`;
    show('guesser-violation-overlay'); soundViolation();
    $('guesser-inp').disabled = true; $('btn-guess').disabled = true;
  }
});

function submitGuess() {
  const guess = $('guesser-inp').value.trim(); if (!guess) return;
  socket.emit('guesser:guess', { code: state.roomCode, guess }, res => {
    if (!res) return;
    const fb = $('guesser-guess-feedback');
    if (res.correct) {
      fb.textContent = '✅ إجابة صحيحة!'; fb.className = 'guess-feedback correct'; show(fb);
    } else if (res.ok) {
      if (res.near) { soundNear(); fb.textContent = '🔥 قريب جدًا!'; fb.className = 'guess-feedback near'; }
      else { soundGuessWrong(); fb.textContent = '❌ خطأ، حاول مجدداً'; fb.className = 'guess-feedback wrong'; }
      show(fb); setTimeout(() => hide(fb), 1500);
      $('guesser-inp').value = ''; $('guesser-inp').focus();
    }
  });
}
$('btn-guess').addEventListener('click', submitGuess);
$('guesser-inp').addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });

// ══════════════════════════════════════════════════════════════
// PLAYER EXIT (guesser & explainer) — confirmed, then server-notified
// ══════════════════════════════════════════════════════════════
function leaveSession() {
  askConfirm('هل أنت متأكد من الخروج؟', () => {
    clearSession();
    let done = false;
    const finish = () => { if (done) return; done = true; location.reload(); };
    socket.emit('player:leave', { code: state.roomCode }, finish);
    setTimeout(finish, 600); // fallback if ack never arrives
  });
}
$('btn-exit-guesser')?.addEventListener('click', leaveSession);
$('btn-exit-explainer')?.addEventListener('click', leaveSession);

// ══════════════════════════════════════════════════════════════
// COMMON EVENTS
// ══════════════════════════════════════════════════════════════
socket.on('room:streak_toggle', ({ enabled }) => { state.streakEnabled = enabled; });

function runCountdown(seconds) {
  let n = seconds;
  (function step() {
    if (n > 0) { FX.bigText(String(n), { color:'var(--accent)', ms:850 }); soundCountBeep(); n -= 1; setTimeout(step, 1000); }
    else { FX.bigText('انطلق!', { color:'var(--green)', ms:850 }); soundGo(); }
  })();
}
socket.on('round:countdown', ({ seconds }) => runCountdown(seconds || 3));

socket.on('round:end', (data) => {
  setPanic(false);
  if (data.reason === 'correct') {
    FX.flash('rgba(38,212,124,0.30)'); FX.confetti({ count:160, origin:'top' });
    if (state.streakEnabled) {
      const w = (data.scoreboard||[]).find(p => p.name === data.winnerName);
      if (w && w.streak >= 2) setTimeout(() => FX.bigText('🔥 '+w.streak, { color:'var(--accent)', ms:1100 }), 350);
    }
  }
});

socket.on('round:violation', () => { FX.flash('rgba(232,54,93,0.32)'); FX.shake('hard'); });

let wrongPingWrap = null;
function showWrongPing(name, near) {
  if (!wrongPingWrap) { wrongPingWrap = document.createElement('div'); wrongPingWrap.id = 'wrong-ping-wrap'; document.body.appendChild(wrongPingWrap); }
  const chip = document.createElement('div');
  chip.className = 'wrong-ping' + (near ? ' near' : '');
  chip.textContent = near ? '🔥 '+name+' اقترب!' : '❌ '+name;
  wrongPingWrap.appendChild(chip);
  setTimeout(() => chip.remove(), 1400);
  playTone(near ? 560 : 300, 'square', .07, .07);
}
socket.on('round:wrong_guess', ({ name, near }) => showWrongPing(name, near));

socket.on('room:host_disconnected', () => showBanner('انقطع اتصال المضيف… في انتظار إعادة الاتصال'));
socket.on('room:closed', ({ reason }) => { clearSession(); alert(reason || 'أُغلقت الغرفة'); location.reload(); });

socket.on('game:ended', ({ scoreboard: sb }) => {
  clearSession();
  const list = $('final-scoreboard'); list.innerHTML = '';
  [...sb].sort((a,b) => b.score - a.score).forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i===0?' winner-row':'');
    row.innerHTML = `<span class="player-name">${i===0?'🥇 ':''}${esc(p.name)}</span><span class="player-pts">${p.score}</span>`;
    list.appendChild(row);
  });
  showScreen('screen-ended');
});

$('btn-play-again').addEventListener('click', () => location.reload());

// ── Reconnection ───────────────────────────────────────────────
socket.on('disconnect', () => showBanner('انقطع الاتصال… جاري إعادة المحاولة'));
socket.on('connect', () => {
  hideBanner();
  if (!state.roomCode || !state.playerName) return;
  if (state.role === 'host') {
    socket.emit('host:reconnect', { code: state.roomCode, hostToken: state.hostToken }, res => {
      if (!res?.ok) { clearSession(); alert(res?.error || 'تعذّر استعادة الغرفة'); location.reload(); return; }
      $('host-room-code').textContent = state.roomCode;
      showScreen('screen-host');
    });
  } else {
    socket.emit('player:join', { code: state.roomCode, name: state.playerName }, res => {
      if (!res?.ok) { clearSession(); return; }
      state.playerName = res.name; saveSession();
      $('guesser-room-code').textContent = 'غرفة: ' + state.roomCode;
      showScreen(state.role === 'explainer' ? 'screen-explainer' : 'screen-guesser');
    });
  }
});

let bannerEl = null;
function showBanner(msg) {
  if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e8923a;color:#111;text-align:center;padding:8px;font-size:.9rem;font-weight:700;z-index:300;'; document.body.prepend(bannerEl); }
  bannerEl.textContent = msg; bannerEl.style.display = 'block';
}
function hideBanner() { if (bannerEl) bannerEl.style.display = 'none'; }

socket.on('round:start', ({ duration }) => { state.roundDuration = duration; });
