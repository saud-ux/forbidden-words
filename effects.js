/* ── Forbidden Words — visual effects (juice) ──────────────────────────────
   Lightweight, dependency-free. Exposes window.FX.
   - Living animated background (floating gold orbs on a drifting gradient)
   - Confetti bursts, full-screen flashes, screen shake, big number/text pops
   All canvas work is throttled and self-cleaning so it stays smooth on phones. */
'use strict';

const FX = (() => {
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ─────────────────────────────────────────────────────────────────────────
  // Living background: a low-opacity canvas of slowly floating gold orbs.
  // ─────────────────────────────────────────────────────────────────────────
  function initBackground() {
    if (prefersReduced) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'fx-bg';
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      zIndex: '0', pointerEvents: 'none',
    });
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');

    let w, h, orbs;
    const COUNT = Math.min(28, Math.floor(window.innerWidth / 28));
    function resize() {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
    }
    function makeOrb() {
      const r = (Math.random() * 60 + 20) * devicePixelRatio;
      return {
        x: Math.random() * w, y: Math.random() * h, r,
        vx: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
        vy: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
        a: Math.random() * 0.06 + 0.02,
      };
    }
    resize();
    orbs = Array.from({ length: COUNT }, makeOrb);
    window.addEventListener('resize', resize);

    (function loop() {
      ctx.clearRect(0, 0, w, h);
      for (const o of orbs) {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r) o.x = w + o.r; if (o.x > w + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = h + o.r; if (o.y > h + o.r) o.y = -o.r;
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, `rgba(245,166,35,${o.a})`);
        g.addColorStop(1, 'rgba(245,166,35,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(loop);
    })();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Confetti burst — `origin` = 'top' (rain) or {x,y} ratios (point burst).
  // ─────────────────────────────────────────────────────────────────────────
  const CONFETTI_COLORS = ['#f5a623', '#ffd76b', '#26d47c', '#ffffff', '#ff6b8a', '#6bc5ff'];
  function confetti({ count = 140, origin = 'top', power = 1 } = {}) {
    if (prefersReduced) return;
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      zIndex: '500', pointerEvents: 'none',
    });
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const W = canvas.width = innerWidth, H = canvas.height = innerHeight;

    const ox = origin === 'top' ? null : origin.x * W;
    const oy = origin === 'top' ? null : origin.y * H;
    const parts = Array.from({ length: count }, () => {
      const fromTop = origin === 'top';
      const angle = fromTop ? Math.PI / 2 + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
      const speed = (fromTop ? 2 + Math.random() * 3 : 4 + Math.random() * 7) * power;
      return {
        x: fromTop ? Math.random() * W : ox,
        y: fromTop ? -20 - Math.random() * H * 0.3 : oy,
        vx: Math.cos(angle) * speed,
        vy: fromTop ? speed : Math.sin(angle) * speed,
        size: 5 + Math.random() * 7,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        life: 0, ttl: 90 + Math.random() * 60,
      };
    });

    (function loop() {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of parts) {
        if (p.life > p.ttl) continue;
        alive = true;
        p.life++; p.vy += 0.12; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (alive) requestAnimationFrame(loop);
      else canvas.remove();
    })();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Full-screen color flash.
  // ─────────────────────────────────────────────────────────────────────────
  function flash(color = 'rgba(38,212,124,0.35)', ms = 420) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', background: color, zIndex: '450',
      pointerEvents: 'none', opacity: '0', transition: `opacity ${ms / 2}ms ease`,
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), ms / 2); }, ms / 2);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen shake (applied to <body>).
  // ─────────────────────────────────────────────────────────────────────────
  function shake(level = 'normal') {
    if (prefersReduced) return;
    const cls = level === 'hard' ? 'fx-shake-hard' : 'fx-shake';
    document.body.classList.remove('fx-shake', 'fx-shake-hard');
    void document.body.offsetWidth; // reflow to restart animation
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), 600);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Big centered number/text pop (used for the 3-2-1 countdown and GO!).
  // ─────────────────────────────────────────────────────────────────────────
  function bigText(text, { color = 'var(--accent)', ms = 850 } = {}) {
    const el = document.createElement('div');
    el.className = 'fx-bigtext';
    el.textContent = text;
    el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  return { initBackground, confetti, flash, shake, bigText };
})();

window.FX = FX;
document.addEventListener('DOMContentLoaded', () => FX.initBackground());
