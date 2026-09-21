/* ── Forbidden Words — Toxic Arcade Effects ─────────────────────────────────
   Matrix rain background, glitch effects, confetti (green-themed),
   flashes, shake, big-text pops, typing logo animation.
   All canvas work is throttled and self-cleaning. */
'use strict';

const FX = (() => {
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ─────────────────────────────────────────────────────────────────────────
  // Matrix rain background — green characters falling in columns
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

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
    const fontSize = 14;
    let w, h, columns, drops;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      columns = Math.floor(w / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < columns; i++) {
        if (Math.random() > 0.97) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          // Head character (brighter)
          ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
          ctx.font = `${fontSize}px monospace`;
          ctx.fillText(char, x, y);

          // Trail character (dimmer)
          if (drops[i] > 1) {
            const trailChar = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillStyle = 'rgba(34, 197, 94, 0.06)';
            ctx.fillText(trailChar, x, y - fontSize);
          }

          drops[i]++;
          if (drops[i] * fontSize > h && Math.random() > 0.98) {
            drops[i] = 0;
          }
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Logo animation: glitch + type + pulse combined
  // ─────────────────────────────────────────────────────────────────────────
  function initLogoAnimation() {
    const logoIcon = document.querySelector('.logo-icon');
    const logoTitle = document.querySelector('.logo h1');
    if (!logoIcon || !logoTitle) return;

    // Add glitch class to icon
    logoIcon.classList.add('logo-glitch');

    // Typing effect for title
    const fullText = logoTitle.textContent;
    if (prefersReduced) return;

    logoTitle.textContent = '';
    logoTitle.style.borderLeft = '3px solid var(--accent)';
    logoTitle.style.paddingLeft = '4px';

    let i = 0;
    function typeChar() {
      if (i < fullText.length) {
        logoTitle.textContent += fullText[i];
        i++;
        setTimeout(typeChar, 80 + Math.random() * 60);
      } else {
        // Remove cursor after typing
        setTimeout(() => {
          logoTitle.style.borderLeft = 'none';
          logoTitle.style.paddingLeft = '0';
        }, 600);
      }
    }
    // Small delay before typing starts
    setTimeout(typeChar, 500);

    // Periodic glitch flicker on the icon
    setInterval(() => {
      if (Math.random() > 0.7) {
        logoIcon.style.opacity = '0.6';
        setTimeout(() => { logoIcon.style.opacity = '1'; }, 80);
        setTimeout(() => { logoIcon.style.opacity = '0.8'; }, 120);
        setTimeout(() => { logoIcon.style.opacity = '1'; }, 180);
      }
    }, 2500);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Confetti burst — green-themed
  // ─────────────────────────────────────────────────────────────────────────
  const CONFETTI_COLORS = ['#22c55e', '#4ade80', '#86efac', '#ffffff', '#16a34a', '#a7f3d0'];
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
  // Full-screen color flash (green-tinted by default)
  // ─────────────────────────────────────────────────────────────────────────
  function flash(color = 'rgba(34,197,94,0.25)', ms = 420) {
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
  // Screen shake
  // ─────────────────────────────────────────────────────────────────────────
  function shake(level = 'normal') {
    if (prefersReduced) return;
    const cls = level === 'hard' ? 'fx-shake-hard' : 'fx-shake';
    document.body.classList.remove('fx-shake', 'fx-shake-hard');
    void document.body.offsetWidth;
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), 600);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Big centered text pop (countdown, GO!, streak)
  // ─────────────────────────────────────────────────────────────────────────
  function bigText(text, { color = 'var(--accent)', ms = 850 } = {}) {
    const el = document.createElement('div');
    el.className = 'fx-bigtext';
    el.textContent = text;
    el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Glitch burst — brief screen-wide distortion on events
  // ─────────────────────────────────────────────────────────────────────────
  function glitchBurst(ms = 300) {
    if (prefersReduced) return;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '450', pointerEvents: 'none',
      background: 'transparent',
      boxShadow: 'inset 4px 0 rgba(34,197,94,0.15), inset -4px 0 rgba(239,68,68,0.1)',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(el);

    let frame = 0;
    const maxFrames = ms / 16;
    function animate() {
      if (frame > maxFrames) { el.remove(); return; }
      const offset = (Math.random() - 0.5) * 6;
      el.style.transform = `translateX(${offset}px)`;
      el.style.opacity = String(1 - frame / maxFrames);
      frame++;
      requestAnimationFrame(animate);
    }
    animate();
  }

  return { initBackground, initLogoAnimation, confetti, flash, shake, bigText, glitchBurst };
})();

window.FX = FX;
document.addEventListener('DOMContentLoaded', () => {
  FX.initBackground();
  FX.initLogoAnimation();
});
