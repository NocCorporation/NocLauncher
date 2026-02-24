const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// Bind UI events once even if this file accidentally contains duplicated blocks.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) return null;
  const key = `bound_${event}`;
  if (el.dataset[key] === '1') return el;
  el.dataset[key] = '1';
  el.addEventListener(event, handler);
  return el;
}

// ---------------------------------------------------------------------------
// Custom dropdown for Loader (prevents the native white <select> menu)
// ---------------------------------------------------------------------------
function loaderLabel(v) {
  const k = String(v || 'vanilla');
  if (k === 'fabric') return 'Fabric';
  if (k === 'forge') return 'Forge';
  if (k === 'neoforge') return 'NeoForge';
  if (k === 'optifine') return 'OptiFine';
  return 'Vanilla';
}

function syncLoaderDropdown() {
  const sel = document.getElementById('loaderMode');
  const btnText = document.getElementById('loaderBtnText');
  const menu = document.getElementById('loaderMenu');
  if (!sel || !btnText || !menu) return;

  const val = String(sel.value || 'vanilla');
  btnText.textContent = loaderLabel(val);
  menu.querySelectorAll('[data-value]')?.forEach((b) => {
    b.classList.toggle('active', String(b.dataset.value) === val);
  });
}

function initLoaderDropdown() {
  const sel = document.getElementById('loaderMode');
  const btn = document.getElementById('loaderBtn');
  const menu = document.getElementById('loaderMenu');
  const wrap = document.getElementById('loaderDropdown');
  if (!sel || !btn || !menu || !wrap) return;

  const close = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    syncLoaderDropdown();
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  };

  on('loaderBtn', 'click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open(); else close();
  });

  on('loaderMenu', 'click', (e) => {
    const item = e.target?.closest?.('[data-value]');
    if (!item) return;
    const v = String(item.dataset.value || 'vanilla');
    sel.value = v;
    // Fire change so the rest of UI reacts + persists setting
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    syncLoaderDropdown();
    close();
  });

  // Close when clicking outside
  document.addEventListener('pointerdown', (e) => {
    if (menu.classList.contains('hidden')) return;
    if (wrap.contains(e.target)) return;
    close();
  }, { passive: true });

  // Escape closes
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Keep in sync when select changes programmatically
  on('loaderMode', 'change', () => syncLoaderDropdown());

  syncLoaderDropdown();
}

// Lightweight animated background (stars + drifting planets)
function initFX() {
  const canvas = document.getElementById('fx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  let w = 0, h = 0;

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const stars = [];
  const planets = [];
  const nebulae = [];
  const comets = [];
  const ships = [];
  const lasers = [];
  const petals = [];

  let lastT = performance.now();
  let logoPhase = 0;

  function resize() {
    w = Math.floor(window.innerWidth);
    h = Math.floor(window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeStars() {
    stars.length = 0;
    const count = reduceMotion ? 150 : 320;
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rand(0.4, 1.6),
        a: rand(0.15, 0.75),
        tw: rand(0.6, 1.8),
        ph: rand(0, Math.PI * 2),
        sp: rand(0.002, 0.015),
      });
    }
  }

  function makePlanets() {
    planets.length = 0;
    // Clearly visible "floating planets" (incl. a couple of big ones).
    const n = 5;
    for (let i = 0; i < n; i++) {
      planets.push({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(8, 22),
        vx: rand(-0.010, 0.010),
        vy: rand(-0.007, 0.007),
        ring: Math.random() < 0.55,
        hue: rand(160, 320),
        ph: rand(0, Math.PI * 2),
      });
    }
  }

  function makeNebulae() {
    nebulae.length = 0;
    const n = reduceMotion ? 3 : 6;
    for (let i = 0; i < n; i++) {
      nebulae.push({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(180, 360),
        hue: rand(185, 285),
        vx: rand(-0.003, 0.003),
        vy: rand(-0.002, 0.002),
        a: rand(0.06, 0.16),
        ph: rand(0, Math.PI * 2),
      });
    }
  }

  function makeComets() {
    comets.length = 0;
    if (reduceMotion) return;
    const n = 2;
    for (let i = 0; i < n; i++) {
      comets.push({
        x: rand(-w, w),
        y: rand(0, h),
        vx: rand(0.2, 0.45),
        vy: rand(-0.08, 0.08),
        len: rand(70, 140),
        ttl: rand(3500, 7000)
      });
    }
  }

  function makeShips() {
    ships.length = 0;
    if (reduceMotion) return;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 'L' : 'R';
      ships.push({
        team: i % 2,
        x: side === 'L' ? rand(-120, -20) : rand(w + 20, w + 120),
        y: rand(80, h - 80),
        vx: side === 'L' ? rand(0.05, 0.12) : rand(-0.12, -0.05),
        vy: rand(-0.02, 0.02),
        s: rand(0.8, 1.25),
        cd: rand(400, 1400),
      });
    }
  }

  function makePetals() {
    petals.length = 0;
    const n = reduceMotion ? 14 : 34;
    for (let i = 0; i < n; i++) {
      petals.push({
        x: rand(-40, w + 40),
        y: rand(-h, h),
        vx: rand(-0.03, 0.07),
        vy: rand(0.03, 0.12),
        s: rand(0.7, 1.5),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.003, 0.003),
        wob: rand(0.4, 1.2),
        ph: rand(0, Math.PI * 2),
        a: rand(0.45, 0.85),
      });
    }
  }

  function respawnShip(sh) {
    const side = sh.vx > 0 ? 'L' : 'R';
    sh.x = side === 'L' ? rand(-140, -40) : rand(w + 40, w + 140);
    sh.y = rand(80, h - 80);
    sh.vy = rand(-0.02, 0.02);
    sh.cd = rand(400, 1400);
  }

  function fireLaser(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = 0.65;
    lasers.push({
      x: from.x,
      y: from.y,
      vx: (dx / len) * sp,
      vy: (dy / len) * sp,
      ttl: 900,
      team: from.team,
    });
  }

  function drawStar(s, t) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t * 0.001) * s.tw + s.ph));
    ctx.globalAlpha = clamp(s.a * tw, 0.05, 0.95);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlanet(p, t) {
    ctx.save();

    // Base sphere
    const g = ctx.createRadialGradient(
      p.x - p.r * 0.36,
      p.y - p.r * 0.34,
      p.r * 0.14,
      p.x,
      p.y,
      p.r
    );
    g.addColorStop(0, `hsla(${p.hue}, 78%, 74%, .56)`);
    g.addColorStop(0.45, `hsla(${p.hue + 8}, 64%, 50%, .34)`);
    g.addColorStop(1, `hsla(${p.hue + 14}, 56%, 26%, .18)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    // Planet texture (bands + craters), clipped inside sphere
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.clip();

    const phase = p.ph + t * 0.00009;
    for (let i = -3; i <= 4; i++) {
      const y = p.y + i * (p.r * 0.22) + Math.sin(phase + i) * p.r * 0.05;
      const band = ctx.createLinearGradient(p.x - p.r, y, p.x + p.r, y + p.r * 0.08);
      band.addColorStop(0, `hsla(${p.hue + i * 3}, 68%, 58%, .10)`);
      band.addColorStop(0.5, `hsla(${p.hue + i * 2}, 72%, 64%, .16)`);
      band.addColorStop(1, `hsla(${p.hue + i * 3}, 65%, 54%, .08)`);
      ctx.fillStyle = band;
      ctx.fillRect(p.x - p.r, y - p.r * 0.07, p.r * 2, p.r * 0.14);
    }

    const craterCount = Math.max(3, Math.floor(p.r / 18));
    for (let i = 0; i < craterCount; i++) {
      const a = (i / craterCount) * Math.PI * 2 + phase * 0.7;
      const rr = p.r * (0.22 + (i % 5) * 0.12);
      const cx = p.x + Math.cos(a) * rr * 0.58;
      const cy = p.y + Math.sin(a * 1.3) * rr * 0.45;
      const cr = p.r * (0.045 + (i % 3) * 0.02);
      ctx.fillStyle = `hsla(${p.hue - 10}, 36%, 20%, .14)`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr * 1.25, cr, a * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Terminator (night side shadow)
    const term = ctx.createLinearGradient(p.x - p.r, p.y, p.x + p.r, p.y);
    term.addColorStop(0, 'rgba(0,0,0,.34)');
    term.addColorStop(0.45, 'rgba(0,0,0,.08)');
    term.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = term;
    ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);

    ctx.restore();

    // Atmospheric rim glow
    ctx.save();
    ctx.strokeStyle = `hsla(${p.hue + 10}, 80%, 78%, .14)`;
    ctx.lineWidth = Math.max(1, p.r * 0.03);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.01, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (p.ring) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(p.ph + t * 0.00022) * 0.34);
      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = `hsla(${p.hue + 6}, 72%, 82%, .52)`;
      ctx.lineWidth = Math.max(1.4, p.r * 0.03);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.32, p.r * 0.52, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = `hsla(${p.hue + 12}, 78%, 90%, .62)`;
      ctx.lineWidth = Math.max(1, p.r * 0.015);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.42, p.r * 0.56, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawNebula(n, t) {
    const pulse = 0.85 + Math.sin(t * 0.00025 + n.ph) * 0.15;
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
    g.addColorStop(0, `hsla(${n.hue}, 85%, 70%, ${n.a * 0.9 * pulse})`);
    g.addColorStop(0.5, `hsla(${n.hue + 20}, 78%, 56%, ${n.a * 0.42 * pulse})`);
    g.addColorStop(1, `hsla(${n.hue + 35}, 72%, 34%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawComet(c) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    const g = ctx.createLinearGradient(c.x, c.y, c.x - c.len, c.y - c.vy * 45);
    g.addColorStop(0, 'rgba(178,230,255,.95)');
    g.addColorStop(1, 'rgba(178,230,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x - c.len, c.y - c.vy * 45);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPetal(p, t) {
    const wobble = Math.sin(t * 0.0012 * p.wob + p.ph) * 6;
    ctx.save();
    ctx.translate(p.x + wobble, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.s, p.s);
    ctx.globalAlpha = p.a;

    const g = ctx.createRadialGradient(-1.2, -1.6, 0.2, 0, 0, 8);
    g.addColorStop(0, 'rgba(255,215,236,.95)');
    g.addColorStop(0.55, 'rgba(255,174,214,.82)');
    g.addColorStop(1, 'rgba(255,132,194,.66)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.bezierCurveTo(4.8, -7.2, 6.6, -2.2, 5.2, 1.2);
    ctx.bezierCurveTo(4, 4.2, 1.8, 6.5, 0, 7.4);
    ctx.bezierCurveTo(-1.8, 6.5, -4, 4.2, -5.2, 1.2);
    ctx.bezierCurveTo(-6.6, -2.2, -4.8, -7.2, 0, -7);
    ctx.fill();

    ctx.globalAlpha = p.a * 0.35;
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.ellipse(-1.2, -2.2, 1.2, 2.2, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawShip(sh) {
    ctx.save();
    ctx.translate(sh.x, sh.y);
    const dir = sh.vx >= 0 ? 1 : -1;
    ctx.scale(dir * sh.s, sh.s);

    // hull gradient for quality look
    const hull = ctx.createLinearGradient(-28, -8, 28, 8);
    hull.addColorStop(0, sh.team ? 'rgba(160,220,255,.22)' : 'rgba(210,180,255,.20)');
    hull.addColorStop(0.5, 'rgba(250,252,255,.34)');
    hull.addColorStop(1, 'rgba(60,76,120,.20)');

    ctx.globalAlpha = 0.96;
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.quadraticCurveTo(2, -10.5, -22, -6.2);
    ctx.lineTo(-29, -2.8);
    ctx.lineTo(-29, 2.8);
    ctx.quadraticCurveTo(-22, 6.2, 2, 10.5);
    ctx.quadraticCurveTo(14, 8.4, 28, 0);
    ctx.fill();

    // winglets
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = 'rgba(235,245,255,.16)';
    ctx.beginPath();
    ctx.moveTo(4, -3); ctx.lineTo(-6, -11); ctx.lineTo(-2, -2); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, 3); ctx.lineTo(-6, 11); ctx.lineTo(-2, 2); ctx.closePath();
    ctx.fill();

    // cockpit glass
    const cockpit = ctx.createLinearGradient(0, -4, 12, 4);
    cockpit.addColorStop(0, 'rgba(190,236,255,.55)');
    cockpit.addColorStop(1, 'rgba(140,190,255,.20)');
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = cockpit;
    ctx.beginPath();
    ctx.ellipse(7.5, 0, 7.8, 3.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // engine core + trail
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = sh.team ? 'rgba(120,240,255,.92)' : 'rgba(190,145,255,.92)';
    ctx.beginPath();
    ctx.ellipse(-25.2, 0, 5.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.34;
    const tr = ctx.createLinearGradient(-25, 0, -43, 0);
    tr.addColorStop(0, sh.team ? 'rgba(120,240,255,.78)' : 'rgba(190,145,255,.74)');
    tr.addColorStop(1, 'rgba(120,240,255,0)');
    ctx.fillStyle = tr;
    ctx.beginPath();
    ctx.moveTo(-25, -2.2);
    ctx.lineTo(-43, -0.8);
    ctx.lineTo(-43, 0.8);
    ctx.lineTo(-25, 2.2);
    ctx.closePath();
    ctx.fill();

    // subtle stroke detail
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-8, -1.8); ctx.lineTo(20, -1.2);
    ctx.moveTo(-8, 1.8); ctx.lineTo(20, 1.2);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawLaser(lz) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = lz.team ? 'rgba(0,235,255,.75)' : 'rgba(140,70,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lz.x, lz.y);
    ctx.lineTo(lz.x - lz.vx * 18, lz.y - lz.vy * 18);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawLogo() {
    const x = w * 0.06;
    const y = h * 0.12 + Math.sin(logoPhase) * 10;
    ctx.save();
    ctx.font = '700 44px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,255,200,.35)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillText('NocLauncher', x + 2, y + 2);
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(0,255,200,.18)';
    ctx.fillText('NocLauncher', x, y);
    ctx.restore();
  }

  function step(dt, t) {
    // stars drift slightly
    for (const s of stars) {
      s.x += s.sp * dt;
      if (s.x > w + 6) s.x = -6;
    }

    for (const p of planets) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ph += dt * 0.00015;
      if (p.x < -p.r - 120) p.x = w + p.r + 120;
      if (p.x > w + p.r + 120) p.x = -p.r - 120;
      if (p.y < -p.r - 120) p.y = h + p.r + 120;
      if (p.y > h + p.r + 120) p.y = -p.r - 120;
    }

    for (const n of nebulae) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -n.r) n.x = w + n.r;
      if (n.x > w + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = h + n.r;
      if (n.y > h + n.r) n.y = -n.r;
    }

    for (const p of petals) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + 24) {
        p.y = rand(-120, -20);
        p.x = rand(-40, w + 40);
      }
      if (p.x < -60) p.x = w + 50;
      if (p.x > w + 60) p.x = -50;
    }

    if (!reduceMotion) {
      // ships movement + occasional firing
      for (const sh of ships) {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        if (sh.y < 70 || sh.y > h - 70) sh.vy *= -1;

        sh.cd -= dt;
        if (sh.cd <= 0) {
          const targets = ships.filter(x => x.team !== sh.team);
          const target = targets[Math.floor(Math.random() * targets.length)];
          if (target) fireLaser(sh, target);
          sh.cd = rand(450, 1400);
        }

        if (sh.x < -220 || sh.x > w + 220) respawnShip(sh);
      }

      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.ttl -= dt;
        if (c.ttl <= 0 || c.x > w + 220 || c.y < -120 || c.y > h + 120) {
          comets[i] = {
            x: rand(-220, -30),
            y: rand(0, h),
            vx: rand(0.2, 0.45),
            vy: rand(-0.08, 0.08),
            len: rand(70, 140),
            ttl: rand(3500, 7000)
          };
        }
      }

      for (let i = lasers.length - 1; i >= 0; i--) {
        const lz = lasers[i];
        lz.x += lz.vx * dt;
        lz.y += lz.vy * dt;
        lz.ttl -= dt;
        if (lz.ttl <= 0 || lz.x < -260 || lz.x > w + 260 || lz.y < -160 || lz.y > h + 160) lasers.splice(i, 1);
      }
    }

    logoPhase += dt * 0.0016;
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);

    // stars first
    for (const s of stars) drawStar(s, t);

    // deep-space fog
    for (const n of nebulae) drawNebula(n, t);

    // planets
    for (const p of planets) drawPlanet(p, t);

    // sakura leaves
    for (const p of petals) drawPetal(p, t);

    // comets + battle
    for (const c of comets) drawComet(c);
    for (const lz of lasers) drawLaser(lz);
    for (const sh of ships) drawShip(sh);

    // logo removed by request (clean space background)
  }

  function frame(t) {
    if (canvas.dataset.fxStop === '1') return;

    const dt = clamp(t - lastT, 0, 50);
    lastT = t;

    step(dt, t);
    draw(t);

    requestAnimationFrame(frame);
  }

  resize();
  makeStars();
  makePlanets();
  makeNebulae();
  makeComets();
  makeShips();
  makePetals();
  window.addEventListener('resize', () => {
    resize();
    makeStars();
    makePlanets();
    makeNebulae();
    makeComets();
    makeShips();
    makePetals();
  });

  requestAnimationFrame(frame);
}



const state = {
  settings: null,
  manifest: null,
  running: false,
  msPending: null,
  versionsView: 'online', // online | installed
  installedProfilesCache: null,
  versionsLimit: 220,
  installed: false,
  resolvedVersion: null,
  lastLogPath: null,
  lastLogDir: null,
  mode: 'java', // java | bedrock
  bedrock: { supported: true, installed: false, checking: false },
  bedrockDemoSelected: '1.21.62',
  bedrockDemoVersions: [
    { id: '1.21.114.1', channel: 'release' },
    { id: '1.21.113.1', channel: 'release' },
    { id: '1.21.111.1', channel: 'release' },
    { id: '1.21.101.1', channel: 'release' },
    { id: '1.21.100.6', channel: 'release' },
    { id: '1.21.94.1', channel: 'release' },
    { id: '1.21.93.1', channel: 'release' },
    { id: '1.21.92.1', channel: 'release' },
    { id: '1.21.90.3', channel: 'release' }
  ],
  bedrockCheckToken: 0,
  bedrockOptions: [],
  bedrockUsefulOnly: false,
  bedrockTreatments: [],
  profiles: [],
  loaderInstalled: false,
  resolvedLoaderProfile: null,
  libraryTab: 'mods', // mods | resourcepacks | shaderpacks
  pendingLaunchWatchdog: null,
  lastMcEventTs: 0,
  timeline: [],
  authLog: [],
  lastServerSyncTs: 0,
  cachedServerSyncOk: false,
  fxStarted: false,
  localServersRoomId: null,
  localServersHeartbeatTimer: null
};

function setStatus(t) {
  $('#status').textContent = t;
  $('#footMeta').textContent = t;
}

function authDiag(msg, err = null) {
  const ts = new Date().toLocaleTimeString('ru-RU');
  const line = `[${ts}] ${msg}${err ? `\n${String(err?.message || err)}` : ''}`;
  state.authLog.push(line);
  if (state.authLog.length > 120) state.authLog = state.authLog.slice(-120);
  const box = document.getElementById('authLog');
  if (box) {
    box.value = state.authLog.join('\n\n');
    box.scrollTop = box.scrollHeight;
  }
  const hint = document.getElementById('authHint');
  if (hint) hint.textContent = msg;
  openModal('modalAuth');
    startAuthStatusPoll();
}

function addTimeline(text, type = 'info') {
  const ts = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  state.timeline.unshift({ ts, text: String(text || ''), type });
  if (state.timeline.length > 8) state.timeline = state.timeline.slice(0, 8);
  const wrap = $('#timeline');
  if (!wrap) return;
  wrap.innerHTML = state.timeline
    .map((i) => `<div class="timelineItem"><b>${i.ts}</b> — ${i.text}</div>`)
    .join('');
}

function setHealthItem(id, text, mode = 'warn') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('ok', 'bad', 'warn');
  el.classList.add(mode);
}

function applyPerformanceMode() {
  const lowPower = !!state.settings?.uiLowPower;
  document.body.classList.toggle('low-power', lowPower);
  const fx = document.getElementById('fx');
  if (!fx) return;

  if (lowPower) {
    fx.dataset.fxStop = '1';
    fx.style.display = 'none';
    state.fxStarted = false;
  } else {
    fx.dataset.fxStop = '0';
    fx.style.display = '';
  }
}

async function refreshHealthPanelLive() {
  const username = ($('#username')?.value || state.settings?.lastUsername || 'Player').trim();
  const memMin = Number($('#memMin')?.value || state.settings?.memoryMinMB || 1024);
  const memMax = Number($('#memMax')?.value || state.settings?.memoryMaxMB || 4096);
  const loaderMode = $('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla';

  setHealthItem('healthNick', `• Ник: ${username || '—'}`, username ? 'ok' : 'bad');
  setHealthItem('healthMemory', `• Память: ${memMax} MB (min ${memMin})`, memMax >= memMin ? 'ok' : 'bad');

  const nowTs = Date.now();
  const needSync = (nowTs - (state.lastServerSyncTs || 0)) > 120000; // once per 2 min
  if (needSync) {
    try {
      await window.noc.syncJavaServers();
      state.cachedServerSyncOk = true;
    } catch {
      state.cachedServerSyncOk = false;
    }
    state.lastServerSyncTs = nowTs;
  }
  setHealthItem('healthServers',
    state.cachedServerSyncOk ? '• Серверы: noctraze.my-craft.cc. (OK)' : '• Серверы: sync ошибка',
    state.cachedServerSyncOk ? 'ok' : 'bad');

  if (loaderMode === 'optifine') {
    setHealthItem('healthLoader', '• Лоадер: OptiFine (рабочий)', 'ok');
  } else if (loaderMode === 'forge') {
    setHealthItem('healthLoader', '• Лоадер: Forge (рабочий)', 'ok');
  } else {
    setHealthItem('healthLoader', '• Лоадер: Vanilla (рабочий)', 'ok');
  }
}

async function runLaunchHealthCheck(username, requested, loaderMode) {
  const checks = [];
  checks.push({ key: 'healthNick', ok: !!username, text: username ? '• Ник: заполнен' : '• Ник: не указан' });

  const memMin = Number($('#memMin')?.value || 1024);
  const memMax = Number($('#memMax')?.value || 4096);
  checks.push({ key: 'healthMemory', ok: memMax >= memMin, text: memMax >= memMin ? `• Память: ${memMin}/${memMax} MB` : `• Память: ошибка (${memMin}/${memMax})` });

  try {
    await window.noc.syncJavaServers();
    checks.push({ key: 'healthServers', ok: true, text: '• Серверы: синхронизированы' });
  } catch {
    checks.push({ key: 'healthServers', ok: false, text: '• Серверы: ошибка синхронизации' });
  }

  if (loaderMode === 'optifine') {
    try {
      const baseVersion = normalizeBaseVersion(requested);
      const r = await window.noc.optiFineVersions(baseVersion);
      const hasAny = !!(r?.ok && Array.isArray(r.builds) && r.builds.length);
      const hasStable = !!(r?.ok && Array.isArray(r.builds) && r.builds.some(b => !/pre/i.test(String(b.patch || ''))));
      checks.push({
        key: 'healthLoader',
        ok: hasAny,
        text: hasStable ? '• Лоадер: OptiFine stable OK' : (hasAny ? '• Лоадер: только pre (возможны баги)' : '• Лоадер: OptiFine не найден')
      });
    } catch {
      checks.push({ key: 'healthLoader', ok: false, text: '• Лоадер: проверка OptiFine не удалась' });
    }
  } else if (loaderMode === 'fabric') {
    try {
      const baseVersion = normalizeBaseVersion(requested);
      const r = await window.noc.fabricVersions(baseVersion);
      const hasAny = !!(r?.ok && Array.isArray(r.loaders) && r.loaders.length);
      const hasStable = !!(r?.ok && Array.isArray(r.loaders) && r.loaders.some(l => l?.stable));
      checks.push({
        key: 'healthLoader',
        ok: hasAny,
        text: hasStable ? '• Лоадер: Fabric stable OK' : (hasAny ? '• Лоадер: Fabric dev/unstable (возможны баги)' : '• Лоадер: Fabric не найден для этой версии')
      });
    } catch {
      checks.push({ key: 'healthLoader', ok: false, text: '• Лоадер: проверка Fabric не удалась' });
    }
  } else if (loaderMode === 'neoforge') {
    try {
      const baseVersion = normalizeBaseVersion(requested);
      const r = await window.noc.neoforgeVersions(baseVersion, true);
      const hasAny = !!(r?.ok && Array.isArray(r.builds) && r.builds.length);
      const hasStable = !!(r?.ok && Array.isArray(r.builds) && r.builds.some(v => !/beta/i.test(String(v))));
      checks.push({
        key: 'healthLoader',
        ok: hasAny,
        text: hasStable ? '• Лоадер: NeoForge stable OK' : (hasAny ? '• Лоадер: NeoForge только beta (возможны баги)' : '• Лоадер: NeoForge не найден для этой версии')
      });
    } catch {
      checks.push({ key: 'healthLoader', ok: false, text: '• Лоадер: проверка NeoForge не удалась' });
    }
  } else {
    checks.push({ key: 'healthLoader', ok: true, text: `• Лоадер: ${loaderMode}` });
  }

  const failed = checks.filter(c => !c.ok);
  checks.forEach(c => {
    addTimeline(`${c.ok ? '✅' : '❌'} ${c.text.replace(/^•\s*/, '')}`, c.ok ? 'ok' : 'bad');
    setHealthItem(c.key, c.text, c.ok ? 'ok' : 'bad');
  });
  return { ok: failed.length === 0, failed };
}

function shortVer(s, n = 28) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function setPickedVersionText() {
  const v = state.settings?.lastVersion || 'latest-release';
  const loader = $('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla';
  const el = $('#pickedVersion');
  if (!el) return;

  const heroVer = $('#pickedVersionHero');
  const heroLoader = $('#loaderHero');

  const loaderLabel =
    loader === 'vanilla' ? 'Vanilla' :
    loader === 'fabric' ? 'Fabric' :
    loader === 'forge' ? 'Forge' :
    loader === 'neoforge' ? 'NeoForge' :
    loader === 'optifine' ? 'OptiFine' :
    String(loader || '—');

  if (heroLoader) heroLoader.textContent = loaderLabel;

  let display = '';
  let fullTitle = '';

  if (loader === 'fabric' && state.settings?.selectedFabricLoader) {
    fullTitle = `${v} • Fabric ${state.settings.selectedFabricLoader}`;
    display = shortVer(fullTitle, 34);
  } else if (loader === 'forge' && state.settings?.selectedForgeBuild) {
    fullTitle = `${v} • Forge ${state.settings.selectedForgeBuild}`;
    display = shortVer(fullTitle, 34);
  } else if (loader === 'neoforge' && state.settings?.selectedNeoForgeVersion) {
    fullTitle = `${v} • NeoForge ${state.settings.selectedNeoForgeVersion}`;
    display = shortVer(fullTitle, 34);
  } else if (loader === 'optifine' && state.settings?.selectedOptiFineBuild?.patch) {
    const b = state.settings.selectedOptiFineBuild;
    fullTitle = `${v} • OptiFine ${b.type || ''} ${b.patch || ''}`.trim();
    display = shortVer(fullTitle, 34);
  } else {
    fullTitle = v;
    display = shortVer(v, 34);
  }

  el.textContent = display;
  el.title = fullTitle;

  // Mirror to hero for the redesigned UI
  if (heroVer) {
    heroVer.textContent = display;
    heroVer.title = fullTitle;
  }
}

function showDlBox(show) {
  $('#dlBox')?.classList.toggle('hidden', !show);
}

function resetProgress() {
  const bar = $('#dlBar');
  const text = $('#dlText');
  const pct = $('#dlPct');
  if (bar) bar.style.width = '0%';
  if (text) text.textContent = '—';
  if (pct) pct.textContent = '0%';
}

function setActionLabel(t) {
  const el = $('#actionLabel');
  if (el) el.textContent = t;
}

function normalizeBaseVersion(v) {
  // Keep renderer logic consistent with main.js normalizeBaseMcVersion:
  // we want the *Minecraft* base version, not the loader version.
  const raw = String(v || '').trim();
  const s = raw.replace(/-nocflat$/i, '');

  // Fabric: fabric-loader-<loaderVersion>-<mcVersion>
  let m = s.match(/^fabric-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return m[1];

  // Quilt: quilt-loader-<loaderVersion>-<mcVersion>
  m = s.match(/^quilt-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return m[1];

  // Forge: usually starts with mcVersion
  m = s.match(/^(\d+\.\d+(?:\.\d+)?)/);
  if (m) return m[1];

  // Fallback: use the LAST mc-like token if present
  const all = [...s.matchAll(/(\d+\.\d+(?:\.\d+)?)/g)].map(x => x[1]);
  if (all.length) return all[all.length - 1];

  return s;
}

function resolvePseudoBase(base) {
  // For UI comparisons (installed profiles), resolve latest-* to concrete ids.
  const b = String(base || '').trim();
  if (b === 'latest-release') {
    const rel = (state?.versions || []).filter(v => v?.type === 'release');
    rel.sort((a,b)=> new Date(b.releaseTime||0) - new Date(a.releaseTime||0));
    return rel[0]?.id || b;
  }
  if (b === 'latest-snapshot') {
    const sn = (state?.versions || []).filter(v => v?.type === 'snapshot');
    sn.sort((a,b)=> new Date(b.releaseTime||0) - new Date(a.releaseTime||0));
    return sn[0]?.id || b;
  }
  return b;
}

function getSelectedBaseVersion() {
  const requested = $('#versionSelect')?.value || state.settings?.lastVersion || 'latest-release';
  return normalizeBaseVersion(requested);
}

function findInstalledLoaderProfile(loaderMode, requested, profiles) {
  const base = resolvePseudoBase(normalizeBaseVersion(requested));
  const list = Array.isArray(profiles) ? profiles : [];
  const byBase = (p) => normalizeBaseVersion(p?.baseVersion || '') === base;

  if (loaderMode === 'fabric') {
    return list.find(p => p.kind === 'fabric' && byBase(p)) || list.find(p => p.kind === 'fabric' && String(p.id).includes(base)) || null;
  }
  if (loaderMode === 'forge') {
    return list.find(p => p.kind === 'forge' && byBase(p)) || list.find(p => p.kind === 'forge' && String(p.id).includes(base)) || null;
  }
  if (loaderMode === 'neoforge') {
    return list.find(p => p.kind === 'neoforge' && byBase(p)) || list.find(p => p.kind === 'neoforge') || null;
  }
  if (loaderMode === 'optifine') {
    const matches = list.filter(p => p.kind === 'optifine' && (byBase(p) || String(p.id).includes(base)));
    const stable = matches.find(p => !String(p.id).toLowerCase().includes('_pre'));
    return stable || matches[0] || null;
  }
  return null;
}

async function refreshInstallState() {
  if (state.mode !== 'java') return;
  try {
    const requested = $('#versionSelect')?.value || state.settings?.lastVersion || 'latest-release';
    const loaderMode = $('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla';

    if (loaderMode === 'vanilla') {
      const info = await window.noc.isInstalled(requested);
      state.installed = !!info?.installed;
      state.resolvedVersion = info?.version || null;
      state.loaderInstalled = state.installed;
      state.resolvedLoaderProfile = state.resolvedVersion;
    } else {
      const profResp = await window.noc.listInstalledProfiles();
      const profiles = (profResp?.ok && Array.isArray(profResp.profiles)) ? profResp.profiles : [];
      const found = findInstalledLoaderProfile(loaderMode, requested, profiles);
      state.loaderInstalled = !!found;
      state.resolvedLoaderProfile = found?.id || null;
      state.installed = !!found;
      state.resolvedVersion = found?.id || normalizeBaseVersion(requested);
    }
  } catch {
    state.installed = false;
    state.resolvedVersion = null;
    state.loaderInstalled = false;
    state.resolvedLoaderProfile = null;
  }
  updateActionButton();
}

function updateActionButton() {
  const btn = $('#btnPlay');
  if (!btn) return;

  if (state.mode === 'bedrock') {
    btn.classList.add('hidden');
    $('#btnBedrockAction')?.classList.remove('hidden');
    return;
  }

  btn.classList.remove('hidden');
  $('#btnBedrockAction')?.classList.add('hidden');

  // Microsoft авторизацию временно убрали из UI: играем/ставим как оффлайн.
  const wantOnline = false;
  const hasAccount = false;
  const username = ($('#username')?.value || '').trim();

  const loaderMode = $('#loaderMode')?.value || 'vanilla';
  // Minimal launcher-like labels: one "Установить" / "Играть" without extra words.
  let label = state.installed ? 'Играть' : 'Установить';
  // If a loader is selected but not installed yet, we still show "Установить".
  if (loaderMode === 'forge' || loaderMode === 'neoforge' || loaderMode === 'fabric' || loaderMode === 'optifine') {
    label = state.loaderInstalled ? 'Играть' : 'Установить';
  }
  // (UI авторизации скрыт)
  setActionLabel(label);

  const disabled = state.running || !username;
  btn.disabled = disabled;
}

function logLine(type, msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${String(type || 'info').toUpperCase()}: ${String(msg || '')}\n`;
  const box = $('#logbox');
  if (!box) return;
  box.textContent += line;
  box.scrollTop = box.scrollHeight;
}

function fmtAcc() {
  const acc = state.settings?.account;
  if (!acc) return 'ПИРАТКА';
  return `ЛИЦЕНЗИЯ:${acc.name}`;
}

function applyMini() {
  const d = $('#miniDir');
  const v = $('#miniVer');
  const a = $('#miniAcc');
  if (d) d.textContent = state.settings?.gameDir || '—';
  if (v) v.textContent = state.settings?.lastVersion || '—';
  if (a) a.textContent = fmtAcc();
}

function setRunning(on) {
  state.running = on;
  const play = $('#btnPlay');
  const stop = $('#btnStop');
  if (play) play.disabled = on;
  if (stop) {
    stop.disabled = !on;
    stop.classList.toggle('hidden', !on);
  }
  if (!on && state.pendingLaunchWatchdog) {
    clearTimeout(state.pendingLaunchWatchdog);
    state.pendingLaunchWatchdog = null;
  }
}

async function loadSettings() {
  state.settings = await window.noc.settingsGet();

  // Supported loaders in this UI.
  const allowedLoaders = new Set(['vanilla', 'forge', 'optifine']);
  if (!allowedLoaders.has(state.settings.loaderMode)) {
    state.settings.loaderMode = 'vanilla';
    try {
      await window.noc.settingsSet({ loaderMode: 'vanilla' });
    } catch {}
  }

  if ($('#gameDir')) $('#gameDir').value = state.settings.gameDir || '';
  if ($('#javaPath')) $('#javaPath').value = state.settings.javaPath || '';
  if ($('#offlineSkinPath')) $('#offlineSkinPath').value = state.settings.offlineSkinPath || '';
  if ($('#skinMode')) $('#skinMode').value = state.settings.skinMode || 'auto';
  if ($('#skinNick')) $('#skinNick').value = state.settings.skinNick || '';
  if ($('#skinUrl')) $('#skinUrl').value = state.settings.skinUrl || '';
  applySkinSettingsView();
  if ($('#memMin')) $('#memMin').value = state.settings.memoryMinMB || 1024;
  if ($('#memMax')) $('#memMax').value = state.settings.memoryMaxMB || 4096;
  if ($('#downloadMode')) $('#downloadMode').value = state.settings.downloadMode || 'fast';
  if ($('#downloadParallel')) $('#downloadParallel').value = state.settings.downloadParallel ?? 0;
  if ($('#downloadMaxKBps')) $('#downloadMaxKBps').value = state.settings.downloadMaxKBps ?? 0;
  if ($('#downloadSource')) $('#downloadSource').value = state.settings.downloadSource || 'auto';
  if ($('#curseforgeApiKey')) $('#curseforgeApiKey').value = state.settings.curseforgeApiKey || '';
  if ($('#jvmPreset')) $('#jvmPreset').value = state.settings.jvmPreset || 'auto';
  if ($('#safeLaunchNoMods')) $('#safeLaunchNoMods').checked = !!state.settings.safeLaunchNoMods;
  if ($('#uiLowPower')) $('#uiLowPower').checked = !!state.settings.uiLowPower;
  if ($('#closeLauncherOnGameStart')) $('#closeLauncherOnGameStart').checked = state.settings.closeLauncherOnGameStart !== false;
  if ($('#mirrorFallback')) $('#mirrorFallback').checked = state.settings.enableMirrorFallback !== false;
  if ($('#bedrockDemoMode')) $('#bedrockDemoMode').checked = !!state.settings.bedrockDemoMode;
  if ($('#fpsBoostMode')) $('#fpsBoostMode').checked = !!state.settings.fpsBoostMode;
  if ($('#fpsPreset')) $('#fpsPreset').value = state.settings.fpsPreset || 'safe';
  if ($('#loaderMode')) $('#loaderMode').value = state.settings.loaderMode || 'vanilla';
  try { syncLoaderDropdown(); } catch (_) {}

  applyPerformanceMode();

  const remember = true;
  const wantOnline = false;
  if ($('#remember')) $('#remember').checked = true;
  if ($('#onlineMode')) $('#onlineMode').checked = false;

  if ($('#username')) $('#username').value = (state.settings.lastUsername || 'Player');
  applyMini();
  applyAccountUI();
  setPickedVersionText();
  await refreshInstallState();
  await refreshHealthPanelLive();
}

function applyAccountUI() {
  // Microsoft UI скрыт: просто обновляем мини-инфо.
  applyMini();
}


function applySkinSettingsView() {
  const mode = $('#skinMode')?.value || 'auto';
  $('#skinRowFile')?.classList.toggle('hidden', !(mode === 'file' || mode === 'auto'));
  $('#skinRowNick')?.classList.toggle('hidden', !(mode === 'nick' || mode === 'auto'));
  $('#skinRowUrl')?.classList.toggle('hidden', mode !== 'url');
}

function fillVersionSelect() {
  const sel = $('#versionSelect');
  sel.innerHTML = '';

  const last = state.settings?.lastVersion || 'latest-release';
  const presets = [
    ['latest-release', 'latest-release (последний релиз)'],
    ['latest-snapshot', 'latest-snapshot (последний снапшот)']
  ];

  for (const [value, text] of presets) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }

  if (state.manifest?.versions?.length) {
    for (const v of state.manifest.versions) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = `${v.id} • ${v.type}`;
      sel.appendChild(o);
    }
  }

  sel.value = last;
}


async function refreshVersions() {
  // Fast path: use cached manifest from main (instant)
  try {
    const cached = await window.noc.versionsList({ kind: 'all', q: '' });
    if (cached?.ok && cached?.versions?.length) {
      state.manifest = { latest: cached.latest || {}, versions: cached.versions };
      state.versionsLimit = 220;
      fillVersionSelect();
      renderVersionsList();
    }
  } catch (_) {}

  // Slow path: refresh from network (with retries + keeps UI non-empty)
  setStatus('Загружаю список версий…');
  const tries = 3;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const mf = await window.noc.fetchVersions();
      if (mf?.versions?.length) {
        state.manifest = mf;
        state.versionsLimit = 220;
        fillVersionSelect();
        renderVersionsList();
        setStatus('Список версий обновлён');
        return;
      }
      lastErr = new Error('Пустой список версий');
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 900));
  }

  // Do not overwrite UI with "Готов" if versions failed
  setStatus('Версии не загрузились (проверь интернет/фаервол). Нажми ⟲.');
  logLine('error', lastErr?.message || lastErr);
}


async function chooseLoaderBuild(baseVersion) {
  const loader = $('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla';
  if (loader === 'vanilla') return null;

  if (loader === 'fabric') {
    const r = await window.noc.fabricVersions(baseVersion);
    if (!r?.ok || !Array.isArray(r.loaders) || !r.loaders.length) throw new Error(r?.error || 'Нет Fabric builds');
    const stable = r.loaders.filter(l => !!l?.stable).map(l => String(l.version));
    const all = r.loaders.map(l => String(l.version));
    const current = String(state.settings?.selectedFabricLoader || '');
    const pool = stable.length ? stable : all;
    const pick = pool.includes(current) ? current : pool[0];
    return { selectedFabricLoader: pick };
  }

  if (loader === 'neoforge') {
    const r = await window.noc.neoforgeVersions(baseVersion, true);
    if (!r?.ok || !Array.isArray(r.builds) || !r.builds.length) throw new Error(r?.error || 'Нет NeoForge builds');
    const stable = r.builds.filter(v => !/beta/i.test(String(v)));
    const pool = stable.length ? stable : r.builds;
    const current = String(state.settings?.selectedNeoForgeVersion || '');
    const pick = pool.includes(current) ? current : pool[0];
    return { selectedNeoForgeVersion: pick };
  }

  if (loader === 'forge') {
    const r = await window.noc.forgeVersions(baseVersion);
    if (!r?.ok || !r.builds?.length) throw new Error(r?.error || 'Нет Forge builds');
    const current = state.settings?.selectedForgeBuild || '';
    const pick = r.builds.includes(current) ? current : r.builds[0];
    return { selectedForgeBuild: pick };
  }

  const r = await window.noc.optiFineVersions(baseVersion);
  if (!r?.ok || !r.builds?.length) throw new Error(r?.error || 'Нет OptiFine builds');

  const stable = r.builds.filter(b => !/pre/i.test(String(b.patch || '')));
  const pool = stable.length ? stable : r.builds;

  const cur = state.settings?.selectedOptiFineBuild;
  const currentMatch = cur && pool.find(b => b.type === cur.type && b.patch === cur.patch);
  const pick = currentMatch || pool[0];
  return { selectedOptiFineBuild: { type: pick.type, patch: pick.patch, mcversion: pick.mcversion } };
}

function setVersionsView(view) {
  state.versionsView = view;
  $('#btnVersionsOnline')?.classList.toggle('active', view === 'online');
  $('#btnVersionsInstalled')?.classList.toggle('active', view === 'installed');
  // Hide online-only controls when showing local profiles
  $('#typeFilter')?.classList.toggle('hidden', view !== 'online');
  $('#versionSearch')?.classList.toggle('hidden', view !== 'online');
  $('#btnRefreshVersions')?.classList.toggle('hidden', view !== 'online');
  $('#btnMoreVersions')?.classList.toggle('hidden', view !== 'online');
}

async function getInstalledProfiles() {
  if (state.installedProfilesCache) return state.installedProfilesCache;
  const r = await window.noc.listInstalledProfiles();
  state.installedProfilesCache = (r?.ok && Array.isArray(r.profiles)) ? r.profiles : [];
  return state.installedProfilesCache;
}

async function renderInstalledProfilesList() {
  const wrap = $('#versionsList');
  wrap.innerHTML = '';
  const profiles = await getInstalledProfiles();
  if (!profiles.length) {
    wrap.textContent = 'Нет установленных версий в папке versions.';
    return;
  }
  const selectedNow = state.settings?.lastVersion || 'latest-release';
  for (const p of profiles) {
    const el = document.createElement('div');
    const isSelected = selectedNow === p.id;
    el.className = `item mcItem ${isSelected ? 'selected' : ''}`;
    const kindMap = { vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', optifine: 'OptiFine', fabric: 'Fabric' };
    const kind = kindMap[p.kind] || p.kind || '—';
    el.innerHTML = `
      <div class="mcItemLeft">
        <div class="mcVer mono">${p.id}</div>
        <div class="mcSub">Локально • ${kind}${p.baseVersion && p.baseVersion !== p.id ? ` • база ${p.baseVersion}` : ''}</div>
      </div>
      <div class="mcItemRight">
        <div class="badge mcBadge">Установлено</div>
        ${isSelected ? '<div class="mcSelected">Выбрано</div>' : `<button class="mcPickBtn" data-pick="${p.id}">Выбрать</button>`}
      </div>`;
    const pickBtn = el.querySelector('[data-pick]');
    if (pickBtn) {
      pickBtn.addEventListener('click', async () => {
        // When selecting an installed profile, map it back to (base version + loader)
        // so the main UI stays consistent.
        const patch = {};
        const kind = String(p.kind || 'vanilla');
        const base = p.baseVersion || p.id;

        if (kind === 'vanilla') {
          patch.loaderMode = 'vanilla';
          patch.lastVersion = p.id;
        } else if (kind === 'fabric') {
          patch.loaderMode = 'fabric';
          patch.lastVersion = base;
          const m = String(p.id).match(/^fabric-loader-([^-]+)-/i);
          if (m) patch.selectedFabricLoader = m[1];
        } else if (kind === 'forge') {
          patch.loaderMode = 'forge';
          patch.lastVersion = base;
          const m = String(p.id).toLowerCase().match(/forge-([0-9.]+(?:-[^\s]+)?)$/);
          if (m) patch.selectedForgeBuild = m[1];
        } else if (kind === 'neoforge') {
          patch.loaderMode = 'neoforge';
          patch.lastVersion = base;
          const m = String(p.id).toLowerCase().match(/neoforge-([0-9.]+(?:-[^\s]+)?)$/);
          if (m) patch.selectedNeoForgeVersion = m[1];
        } else if (kind === 'optifine') {
          patch.loaderMode = 'optifine';
          patch.lastVersion = base;
          // We'll auto-pick a stable OptiFine build for that base version later.
        } else {
          patch.lastVersion = base;
        }

        state.settings = await window.noc.settingsSet(patch);
        if ($('#versionSelect')) $('#versionSelect').value = state.settings.lastVersion || base;
        if ($('#loaderMode')) $('#loaderMode').value = state.settings.loaderMode || patch.loaderMode || 'vanilla';
        try { syncLoaderDropdown(); } catch (_) {}
        applyMini();
        setPickedVersionText();
        setStatus(`Выбрана установленная версия (${kind})`);
        closeModal('modalVersions');
        await refreshInstallState();
      });
    }
    wrap.appendChild(el);
  }
}

function renderVersionsList() {
  if (state.versionsView === 'installed') {
    renderInstalledProfilesList();
    return;
  }
  const wrap = $('#versionsList');
  wrap.innerHTML = '';
  if (!state.manifest?.versions?.length) {
    wrap.textContent = 'Версии не загружены.';
    return;
  }

  const quick = [
    { id: 'latest-release', type: 'release', quick: true, time: new Date().toISOString() },
    { id: 'latest-snapshot', type: 'snapshot', quick: true, time: new Date().toISOString() }
  ];

  const q = ($('#versionSearch').value || '').trim().toLowerCase();
  const filter = $('#typeFilter').value;

  const filtered = [...quick, ...state.manifest.versions].filter(v => {
    if (filter !== 'all' && v.type !== filter) return false;
    if (q && !v.id.toLowerCase().includes(q)) return false;
    return true;
  });

  const items = filtered.slice(0, state.versionsLimit);
  const selectedNow = state.settings?.lastVersion || 'latest-release';
  const loader = $('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla';

  for (const v of items) {
    const el = document.createElement('div');
    const isSelected = selectedNow === v.id;
    el.className = `item mcItem ${isSelected ? 'selected' : ''}`;

    const typeMap = {
      release: 'Релиз',
      snapshot: 'Снапшот',
      old_beta: 'Old Beta',
      old_alpha: 'Old Alpha'
    };
    const typeLabel = typeMap[v.type] || v.type;
    const sub = v.quick ? 'Быстрый выбор' : new Date(v.time).toLocaleString('ru-RU');

    el.innerHTML = `
      <div class="mcItemLeft">
        <div class="mcVer mono">${v.id}</div>
        <div class="mcSub">${sub}</div>
      </div>
      <div class="mcItemRight">
        <div class="badge mcBadge">${typeLabel}</div>
        ${isSelected ? '<div class="mcSelected">Выбрано</div>' : `<button class="mcPickBtn" data-pick="${v.id}">Выбрать</button>`}
      </div>`;

    const pickBtn = el.querySelector('[data-pick]');
    if (pickBtn) {
      pickBtn.addEventListener('click', async () => {
        $('#versionSelect').value = v.id;

        const patch = { lastVersion: v.id };
        try {
          Object.assign(patch, await chooseLoaderBuild(v.id));
        } catch (e) {
          // Не блокируем выбор версии: сохраняем версию даже если build пока не выбран.
          setStatus(`Версия выбрана, но build не подобран: ${e?.message || e}`);
        }

        state.settings = await window.noc.settingsSet(patch);
        applyMini();
        setPickedVersionText();
        setStatus(`Выбрана версия ${v.id}`);
        closeModal('modalVersions');
        await refreshInstallState();
      });
    }

    wrap.appendChild(el);
  }

  const hasMore = filtered.length > items.length;
  $('#btnMoreVersions')?.classList.toggle('hidden', !hasMore);
}

async function saveSettings() {
  const memMin = Math.max(512, Number($('#memMin').value || 1024));
  const memMax = Math.max(memMin, Number($('#memMax').value || 4096));

  const patch = {
    gameDir: $('#gameDir').value.trim(),
    javaPath: $('#javaPath').value.trim(),
    offlineSkinPath: $('#offlineSkinPath').value.trim(),
    skinMode: $('#skinMode').value || 'auto',
    skinNick: $('#skinNick').value.trim(),
    skinUrl: $('#skinUrl').value.trim(),
    memoryMinMB: memMin,
    memoryMaxMB: memMax,
    downloadMode: $('#downloadMode').value || 'fast',
    downloadParallel: Number($('#downloadParallel').value || 0),
    downloadMaxKBps: Number($('#downloadMaxKBps').value || 0),
    downloadSource: $('#downloadSource').value || 'auto',
    jvmPreset: $('#jvmPreset').value || 'auto',
    safeLaunchNoMods: !!$('#safeLaunchNoMods').checked,
    uiLowPower: !!$('#uiLowPower').checked,
    closeLauncherOnGameStart: !!$('#closeLauncherOnGameStart').checked,
    enableMirrorFallback: !!$('#mirrorFallback').checked,
    bedrockDemoMode: !!$('#bedrockDemoMode').checked,
    fpsBoostMode: !!$('#fpsBoostMode').checked,
    fpsPreset: $('#fpsPreset').value || 'safe',
    loaderMode: $('#loaderMode').value || 'vanilla',
    curseforgeApiKey: String($('#curseforgeApiKey')?.value || '').trim()
  };

  state.settings = await window.noc.settingsSet(patch);
  await window.noc.syncJavaServers();

  applyPerformanceMode();
  if (!patch.uiLowPower && !state.fxStarted) {
    try { initFX(); state.fxStarted = true; } catch {}
  }
  $('#memMin').value = memMin;
  $('#memMax').value = memMax;
  applyMini();
  addTimeline(`⚙ Настройки сохранены • FPS: ${patch.fpsBoostMode ? (patch.fpsPreset || 'safe') : 'off'}`);
  await refreshHealthPanelLive();
  setStatus('Настройки сохранены');
  closeModal('modalSettings');
}

async function ensureVanillaWithProgress(baseVersion, username) {
  resetProgress();
  showDlBox(true);
  setStatus(`Подготовка ваниллы ${baseVersion}...`);

  const res = await window.noc.launch({
    username,
    version: baseVersion,
    javaPath: $('#javaPath').value.trim(),
    memoryMinMB: Number($('#memMin').value || 1024),
    memoryMaxMB: Number($('#memMax').value || 4096),
    hideOnLaunch: false,
    prepareOnly: true
  });

  if (!res?.ok) throw new Error(res?.error || 'Не удалось подготовить ваниллу');
  setStatus(`Ванилла ${baseVersion} готова`);
}

async function doPlay() {
  try {
    const username = ($('#username').value || 'Player').trim();
    if (!username) return setStatus('Введи ник');

    const requested = $('#versionSelect').value;
    const remember = true;
    const wantOnline = false;
    const loaderMode = $('#loaderMode')?.value || 'vanilla';

    addTimeline(`🚀 Подготовка запуска ${requested} (${loaderMode})`);
    const hc = await runLaunchHealthCheck(username, requested, loaderMode);
    if (!hc.ok) {
      setStatus('Health-check не пройден. Исправь пункты в timeline ниже.');
      return;
    }
    addTimeline('✅ Launch Health: всё готово к старту');

    let loaderPatch = {};
    if (loaderMode !== 'vanilla') {
      loaderPatch = await chooseLoaderBuild(normalizeBaseVersion(requested));
    }

    state.settings = await window.noc.settingsSet({ rememberUsername: remember, preferOnline: false, loaderMode, ...loaderPatch });

    // Auto-skin by nickname for offline mode (optional)
    if (!wantOnline) {
      const skinMode = $('#skinMode')?.value || state.settings?.skinMode || 'auto';
      if (skinMode === 'auto' || skinMode === 'nick') {
        const nickForSkin = ($('#skinNick')?.value || username).trim();
        if (nickForSkin) {
          const rSkin = await window.noc.fetchSkinByNick(nickForSkin);
          if (rSkin?.ok && rSkin.path) {
            $('#offlineSkinPath').value = rSkin.path;
            state.settings = await window.noc.settingsSet({ offlineSkinPath: rSkin.path });
            addTimeline(`🎨 Скин найден: ${nickForSkin}`);
          }
        }
      }
    }

    // Microsoft авторизация временно отключена (UI скрыт).

    let chosen = requested;
    let alreadyInstalled = false;

    if (loaderMode === 'fabric') {
      await refreshInstallState();
      if (state.loaderInstalled && state.resolvedLoaderProfile) {
        const ex = await window.noc.profileExists(state.resolvedLoaderProfile);
        if (!ex?.exists) {
          const reinstall = window.confirm('Fabric профиль не найден в папке versions. Переустановить Fabric?');
          if (!reinstall) return;
          state.loaderInstalled = false;
          state.resolvedLoaderProfile = null;
        } else {
          chosen = state.resolvedLoaderProfile;
          alreadyInstalled = true;
        }
      }

      if (!alreadyInstalled) {
        const baseVersion = normalizeBaseVersion(requested);
        await ensureVanillaWithProgress(baseVersion, username);

        setStatus('Ставлю Fabric...');
        const fr = await window.noc.installFabric(baseVersion, state.settings?.selectedFabricLoader || '');
        if (!fr?.ok) {
          setStatus(`Fabric ошибка: ${fr?.error || 'unknown'}`);
          return;
        }
        chosen = fr.versionId;
        alreadyInstalled = true;
      }

    } else if (loaderMode === 'neoforge') {
      await refreshInstallState();
      if (state.loaderInstalled && state.resolvedLoaderProfile) {
        const ex = await window.noc.profileExists(state.resolvedLoaderProfile);
        if (!ex?.exists) {
          const reinstall = window.confirm('NeoForge профиль не найден в папке versions. Переустановить NeoForge?');
          if (!reinstall) return;
          state.loaderInstalled = false;
          state.resolvedLoaderProfile = null;
        } else {
          chosen = state.resolvedLoaderProfile;
          alreadyInstalled = true;
        }
      }

      if (!alreadyInstalled) {
        const baseVersion = normalizeBaseVersion(requested);
        await ensureVanillaWithProgress(baseVersion, username);

        const sel = String(state.settings?.selectedNeoForgeVersion || '');
        const allowBetas = /beta/i.test(sel);

        setStatus('Ставлю NeoForge...');
        const nr = await window.noc.installNeoForge(baseVersion, sel, allowBetas);
        if (!nr?.ok) {
          setStatus(`NeoForge ошибка: ${nr?.error || 'unknown'}`);
          return;
        }
        chosen = nr.versionId;
        alreadyInstalled = true;
      }

    } else if (loaderMode === 'forge') {
      await refreshInstallState();
      if (state.loaderInstalled && state.resolvedLoaderProfile) {
        const ex = await window.noc.profileExists(state.resolvedLoaderProfile);
        if (!ex?.exists) {
          const reinstall = window.confirm('Forge профиль не найден в папке versions. Переустановить Forge?');
          if (!reinstall) return;
          state.loaderInstalled = false;
          state.resolvedLoaderProfile = null;
        } else {
          chosen = state.resolvedLoaderProfile;
          alreadyInstalled = true;
        }
      }

      if (!alreadyInstalled) {
        const baseVersion = normalizeBaseVersion(requested);
        await ensureVanillaWithProgress(baseVersion, username);

        setStatus('Ставлю Forge...');
        const fr = await window.noc.installForge(baseVersion, state.settings?.selectedForgeBuild || '');
        if (!fr?.ok) {
          setStatus(`Forge ошибка: ${fr?.error || 'unknown'}`);
          return;
        }

        const askOpti = window.confirm('Forge установлен. Поставить OptiFine как отдельный профиль?');
        if (askOpti) {
          setStatus('Ставлю OptiFine (авто)...');
          let or = await window.noc.installOptiFine(fr.mcVersion || requested, null, state.settings?.selectedOptiFineBuild || null);
          if (!or?.ok) {
            const jarPath = await window.noc.pickOptiFineJar();
            if (jarPath) or = await window.noc.installOptiFine(fr.mcVersion || requested, jarPath, state.settings?.selectedOptiFineBuild || null);
          }

          if (or?.ok) chosen = or.versionId || fr.versionId;
          else {
            setStatus(`OptiFine не установлен: ${or?.error || 'нет installer jar'}. Запускаю Forge.`);
            chosen = fr.versionId;
          }
        } else {
          chosen = fr.versionId;
        }

        alreadyInstalled = true;
      }

    } else if (loaderMode === 'optifine') {
      await refreshInstallState();
      if (state.loaderInstalled && state.resolvedLoaderProfile) {
        const ex = await window.noc.profileExists(state.resolvedLoaderProfile);
        if (!ex?.exists) {
          const reinstall = window.confirm('OptiFine профиль не найден в папке versions. Переустановить OptiFine?');
          if (!reinstall) return;
          state.loaderInstalled = false;
          state.resolvedLoaderProfile = null;
        } else {
          chosen = state.resolvedLoaderProfile;
          alreadyInstalled = true;
          if (String(chosen).toLowerCase().includes('_pre')) {
            alreadyInstalled = false;
            setStatus('Найден pre-билд OptiFine (нестабильно). Переустанавливаю стабильный...');
          }
        }
      }

      if (!alreadyInstalled) {
        const baseVersion = normalizeBaseVersion(requested);
        await ensureVanillaWithProgress(baseVersion, username);

        setStatus('Ставлю OptiFine (авто)...');
        let or = await window.noc.installOptiFine(baseVersion, null, state.settings?.selectedOptiFineBuild || null);
        if (!or?.ok) {
          const jarPath = await window.noc.pickOptiFineJar();
          if (!jarPath) {
            setStatus('OptiFine: авто не сработал и .jar не выбран');
            return;
          }
          or = await window.noc.installOptiFine(baseVersion, jarPath, state.settings?.selectedOptiFineBuild || null);
        }

        if (!or?.ok) {
          setStatus(`OptiFine ошибка: ${or?.error || 'unknown'}`);
          return;
        }
        chosen = or.versionId;
        alreadyInstalled = true;
      }
    } else {
      const info = await window.noc.isInstalled(requested);
      chosen = info?.version || requested;
      alreadyInstalled = !!info?.installed;
    }

    if (alreadyInstalled) {
      const profileCheck = await window.noc.profileExists(chosen);
      if (!profileCheck?.exists) {
        const reinstall = window.confirm(`Профиль ${chosen} не найден. Переустановить ${loaderMode === 'vanilla' ? 'версию' : loaderMode}?`);
        if (!reinstall) return;
        setStatus(`Профиль ${chosen} отсутствует. Сначала переустанови ${loaderMode}.`);
        return;
      }
    }

    if (loaderMode !== 'vanilla') {
      const baseVersion = normalizeBaseVersion(requested);
      await ensureVanillaWithProgress(baseVersion, username);
    }

    state.settings = await window.noc.settingsSet({
      lastUsername: remember ? username : (state.settings?.lastUsername || 'Player'),
      lastVersion: requested,
      lastProfileVersion: chosen,
      loaderMode
    });

    applyAccountUI();
    setPickedVersionText();
    setRunning(true);

    if (!alreadyInstalled) {
      resetProgress();
      showDlBox(true);
      setStatus(`Установка ${chosen}…`);
    } else {
      showDlBox(false);
      setStatus(`Запуск ${chosen}…`);
    }

    const res = await window.noc.launch({
      username,
      version: chosen,
      javaPath: $('#javaPath').value.trim(),
      memoryMinMB: Number($('#memMin').value || 1024),
      memoryMaxMB: Number($('#memMax').value || 4096),
      hideOnLaunch: (loaderMode === 'vanilla'),
      closeLauncherOnLaunch: !!($('#closeLauncherOnGameStart')?.checked ?? state.settings?.closeLauncherOnGameStart)
    });

    if (!res?.ok) {
      setStatus(`Ошибка: ${res?.error || 'unknown'}`);
      showDlBox(false);
      setRunning(false);
      return;
    }

    state.lastMcEventTs = Date.now();
    state.pendingLaunchWatchdog = setTimeout(async () => {
      const idleMs = Date.now() - (state.lastMcEventTs || 0);
      if (!state.running || idleMs < 14000) return;
      const log = await window.noc.lastLog();
      const hintEl = document.getElementById('crashHint');
      const tailEl = document.getElementById('crashTail');
      const lp = document.getElementById('crashLogPath');
      if (hintEl) hintEl.textContent = 'Запуск завис/не дал окна. Нажми переустановку профиля и попробуй снова.';
      if (tailEl) tailEl.value = (log?.tail || '').trim();
      if (lp) lp.value = log?.logPath || state.lastLogPath || '';
      setStatus('Запуск не дал окна — открыл лог');
      openModal('modalCrash');
    }, 15000);
  } catch (e) {
    setStatus(`Ошибка запуска: ${e?.message || e}`);
    showDlBox(false);
    setRunning(false);
  }
}

async function doStop() {
  await window.noc.stop();
  setStatus('Остановлено');
  setRunning(false);
}

async function msLogin() {
  setStatus('Microsoft вход: готовлю вход…');
  try {
    state.msInteractive = false;
    state.msPending = null;

    const r = await window.noc.msBegin();
    if (r?.disabled) {
      setStatus('Онлайн-авторизация временно отключена. Используй режим Пиратка.');
      addTimeline('ℹ Онлайн-авторизация отключена');
      return false;
    }
    if (!r?.ok) throw new Error(r?.error || 'ms_begin_failed');

    if (r.restored && r.account) {
      state.settings = await window.noc.settingsGet();
      applyAccountUI();
      setStatus('Вход восстановлен. Лицензия подтверждена.');
      addTimeline('✅ Сессия восстановлена (refresh token)');
      stopAuthStatusPoll();
      return true;
    }

    // Interactive browser login (no device codes).
    if (r.interactive) {
      state.msInteractive = true;
      const btn = document.getElementById('btnAuthDiag');
      if (btn) btn.textContent = 'Проверка…';
      setStatus('Открыл окно Microsoft. Заверши вход в браузере — лаунчер подхватит автоматически.');

      // Auto-confirm loop while the flow is pending.
      if (state.__msAutoTimer) clearInterval(state.__msAutoTimer);
      state.__msAutoTimer = setInterval(async () => {
        try {
          const r = await msConfirm(true);
          if (r === 'ok' || r === 'license' || r === 'error' || r === 'expired') {
            clearInterval(state.__msAutoTimer);
            state.__msAutoTimer = null;
            const b = document.getElementById('btnAuthDiag');
            if (b) b.textContent = (state.settings?.account ? 'Выйти' : 'Вход');
          }
        } catch (_) {}
      }, 1000);
      startMsStatusPoll();
      return true;
    }

    setStatus('Microsoft вход: ожидаю подтверждение…');
    startMsStatusPoll();
    return true;
  } catch (e) {
    setStatus('Microsoft вход: ошибка');
    const msg = String(e?.message || e || 'unknown');
    logLine('error', msg);
    // Без модалки: оставляем ошибку в логах/статусе.
    startMsStatusPoll();
    authDiag('Не удалось начать Microsoft вход', e);
    return false;
  }
}

async function ensureAuthCode() {
  // If already logged in: act as logout.
  if (state.settings?.account) {
    await logout();
    return;
  }

  // Без модалки. Если вход уже начат — кнопка «Вход» работает как «Проверить».
  const fresh = state.msPending && (Date.now() - (state.msPending.ts || 0) < 12 * 60 * 1000);
  if (fresh || state.msInteractive) {
    return await msConfirm(false);
  }
  return await msLogin();
}



let __authPollTimer = null;
function startAuthStatusPoll() {
  if (__authPollTimer) return;
  __authPollTimer = setInterval(async () => {
    try {
      const st = await window.noc.authStatus();
      if (st?.lastCode && !state.msPending) {
        state.msPending = { ...st.lastCode, ts: Date.now() };
        const hint = document.getElementById('authHint');
        if (hint && state.msPending?.message) hint.textContent = state.msPending.message;
      }
      if (st?.lastError) {
        const hint = document.getElementById('authHint');
        if (hint && !state.msPending) hint.textContent = `Ошибка входа: ${st.lastError}`;
      }
    } catch (_) {}
  }, 1000);
}

function startMsStatusPoll() {
  if (__authPollTimer) return;
  __authPollTimer = setInterval(async () => {
    try {
      const st = await window.noc.msStatus();
      const hint = document.getElementById('authHint');
      if (hint && Array.isArray(st?.steps) && st.steps.length) {
        hint.textContent = st.steps[st.steps.length - 1];
      }
    } catch (_) {}
  }, 1000);
}
function stopAuthStatusPoll() {
  if (__authPollTimer) { clearInterval(__authPollTimer); __authPollTimer = null; }
}
async function msConfirm(silent = false) {
  if (!silent) setStatus('Microsoft вход: проверяю…');
  try {
    const acc = await window.noc.msComplete();
    if (!acc?.ok) throw new Error(acc?.error || 'ms_complete_failed');

    if (Array.isArray(acc?.steps) && acc.steps.length) {
      addTimeline('🔗 MS login → XBL → XSTS → MC → profile/entitlements');
      for (const s of acc.steps.slice(-10)) addTimeline(`• ${s}`);
    }

    state.settings = await window.noc.settingsGet();
    applyAccountUI();
    state.msPending = null;
    state.msInteractive = false;
    if (!silent) setStatus('Вход выполнен. Лицензия подтверждена.');
    return 'ok';
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Most common: user hasn't confirmed yet
    if (/authorization_pending|pending/i.test(msg)) {
      if (!silent) setStatus('Жду подтверждения входа в браузере…');
      return 'pending';
    }
    if (/expired|timeout|cancel/i.test(msg)) {
      state.msPending = null;
      const btn = document.getElementById('btnAuthDiag');
      if (btn) btn.textContent = 'Вход';
      if (!silent) setStatus('Код входа истёк. Нажми «Войти» ещё раз.');
      return 'expired';
    }
    if (/no.*entitlement|does not own|not.*purchased|not.*licensed|java edition/i.test(msg) || /Лицензия Minecraft/i.test(msg)) {
      await window.noc.settingsSet({ preferOnline: false });
      $('#onlineMode').checked = false;
      setStatus('У вас нет лицензии Minecraft на этом аккаунте.');
      addTimeline('⚠ Нет лицензии Minecraft: включён оффлайн режим');
      const btn = document.getElementById('btnAuthDiag');
      if (btn) btn.textContent = 'Вход';
      return 'license';
    }
    if (!silent) setStatus('Microsoft вход: не получилось');
    logLine('error', e?.message || e);
    authDiag('Ошибка подтверждения Microsoft входа', e);
    return 'error';
  }
}

async function logout() {
  await window.noc.logout();
  state.settings = await window.noc.settingsGet();
  applyAccountUI();
  ($('#authHint')||{textContent:''}).textContent = '—';
  const __b = $('#btnRetryAuth'); if(__b) __b.disabled = true;
  setStatus('Вы вышли');
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle('mode-bedrock', mode === 'bedrock');
  document.body.classList.toggle('mode-java', mode === 'java');

  $('#modeJava')?.classList.toggle('active', mode === 'java');
  $('#modeBedrock')?.classList.toggle('active', mode === 'bedrock');
  // Update header title + accessibility state
  const ed = $('#editionTitle');
  if (ed) ed.textContent = mode === 'bedrock' ? 'MINECRAFT: ИЗДАНИЕ BEDROCK' : 'MINECRAFT: ИЗДАНИЕ JAVA';
  $('#modeJava')?.setAttribute('aria-selected', mode === 'java' ? 'true' : 'false');
  $('#modeBedrock')?.setAttribute('aria-selected', mode === 'bedrock' ? 'true' : 'false');


  // Top tabs are Java-only (Bedrock is a separate game)
  $('#topTabs')?.classList.toggle('hidden', mode !== 'java');

  // Hide Java-only hero meta (selected version/loader) in Bedrock mode
  $('#heroMeta')?.classList.toggle('hidden', mode !== 'java');

  $('#javaControls')?.classList.toggle('hidden', mode !== 'java');
  $('#javaOnlineRow')?.classList.toggle('hidden', mode !== 'java');
  $('#username')?.closest('.field')?.classList.toggle('hidden', mode !== 'java');
  $('#btnPlay')?.classList.toggle('hidden', mode !== 'java');
  $('#bedrockBox')?.classList.toggle('hidden', mode !== 'bedrock');
  // Java library buttons should not appear in Bedrock mode
  $('#btnOpenLibrary')?.classList.toggle('hidden', mode !== 'java');
  $('#btnOpenModrinth')?.classList.toggle('hidden', mode !== 'java');
  showDlBox(mode === 'java' ? !$('#dlBox')?.classList.contains('hidden') : false);

  if (mode === 'java') {
    setStatus('Готов');
    requestAnimationFrame(() => refreshHealthPanelLive());
  } else if (mode === 'bedrock') {
    // make tab switch feel instant; run check asynchronously after paint
    requestAnimationFrame(() => refreshBedrockState());
  }
  updateActionButton();
}

async function refreshBedrockState() {
  const token = ++state.bedrockCheckToken;
  const stateEl = $('#bedrockState');
  const btn = $('#btnBedrockAction');
  if (!stateEl || !btn) return;

  if (state.settings?.bedrockDemoMode) {
    btn.textContent = 'Открыть встроенный менеджер';
    btn.disabled = false;
    stateEl.textContent = 'Bedrock Demo: встроенный менеджер внутри лаунчера (без внешних окон).';
    if (state.mode === 'bedrock') setStatus('Bedrock Demo (встроенный) активен');
    return;
  }

  btn.textContent = 'Запустить Bedrock';
  btn.disabled = false;
  stateEl.textContent = 'Проверяю Bedrock...';

  try {
    const info = await window.noc.bedrockCheck();
    if (token !== state.bedrockCheckToken) return;

    if (info?.installed) {
      stateEl.textContent = `Найдено: ${info.packageName || 'Minecraft for Windows'}${info.version ? ` • ${info.version}` : ''}`;
      if (state.mode === 'bedrock') setStatus('Bedrock найден. Можно запускать.');
    } else {
      stateEl.textContent = 'Bedrock не найден. При запуске открою Microsoft Store.';
      if (state.mode === 'bedrock') setStatus('Bedrock не найден. Открою Store для установки.');
    }
  } catch {
    if (token !== state.bedrockCheckToken) return;
    stateEl.textContent = 'Не удалось проверить установку. Можно попробовать запуск.';
    if (state.mode === 'bedrock') setStatus('Bedrock: проверка недоступна, попробуй запуск.');
  }
}

async function handleBedrockAction() {
  if (state.settings?.bedrockDemoMode) {
    if (state.mode === 'bedrock') setStatus('Открываю встроенный Bedrock Manager...');
    await renderBedrockVersionsDemo();
    openModal('modalBedrockVersions');
    return;
  }

  const res = await window.noc.bedrockLaunch();
  if (res?.ok) {
    if (state.mode === 'bedrock') setStatus('Запускаю Minecraft for Windows…');
    return;
  }

  // Если не запустилось — предлагаем установку через Store
  const storeRes = await window.noc.bedrockOpenStore();
  if (storeRes?.ok) {
    if (state.mode === 'bedrock') setStatus('Bedrock не найден. Открываю Microsoft Store…');
  } else {
    if (state.mode === 'bedrock') setStatus(`Ошибка запуска Bedrock: ${res?.error || 'unknown'}`);
  }
}

// --- Veloren UI ---
async function refreshVelorenState() {
  const stateEl = $('#velorenState');
  const btn = $('#btnVelorenAction');
  if (!stateEl || !btn) return;

  stateEl.textContent = 'Проверяю установку…';
  btn.disabled = true;

  try {
    const info = await window.noc.velorenStatus();
    if (info?.installed) {
      stateEl.textContent = `Установлен${info.version ? ` • ${info.version}` : ''}`;
      btn.textContent = 'Играть';
      btn.disabled = false;
    } else {
      stateEl.textContent = 'Не установлен. Скачаю и установлю при запуске.';
      btn.textContent = 'Установить';
      btn.disabled = false;
    }
    if (state.mode === 'veloren') setStatus('Veloren готов');
  } catch (e) {
    stateEl.textContent = 'Не удалось проверить. Можно попробовать установку.';
    btn.textContent = 'Установить';
    btn.disabled = false;
    if (state.mode === 'veloren') setStatus('Veloren: ошибка проверки');
  }
}

function bindVelorenProgress() {
  // Reuse the same download box for a clean progress UX.
}

async function handleVelorenAction() {
  const btn = $('#btnVelorenAction');
  if (btn) btn.disabled = true;
  setStatus('Veloren: проверяю/обновляю…');
  try {
    showDlBox(true);
    const res = await window.noc.velorenEnsureLatestAndLaunch();
    showDlBox(false);
    if (res?.ok) {
      setStatus('Veloren запущен');
    } else {
      setStatus(`Veloren: ошибка ${res?.error || 'unknown'}`);
    }
  } catch (e) {
    showDlBox(false);
    setStatus('Veloren: ошибка ' + (e?.message || e));
  }
  if (btn) btn.disabled = false;
  await refreshVelorenState();
}


async function openResources() {
  await refreshResources();
  openModal('modalResources');
}
async function refreshResources() {
  const kind = ($('#resKind')?.value || 'resourcepacks');
  const r = await window.noc.resourcesList(kind);
  const list = $('#resList');
  if (!list) return;
  list.innerHTML = '';
  for (const f of (r.files || [])) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('div');
    name.className = 'rowTitle mono';
    name.textContent = `${f.filename} • ${formatBytes(f.size || 0)}`;
    const btns = document.createElement('div');
    btns.className = 'rowActions';
    const del = document.createElement('button');
    del.className = 'chip danger';
    del.textContent = 'Удалить';
    del.addEventListener('click', async () => {
      if (!confirm(`Удалить ${f.filename}?`)) return;
      await window.noc.resourcesRemove(kind, f.filename);
      await refreshResources();
    });
    btns.appendChild(del);
    row.appendChild(name);
    row.appendChild(btns);
    list.appendChild(row);
  }
  if (!(r.files || []).length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Пусто. Установи ZIP или открой папку.';
    list.appendChild(empty);
  }
}

async function openCleanup() {
  await scanCleanup();
  openModal('modalCleanup');
}
async function scanCleanup() {
  const r = await window.noc.cleanupScan();
  const hint = $('#cleanupHint');
  if (hint) {
    const total = (r.targets || []).reduce((s,x)=>s+(x.bytes||0),0) + (r.partial?.bytes||0);
    hint.textContent = `Можно очистить примерно: ${formatBytes(total)} (частичные: ${r.partial?.count||0})`;
  }
}
async function runCleanup() {
  const what = {
    logs: !!$('#clLogs')?.checked,
    'crash-reports': !!$('#clCrashes')?.checked,
    natives_runtime: !!$('#clNatives')?.checked,
    partial: !!$('#clPart')?.checked,
    exports: !!$('#clExports')?.checked
  };
  setStatus('Очищаю…');
  const r = await window.noc.cleanupRun(what);
  if (r?.ok) setStatus('Очистка выполнена');
  else setStatus(`Очистка: ошибка ${r?.error || 'unknown'}`);
  await scanCleanup();
}

async function openSync() {
  await populateSyncSelectors();
  openModal('modalSync');
}
async function populateSyncSelectors() {
  const res = await window.noc.instancesList();
  const items = res?.items || [];
  const from = $('#syncFrom');
  const to = $('#syncTo');
  if (!from || !to) return;
  from.innerHTML = '';
  to.innerHTML = '';
  for (const it of items) {
    const o1 = document.createElement('option');
    o1.value = it.id;
    o1.textContent = it.name || it.id;
    const o2 = o1.cloneNode(true);
    from.appendChild(o1);
    to.appendChild(o2);
  }
  from.value = res?.activeId || 'default';
  to.value = res?.activeId || 'default';
}
async function applySync() {
  const fromId = $('#syncFrom')?.value;
  const toId = $('#syncTo')?.value;
  if (!fromId || !toId) return;
  if (fromId === toId) {
    alert('Выбери разные инстансы.');
    return;
  }
  const ok = confirm(`Скопировать настройки из "${fromId}" в "${toId}"? Это перезапишет options/servers.`);
  if (!ok) return;
  setStatus('Синхронизирую…');
  const r = await window.noc.settingsSyncApply({ fromId, toId });
  if (r?.ok) setStatus(`Синхронизация: скопировано файлов: ${r.copied || 0}`);
  else setStatus(`Синхронизация: ошибка ${r?.error || 'unknown'}`);
}

async function openModrinthCatalogFromUI() {
  const mcVersion = getSelectedBaseVersion();
  const loader = String($('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla');
  try {
    const r = await window.noc.openCatalog({ provider: 'modrinth', mcVersion, loader });
    if (r?.ok) return;
  } catch (_) {}

  const params = new URLSearchParams();
  if (mcVersion) params.set('g', mcVersion);
  if (['fabric','forge','quilt','neoforge'].includes(loader)) params.set('l', loader);
  const url = `https://modrinth.com/mods?${params.toString()}`;
  try {
    const r2 = await window.noc.webOpen({ key: 'modrinth', url, title: 'Modrinth' });
    if (r2?.ok) return;
  } catch (_) {}
  try { await window.noc.shellOpenExternal(url); } catch (_) {}
}

function renderLocalServers(items = []) {
  const root = $('#localServersList');
  if (!root) return;
  if (!Array.isArray(items) || !items.length) {
    root.innerHTML = '<div class="help">Активных локальных серверов пока нет.</div>';
    return;
  }
  root.innerHTML = items.map((s, i) => {
    const name = String(s.worldName || s.name || `Сервер #${i + 1}`);
    const host = String(s.hostName || s.owner || 'unknown');
    const ip = String(s.connect?.ip || s.ip || '');
    const port = Number(s.connect?.port || s.port || 19132);
    const ver = String(s.gameVersion || s.version || '—');
    const roomId = String(s.roomId || s.id || '');
    const connectDisabled = !ip;
    return `<div class="localSrvItem">
      <div>
        <div class="localSrvName">${name}</div>
        <div class="localSrvMeta">Хост: ${host} • ${ip ? `${ip}:${port}` : 'адрес скрыт'} • ${ver}</div>
      </div>
      <button class="btn mini ${connectDisabled ? 'ghost' : ''}" data-local-connect="${roomId}" data-ip="${ip}" data-port="${port}" ${connectDisabled ? 'disabled' : ''}>Подключиться</button>
    </div>`;
  }).join('');

  root.querySelectorAll('[data-local-connect]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ip = String(btn.getAttribute('data-ip') || '');
      const port = Number(btn.getAttribute('data-port') || 19132);
      if (!ip) return;
      const uri = `minecraft://?addExternalServer=${encodeURIComponent('Noc Local')}|${ip}:${port}`;
      try { await window.noc.shellOpenExternal(uri); } catch (_) {}
      setHint('localServersHint', `Ссылка на подключение открыта: ${ip}:${port}`);
    });
  });
}

async function refreshLocalServers() {
  setHint('localServersHint', 'Обновляю список...');
  const r = await window.noc.localServersList();
  if (!r?.ok) {
    renderLocalServers([]);
    setHint('localServersHint', `Ошибка реестра: ${r?.error || 'unknown'}`);
    return;
  }
  renderLocalServers(r.servers || []);
  setHint('localServersHint', `Найдено серверов: ${(r.servers || []).length}`);
}

function stopLocalServersHeartbeat() {
  if (state.localServersHeartbeatTimer) {
    clearInterval(state.localServersHeartbeatTimer);
    state.localServersHeartbeatTimer = null;
  }
}

function startLocalServersHeartbeat() {
  stopLocalServersHeartbeat();
  state.localServersHeartbeatTimer = setInterval(async () => {
    try { await window.noc.localServersHeartbeat({ roomId: state.localServersRoomId }); } catch (_) {}
  }, 15000);
}

function wireUI() {
  // Custom loader dropdown (prevents native white select menu)
  try { initLoaderDropdown(); } catch (_) {}

  $('#modeJava')?.addEventListener('click', () => setMode('java'));
  $('#modeBedrock')?.addEventListener('click', () => setMode('bedrock'));

  $('#btnPickVersion')?.addEventListener('click', async () => {
    setVersionsView('online');
    // Default: show Releases first
    const tf = $('#typeFilter');
    if (tf) tf.value = 'release';
    const vs = $('#versionSearch');
    if (vs) vs.value = '';
    openModal('modalVersions');
    renderVersionsList();
  });
  $('#btnCloseVersions')?.addEventListener('click', () => closeModal('modalVersions'));

  $('#btnVersionsOnline')?.addEventListener('click', async () => {
    setVersionsView('online');
    renderVersionsList();
  });
  $('#btnVersionsInstalled')?.addEventListener('click', async () => {
    setVersionsView('installed');
    state.installedProfilesCache = null;
    await renderInstalledProfilesList();
  });
  $('#btnOpenSettings')?.addEventListener('click', () => openModal('modalSettings'));
  // Secondary settings button in the header row
  $('#btnOpenSettings2')?.addEventListener('click', () => openModal('modalSettings'));

  $('#btnLocalServers')?.addEventListener('click', async () => {
    try {
      const url = String(state.settings?.localServersRegistryUrl || '');
      if ($('#localServersRegistryUrl')) $('#localServersRegistryUrl').value = url;
    } catch (_) {}
    openModal('modalLocalServers');
    await refreshLocalServers();
  });
  $('#btnCloseLocalServers')?.addEventListener('click', () => closeModal('modalLocalServers'));
  $('#btnLocalServersRefresh')?.addEventListener('click', refreshLocalServers);
  $('#btnSaveLocalServersRegistry')?.addEventListener('click', async () => {
    const url = String($('#localServersRegistryUrl')?.value || '').trim();
    state.settings = await window.noc.settingsSet({ localServersRegistryUrl: url });
    setHint('localServersHint', url ? 'URL реестра сохранён.' : 'URL очищен.');
  });
  $('#btnLocalWorldOpen')?.addEventListener('click', async () => {
    const worldName = String($('#localWorldName')?.value || 'Мой мир Bedrock').trim();
    const port = Number($('#localWorldPort')?.value || 19132) || 19132;
    const ip = String(state.settings?.publicIp || '').trim();
    const r = await window.noc.localServersOpen({
      worldName,
      gameVersion: getSelectedBaseVersion(),
      hostName: String($('#username')?.value || state.settings?.lastUsername || 'Host'),
      connect: { type: 'direct', ip, port }
    });
    if (!r?.ok) {
      setHint('localServersHint', `Не удалось открыть: ${r?.error || 'unknown'}. Укажи реальный внешний IP в API/реестре.`);
      return;
    }
    state.localServersRoomId = r.roomId || r.id || null;
    startLocalServersHeartbeat();
    setHint('localServersHint', 'Мир открыт и публикуется в реестре.');
    await refreshLocalServers();
  });
  $('#btnLocalWorldClose')?.addEventListener('click', async () => {
    const r = await window.noc.localServersClose({ roomId: state.localServersRoomId });
    stopLocalServersHeartbeat();
    state.localServersRoomId = null;
    setHint('localServersHint', r?.ok ? 'Публикация мира остановлена.' : `Ошибка: ${r?.error || 'unknown'}`);
    await refreshLocalServers();
  });

  // Mods (must be clickable immediately after start)
  $('#btnMods')?.addEventListener('click', async () => {
    try {
      await openModsModal();
    } catch (e) {
      setStatus('Ошибка: ' + (e?.message || e));
    }
  });

  // Bottom library button (mods/textures/shaders)
  $('#btnOpenLibrary')?.addEventListener('click', async () => {
    // highlight in sidebar
    try {
      document.querySelectorAll('.sbNav .sbItem').forEach(b => b.classList.toggle('active', b.id === 'btnOpenLibrary'));
    } catch (_) {}
    try { await openModsModal(); } catch (e) { setStatus('Ошибка: ' + (e?.message || e)); }
  });
  on('btnOpenModrinth', 'click', async () => {
    try {
      document.querySelectorAll('.sbNav .sbItem').forEach(b => b.classList.toggle('active', b.id === 'btnOpenModrinth'));
    } catch (_) {}
    setStatus('Открываю Modrinth…');
    await openModrinthCatalogFromUI();
  });

  on('btnInstrumente', 'click', async () => {
    try {
      document.querySelectorAll('.sbNav .sbItem').forEach(b => b.classList.toggle('active', b.id === 'btnInstrumente'));
    } catch (_) {}
    openModal('modalVersionToolPick');
  });

  // Library tabs
  document.querySelectorAll('#libraryTabs .segBtn')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tab = btn.getAttribute('data-libtab') || 'mods';
      setLibraryTab(tab);
      await refreshLibraryInstalled();
    });
  });
  $('#modsClose')?.addEventListener('click', () => closeModal('modsModal'));
  $('#modsRefreshBtn')?.addEventListener('click', () => refreshLibraryInstalled());
  $('#modsOpenFolderBtn')?.addEventListener('click', () => {
    if (state.libraryTab === 'mods') return window.noc.modsOpenFolder();
    return window.noc.resourcesOpenFolder(state.libraryTab);
  });
  $('#modsInstallFileBtn')?.addEventListener('click', async () => {
    if (state.libraryTab === 'mods') {
      const r = await window.noc.modsInstallFromFile();
      if (r?.ok) { await refreshModsInstalled(); setHint('modsHint', 'Установлено: ' + (r.installed || 1)); }
      else if (!r?.canceled) setHint('modsHint', r?.error || 'Не удалось установить');
      return;
    }
    const r = await window.noc.resourcesInstallFromFile(state.libraryTab);
    if (r?.ok) { await refreshResourcesInstalled(state.libraryTab); setHint('modsHint', 'Установлено: ' + (r.installed || 1)); }
    else if (!r?.canceled) setHint('modsHint', r?.error || 'Не удалось установить');
  });
  $('#modsSearchBtn')?.addEventListener('click', () => doModsSearch());
  $('#modsOpenModrinthBtn')?.addEventListener('click', () => openModrinthCatalogFromUI());
  $('#modsSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doModsSearch(); });
  $('#modsUpdateAllBtn')?.addEventListener('click', async () => {
    setHint('modsHint', 'Обновление модов...');
    const r = await window.noc.modsUpdateAll();
    if (r?.ok) { setHint('modsHint', 'Обновлено: ' + (r.updated || 0)); await refreshModsInstalled(); }
    else setHint('modsHint', r?.error || 'Не удалось обновить');
  });
  $('#modsAnalyzeBtn')?.addEventListener('click', async () => {
    setHint('modsHint', 'Проверка модов...');
    const r = await window.noc.modsAnalyze();
    if (r?.ok) {
      renderModsIssues(r.issues || []);
      setHint('modsHint', (r.issues && r.issues.length) ? `Найдено проблем: ${r.issues.length}` : 'Проблем не найдено');
    } else {
      setHint('modsHint', r?.error || 'Ошибка проверки');
    }
  });
  $('#modsRollbackBtn')?.addEventListener('click', async () => {
    setHint('modsHint', 'Откат к последнему снимку...');
    const r = await window.noc.modsRollbackLast();
    if (r?.ok) { setHint('modsHint', `Откат выполнен (${r.id})`); await refreshModsInstalled(); renderModsIssues([]); }
    else setHint('modsHint', r?.error || 'Не удалось откатить');
  });
  $('#modsDisableLastBtn')?.addEventListener('click', async () => {
    setHint('modsHint', 'Выключаю последний установленный мод...');
    const r = await window.noc.modsDisableLastInstalled();
    if (r?.ok) { setHint('modsHint', `Выключен: ${r.disabled}`); await refreshModsInstalled(); }
    else setHint('modsHint', r?.error || 'Не удалось выключить');
  });

  // Microsoft авторизацию временно убрали из UI
  $('#btnCloseSettings')?.addEventListener('click', () => closeModal('modalSettings'));
  $('#btnCloseCrash')?.addEventListener('click', () => closeModal('modalCrash'));
  $('#btnCloseAuth')?.addEventListener('click', () => closeModal('modalAuth'));
  // Кнопки/модалка авторизации оставлены на будущее, но сейчас не используются.
  $('#btnProfiles')?.addEventListener('click', async () => {
    await loadInstalledProfiles();
    renderProfilesList();
    openModal('modalProfiles');
  });

  // -------------------------------------------------------------------------
  // Redesigned navigation (Minecraft Launcher inspired)
  // -------------------------------------------------------------------------
  const setTopTabActive = (id) => {
    document.querySelectorAll('.topTabs .tabBtn').forEach(b => {
      b.classList.toggle('active', b.id === id);
    });
  };
  const setSidebarActive = (id) => {
    document.querySelectorAll('.sbNav .sbItem').forEach(b => {
      b.classList.toggle('active', b.id === id);
    });
  };

  // "Играть"
  $('#navPlay')?.addEventListener('click', () => {
    setTopTabActive('navPlay');
  });

  // "Установки" is handled by the existing Profiles click above; here we only mark active.
  $('#btnProfiles')?.addEventListener('click', () => setTopTabActive('btnProfiles'));

  // "Скины" -> Settings modal (focus skin mode)
  $('#tabSkins')?.addEventListener('click', () => {
    setTopTabActive('tabSkins');
    openModal('modalSettings');
    setTimeout(() => $('#skinMode')?.focus(), 60);
  });

  // Sidebar
  on('sbNews', 'click', async () => {
    setSidebarActive('sbNews');
    setStatus('Открываю Telegram…');
    try {
      await window.noc.shellOpenExternal('https://t.me/bundstraze');
    } catch (_) {}
  });

  $('#btnCloseProfiles')?.addEventListener('click', () => closeModal('modalProfiles'));
  $('#btnBedrockVersions')?.addEventListener('click', async () => {
    try {
      const r = await window.noc?.bedrockVersionToolOpen?.('new', 'version');
      if (r?.ok) {
        setStatus('Открыт загрузчик версий');
        return;
      }
    } catch (_) {}
    // Fallback: built-in versions modal.
    await renderBedrockVersionsDemo();
    openModal('modalBedrockVersions');
  });

  // Bedrock content (packs/worlds/skins)
  const openBedrockContent = async (tab) => {
    await renderBedrockContent(tab || 'packs');
    openModal('modalBedrockContent');
  };

  $('#btnBedrockPacks')?.addEventListener('click', () => openBedrockContent('packs'));
  $('#btnBedrockWorlds')?.addEventListener('click', () => openBedrockContent('worlds'));
  $('#btnBedrockSkins')?.addEventListener('click', () => openBedrockContent('skins'));
  $('#btnBedrockLibrary')?.addEventListener('click', () => openBedrockContent('packs'));
  $('#btnBedrockAddons')?.addEventListener('click', async () => {
    const url = 'https://www.curseforge.com/minecraft-bedrock';
    const r = await window.noc?.webOpen?.({ key: 'bedrock-addons', title: 'Bedrock Addons', url });
    if (!r?.ok) {
      try { await window.noc?.shellOpenExternal?.(url); } catch (_) {}
    }
  });

  // New versions button removed by request; sidebar add-ons keeps only old versions.

  $('#btnVersionToolOld')?.addEventListener('click', async () => {
    try {
      const r = await window.noc?.bedrockVersionToolOpen?.('old', 'instrumente');
      if (r?.ok) setStatus('Открыт загрузчик старых версий');
      else setStatus('Не удалось открыть загрузчик старых версий');
    } catch (_) {
      setStatus('Не удалось открыть загрузчик старых версий');
    }
    closeModal('modalVersionToolPick');
  });

  $('#btnCloseVersionToolPick')?.addEventListener('click', () => closeModal('modalVersionToolPick'));
  $('#btnBedrockVirusCheck')?.addEventListener('click', () => openModal('modalBedrockVirus'));
  $('#btnBedrockExperiments')?.addEventListener('click', async () => {
    await renderBedrockTreatments();
    openModal('modalBedrockExperiments');
  });
  $('#btnBedrockSkinsSite')?.addEventListener('click', async () => {
    const url = 'https://namemc.com/minecraft-skins';
    const r = await window.noc?.webOpen?.({ key: 'bedrock-skins', title: 'Minecraft Skins', url });
    if (!r?.ok) {
      try { await window.noc?.shellOpenExternal?.(url); } catch (_) {}
    }
  });
  const msFixLog = (text) => {
    const box = $('#bedrockMsFixLog');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'mcSub';
    row.textContent = text;
    box.prepend(row);
  };

  $('#btnBedrockMsFix')?.addEventListener('click', async () => {
    openModal('modalBedrockMsFix');
    msFixLog('Открыл мастер MS Fix. Нажми "Диагностика".');
  });
  $('#btnCloseBedrockMsFix')?.addEventListener('click', () => closeModal('modalBedrockMsFix'));

  $('#btnMsFixDiag')?.addEventListener('click', async () => {
    setStatus('MS Fix: диагностика...');
    const d = await window.noc?.bedrockMicrosoftDiag?.();
    if (!d?.ok) {
      msFixLog(`Диагностика: ошибка — ${d?.error || 'unknown'}`);
      setStatus('MS Fix: диагностика не удалась');
      return;
    }
    const missing = [];
    if (!d.minecraftInstalled) missing.push('Minecraft for Windows');
    if (!d.gamingServicesInstalled) missing.push('Gaming Services');
    if (!d.xboxIdentityInstalled) missing.push('Xbox Identity Provider');
    if (!d.storeInstalled) missing.push('Microsoft Store');
    if (d.storeOutdated) missing.push(`Store outdated ${d.storeVersion || '?'} < ${d.minStoreVersion || '?'}`);
    if (!d.storeServiceOk) missing.push('ClipSVC');
    if (!d.wuServiceOk) missing.push('wuauserv');
    if (!d.bitsServiceOk) missing.push('BITS');
    msFixLog(missing.length ? `Найдены проблемы: ${missing.join(', ')}` : 'Критичных проблем не найдено.');
    setStatus('MS Fix: диагностика завершена');
  });

  $('#btnMsFixAuto')?.addEventListener('click', async () => {
    setStatus('MS Fix: выполняю авто-фикс...');
    const r = await window.noc?.bedrockMicrosoftQuickFix?.();
    if (!r?.ok) {
      msFixLog(`Авто-фикс: ошибка — ${r?.error || 'unknown'}`);
      setStatus('MS Fix: авто-фикс не удался');
      return;
    }
    for (const s of (r.steps || [])) {
      msFixLog(`${s.ok ? '✅' : '⚠️'} ${s.name}${s.error ? ` — ${s.error}` : ''}`);
    }
    msFixLog('Авто-фикс завершён. Далее открой Store обновления и перезагрузи ПК.');
    setStatus('MS Fix: авто-фикс завершён');
  });

  $('#btnMsFixStoreDeep')?.addEventListener('click', async () => {
    setStatus('MS Fix: выполняю глубокий ремонт Store...');
    const r = await window.noc?.bedrockStoreDeepFix?.();
    if (!r?.ok) {
      msFixLog(`Глубокий ремонт Store: ошибка — ${r?.error || 'unknown'}`);
      setStatus('MS Fix: глубокий ремонт Store не удался');
      return;
    }
    for (const s of (r.steps || [])) {
      msFixLog(`${s.ok ? '✅' : '⚠️'} ${s.name}${s.error ? ` — ${s.error}` : ''}`);
    }
    msFixLog(r?.note || 'Глубокий ремонт Store завершён.');
    setStatus('MS Fix: глубокий ремонт Store завершён');
  });

  $('#btnMsFixStoreUpdates')?.addEventListener('click', async () => { await window.noc?.shellOpenExternal?.('ms-windows-store://downloadsandupdates'); msFixLog('Открыт Store: Обновления.'); });
  $('#btnMsFixXboxApp')?.addEventListener('click', async () => { await window.noc?.shellOpenExternal?.('ms-windows-store://pdp/?productid=9MV0B5HZVK9Z'); msFixLog('Открыта страница Xbox app в Store.'); });
  $('#btnMsFixGamingServices')?.addEventListener('click', async () => { await window.noc?.shellOpenExternal?.('ms-windows-store://pdp/?productid=9MWPM2CQNLHN'); msFixLog('Открыта страница Gaming Services в Store.'); });
  $('#btnMsFixMinecraftStore')?.addEventListener('click', async () => { await window.noc?.shellOpenExternal?.('ms-windows-store://pdp/?PFN=Microsoft.MinecraftUWP_8wekyb3d8bbwe'); msFixLog('Открыта страница Minecraft for Windows в Store.'); });
  $('#btnMsFixXboxNetworking')?.addEventListener('click', async () => { await window.noc?.shellOpenExternal?.('ms-settings:gaming-xboxnetworking'); msFixLog('Открыты настройки Xbox Networking (NAT/Teredo).'); });
  $('#btnMsFixReboot')?.addEventListener('click', async () => {
    msFixLog('Запрос перезагрузки ПК через 5 секунд...');
    const r = await window.noc?.bedrockRebootNow?.();
    if (!r?.ok) msFixLog(`Не удалось перезагрузить ПК: ${r?.error || 'unknown'}`);
  });

  $('#btnBedrockXboxFix')?.addEventListener('click', async () => {
    setStatus('Xbox Fixer: проверяю Xbox компоненты...');
    const d = await window.noc?.bedrockXboxDiag?.();
    if (!d?.ok) {
      setStatus(`Xbox Fixer: диагностика не удалась — ${d?.error || 'unknown'}`);
      return;
    }

    const missing = [];
    if (!d.xboxAppInstalled) missing.push('Xbox app');
    if (!d.xboxIdentityInstalled) missing.push('Xbox Identity Provider');
    if (!d.gamingServicesInstalled) missing.push('Gaming Services');
    if (!d.servicesOk) missing.push('Xbox services');

    setStatus(missing.length
      ? `Xbox Fixer: найдены проблемы (${missing.join(', ')}). Запускаю фикс...`
      : 'Xbox Fixer: критичных проблем не найдено, запускаю профилактический фикс...');

    const f = await window.noc?.bedrockXboxQuickFix?.();
    if (f?.ok) {
      setStatus('Xbox Fixer: готово. Проверь Xbox Networking и перезапусти ПК.');
    } else {
      setStatus(`Xbox Fixer: частично выполнено — ${f?.error || 'unknown'}`);
    }
  });
  // Bedrock settings (graphics/options)
  const openBedrockSettings = async () => {
    await renderBedrockOptions();
    openModal('modalBedrockSettings');
  };
  window.noc?.onUiOpenBedrockSettings?.(() => { openBedrockSettings(); });
  $('#btnBedrockGfx')?.addEventListener('click', openBedrockSettings);
  $('#btnBedrockSettings')?.addEventListener('click', openBedrockSettings);
  $('#btnCloseBedrockContent')?.addEventListener('click', () => closeModal('modalBedrockContent'));

  $('#btnCloseBedrockVirus')?.addEventListener('click', () => closeModal('modalBedrockVirus'));
  $('#btnCloseBedrockExperiments')?.addEventListener('click', () => closeModal('modalBedrockExperiments'));
  $('#btnBrExpRefresh')?.addEventListener('click', async () => renderBedrockTreatments());
  $('#btnBrExpBackup')?.addEventListener('click', async () => {
    const r = await window.noc?.bedrockTreatmentsBackup?.();
    const h = $('#bedrockExpHint');
    if (r?.ok) {
      if (h) h.textContent = `Файл: ${r.path || '—'} • Бэкап: ${r.backup || '—'}`;
      setStatus('Bedrock: бэкап treatment tags создан');
    } else if (r?.error && r.error !== 'cancel') {
      setStatus(`Bedrock: бэкап не создан — ${r.error}`);
    }
  });
  $('#brExpSearch')?.addEventListener('input', () => renderBedrockTreatmentsList());
  $('#modalBedrockExperiments')?.addEventListener('click', async (e) => {
    const b = e.target?.closest?.('button[data-br-exp-toggle]');
    if (!b) return;
    const tag = String(b.getAttribute('data-br-exp-toggle') || '');
    const on = String(b.getAttribute('data-on') || '0') === '1';
    const r = await window.noc?.bedrockTreatmentsSet?.(tag, !on);
    if (r?.ok) {
      const i = (state.bedrockTreatments || []).findIndex(x => x.tag === tag);
      if (i >= 0) state.bedrockTreatments[i].enabled = !on;
      renderBedrockTreatmentsList();
      setStatus('Bedrock: treatment tag обновлён');
    } else if (r?.error && r.error !== 'cancel') {
      setStatus(`Bedrock: ошибка treatment tag — ${r.error}`);
    }
  });
  $('#modalBedrockVirus')?.addEventListener('click', async (e) => {
    const b = e.target?.closest?.('button[data-virus-url]');
    if (!b) return;
    const url = String(b.getAttribute('data-virus-url') || '').trim();
    if (!url) return;
    const r = await window.noc?.webOpen?.({ key: 'bedrock-virus-scan', title: 'Проверка на вирусы', url });
    if (!r?.ok) {
      try { await window.noc?.shellOpenExternal?.(url); } catch (_) {}
    }
  });

  $('#btnCloseBedrockSettings')?.addEventListener('click', () => closeModal('modalBedrockSettings'));
  $('#btnBrOptionsRefresh')?.addEventListener('click', async () => renderBedrockOptions());
  $('#btnBrOptionsOpen')?.addEventListener('click', async () => {
    const r = await window.noc?.bedrockOptionsOpen?.();
    if (r?.ok && r.path) await window.noc?.openPath?.(r.path);
  });
  $('#btnBrPresetLow')?.addEventListener('click', async () => applyBedrockPreset('low'));
  $('#btnBrPresetMed')?.addEventListener('click', async () => applyBedrockPreset('medium'));
  $('#btnBrPresetHigh')?.addEventListener('click', async () => applyBedrockPreset('high'));
  $('#btnBrPresetUltra')?.addEventListener('click', async () => applyBedrockPreset('ultra'));
  $('#brOptSearch')?.addEventListener('input', () => renderBedrockOptionsList());
  $('#btnBrUsefulOnly')?.addEventListener('click', () => {
    state.bedrockUsefulOnly = !state.bedrockUsefulOnly;
    const b = $('#btnBrUsefulOnly');
    if (b) b.textContent = `Только полезные: ${state.bedrockUsefulOnly ? 'ВКЛ' : 'ВЫКЛ'}`;
    renderBedrockOptionsList();
  });

  // tab switching
  $('#bedrockContentTabs')?.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button[data-tab]');
    if (!b) return;
    setBedrockContentTab(String(b.dataset.tab || 'packs'));
  });

  $('#btnBedrockPackOpen')?.addEventListener('click', async () => {
    const kind = $('#bedrockPackKind')?.value || 'resourcePacks';
    await window.noc?.bedrockOpenContentFolder(kind);
  });
  $('#btnBedrockPackInstall')?.addEventListener('click', async () => {
    const kind = $('#bedrockPackKind')?.value || 'resourcePacks';
    setStatus('Bedrock: установка пака...');
    const r = await window.noc?.bedrockInstallPackFromFile(kind);
    if (r?.ok) setStatus('Bedrock: пак установлен. Открой игру, чтобы применить.');
    else if (r?.error && r.error !== 'cancel') setStatus(`Bedrock: ошибка установки — ${r.error}`);
  });

  $('#btnBedrockWorldOpen')?.addEventListener('click', async () => {
    await window.noc?.bedrockOpenContentFolder('worlds');
  });
  $('#btnBedrockWorldRefresh')?.addEventListener('click', async () => {
    await renderBedrockWorlds();
  });
  $('#btnBedrockWorldImport')?.addEventListener('click', async () => {
    setStatus('Bedrock: импорт мира...');
    const r = await window.noc?.bedrockImportWorld();
    if (r?.ok) {
      setStatus('Bedrock: мир импортирован.');
      await renderBedrockWorlds();
    } else if (r?.error && r.error !== 'cancel') {
      setStatus(`Bedrock: ошибка импорта — ${r.error}`);
    }
  });

  $('#btnBedrockSkinOpen')?.addEventListener('click', async () => {
    await window.noc?.bedrockOpenContentFolder('skins');
  });
  $('#btnBedrockSkinImport')?.addEventListener('click', async () => {
    setStatus('Bedrock: импорт скина...');
    const r = await window.noc?.bedrockImportSkin();
    if (r?.ok) {
      const el = $('#bedrockSkinLast');
      if (el) el.textContent = `Скин сохранён: ${r.path || '—'}`;
      setStatus('Bedrock: скин сохранён. Импортируй в игре.');
    } else if (r?.error && r.error !== 'cancel') {
      setStatus(`Bedrock: ошибка импорта — ${r.error}`);
    }
  });
  $('#btnCloseBedrockVersions')?.addEventListener('click', () => closeModal('modalBedrockVersions'));
  $('#btnBedrockInstallSelected')?.addEventListener('click', async () => {
    setStatus(`Bedrock Core: подготовка версии ${state.bedrockDemoSelected}...`);
    const setup = await window.noc.bedrockManagerSetup();
    if (!setup?.ok) {
      setStatus(`Ошибка подготовки Bedrock Core: ${setup?.error || 'unknown'}`);
      return;
    }

    const open = await window.noc.bedrockManagerOpen();
    if (!open?.ok) {
      setStatus(`Ошибка открытия Bedrock Core: ${open?.error || 'unknown'}`);
      return;
    }

    setStatus(`Bedrock Core открыт. Установи версию ${state.bedrockDemoSelected}.`);
  });

  // Here rollback button is used as: remove old version after installing new
  $('#btnBedrockRollback')?.addEventListener('click', async () => {
    const ok = window.confirm('Удалить текущую (старую) установленную версию Minecraft for Windows?');
    if (!ok) return;
    setStatus('Удаляю старую версию Bedrock...');
    const r = await window.noc.bedrockUninstall();
    if (r?.ok) setStatus('Старая версия удалена. Теперь можно установить новую через Bedrock Core.');
    else setStatus(`Ошибка удаления старой версии: ${r?.error || 'unknown'}`);
  });
  $('#btnBedrockUninstall')?.addEventListener('click', async () => {
    const ok = window.confirm('Удалить Minecraft for Windows (Bedrock) с этого ПК?');
    if (!ok) return;
    setStatus('Удаляю Bedrock...');
    const r = await window.noc.bedrockUninstall();
    if (r?.ok) {
      setStatus('Bedrock удалён.');
      const stateEl = document.getElementById('bedrockState');
      if (stateEl) stateEl.textContent = 'Minecraft for Windows удалён.';
      await refreshBedrockState();
    } else {
      setStatus(`Ошибка удаления Bedrock: ${r?.error || 'unknown'}`);
    }
  });
  $('#btnOpenOfficialBedrockMgr')?.addEventListener('click', async () => {
    const st = document.getElementById('bedrockMgrState');
    if (st) st.textContent = 'Статус: подготовка core...';
    const r = await window.noc.bedrockManagerSetup();
    if (r?.ok) {
      if (st) st.textContent = 'Статус: Bedrock Core готов';
      setStatus('Bedrock Core подготовлен (встроенный режим)');
    } else {
      if (st) st.textContent = `Статус: ошибка (${r?.error || 'unknown'})`;
      setStatus(`Ошибка подготовки Bedrock Core: ${r?.error || 'unknown'}`);
    }
  });

  $('#btnOpenLogs')?.addEventListener('click', async () => {
    const p = state.lastLogDir || state.lastLogPath || '';
    if (p) await window.noc.openPath(p);
  });

  $('#remember')?.addEventListener('change', async () => {
    // nick persistence is forced on by user request
    if ($('#remember')) $('#remember').checked = true;
    await window.noc.settingsSet({ rememberUsername: true });
    updateActionButton();
  });

  // onlineMode toggle скрыт

  $('#btnPickDir')?.addEventListener('click', async () => {
    const p = await window.noc.pickDir();
    if (p) {
      $('#gameDir').value = p;
      state.settings = await window.noc.settingsGet();
      applyMini();
      setStatus('Папка выбрана');
    }
  });

  $('#btnPickSkin')?.addEventListener('click', async () => {
    const p = await window.noc.pickSkin();
    if (!p) return;
    $('#offlineSkinPath').value = p;
    state.settings = await window.noc.settingsSet({ offlineSkinPath: p });
    addTimeline('🎨 Оффлайн скин выбран');
    await refreshHealthPanelLive();
  });

  $('#btnFetchSkinNick')?.addEventListener('click', async () => {
    const nick = ($('#skinNick')?.value || $('#username')?.value || state.settings?.lastUsername || '').trim();
    if (!nick) {
      setStatus('Введи ник скина или игровой ник');
      return;
    }
    setStatus(`Ищу скин для ${nick}...`);
    const r = await window.noc.fetchSkinByNick(nick);
    if (!r?.ok) {
      setStatus(`Скин не найден: ${r?.error || 'unknown'}`);
      return;
    }
    $('#offlineSkinPath').value = r.path || '';
    state.settings = await window.noc.settingsSet({ offlineSkinPath: r.path || '', skinNick: nick });
    addTimeline(`🎨 Скин по нику ${nick} найден и сохранён`);
    setStatus('Скин применён для оффлайн режима');
  });

  $('#skinMode')?.addEventListener('change', applySkinSettingsView);

  $('#btnSaveSettings')?.addEventListener('click', saveSettings);

  // instant toggles for critical options (works even if user forgets to press Save)
  $('#uiLowPower')?.addEventListener('change', async () => {
    const v = !!$('#uiLowPower')?.checked;
    try { state.settings = await window.noc.settingsSet({ uiLowPower: v }); } catch {}
    applyPerformanceMode();
    if (!v && !state.fxStarted) {
      try { initFX(); state.fxStarted = true; } catch {}
    }
  });
  $('#closeLauncherOnGameStart')?.addEventListener('change', async () => {
    const v = !!$('#closeLauncherOnGameStart')?.checked;
    try { state.settings = await window.noc.settingsSet({ closeLauncherOnGameStart: v }); } catch {}
  });
  $('#btnRefreshVersions')?.addEventListener('click', refreshVersions);
  $('#btnMoreVersions')?.addEventListener('click', () => { state.versionsLimit += 300; renderVersionsList(); });
  $('#typeFilter')?.addEventListener('change', renderVersionsList);
  $('#versionSearch')?.addEventListener('input', renderVersionsList);

  $('#btnPlay')?.addEventListener('click', doPlay);
  $('#btnStop')?.addEventListener('click', doStop);
  $('#btnBedrockAction')?.addEventListener('click', handleBedrockAction);

  $('#btnOpenDir')?.addEventListener('click', async () => {
    const dir = state.settings?.gameDir || '';
    if (dir) await window.noc.openPath(dir);
  });

  $('#btnMsLogin')?.addEventListener('click', msLogin);
  $('#btnMsConfirm')?.addEventListener('click', msConfirm);
  $('#btnLogout')?.addEventListener('click', logout);

  // Game diagnostics (last log tail)
  $('#btnGameDiag')?.addEventListener('click', async () => {
    try {
      const r = await window.noc.lastLog();
      const hintEl = document.getElementById('crashHint');
      const tailEl = document.getElementById('crashTail');
      const lp = document.getElementById('crashLogPath');
      if (hintEl) hintEl.textContent = 'Последние логи запуска (если игра закрывается — здесь будет причина)';
      if (tailEl) tailEl.value = (r?.tail || '').trim();
      if (lp) lp.value = r?.logPath || state.lastLogPath || '';
      state.lastLogPath = r?.logPath || state.lastLogPath;
      openModal('modalCrash');
    } catch (e) {
      setStatus(`Не удалось открыть логи: ${String(e?.message || e)}`);
    }
  });

  $('#btnAddCreatorFriendMain')?.addEventListener('click', async () => {
    const deep = 'xbox://profile?gamertag=GoshGame5696';
    const web = 'https://account.xbox.com/Profile?gamertag=GoshGame5696';
    try {
      const r = await window.noc.shellOpenExternal(deep);
      if (r?.ok) {
        setStatus('Открываю профиль Xbox в приложении: GoshGame5696');
        return;
      }
    } catch (_) {}
    try {
      await window.noc.shellOpenExternal(web);
      setStatus('Открываю профиль Xbox в браузере: GoshGame5696');
    } catch (_) {
      setStatus('Не удалось открыть профиль Xbox.');
    }
  });

  // Crash modal controls
  $('#btnCloseCrash')?.addEventListener('click', () => closeModal('modalCrash'));
  $('#btnOpenCrashLog')?.addEventListener('click', async () => {
    const p = ($('#crashLogPath')?.value || '').trim();
    if (p) await window.noc.openPath(p);
  });
  $('#btnOpenCrashFolder')?.addEventListener('click', async () => {
    const p = ($('#crashLogPath')?.value || '').trim();
    if (!p) return;
    // openPath on a directory opens it in Explorer
    const dir = p.replace(/[\\/][^\\/]+$/, '');
    if (dir) await window.noc.openPath(dir);
  });
  $('#btnCopyCrash')?.addEventListener('click', async () => {
    try {
      const hint = (document.getElementById('crashHint')?.textContent || '').trim();
      const lp = (document.getElementById('crashLogPath')?.value || '').trim();
      const tail = (document.getElementById('crashTail')?.value || '').trim();
      const text = `Hint: ${hint}\nLog: ${lp}\n\n${tail}`.trim();
      await navigator.clipboard.writeText(text);
      setStatus('Скопировано в буфер');
    } catch {
      setStatus('Не удалось скопировать (права буфера обмена)');
    }
  });

  $('#loaderMode')?.addEventListener('change', async () => {
    const loaderMode = $('#loaderMode').value || 'vanilla';
    let patch = { loaderMode };
    const base = $('#versionSelect')?.value || state.settings?.lastVersion || 'latest-release';
    if (loaderMode !== 'vanilla') {
      try {
        patch = { ...patch, ...(await chooseLoaderBuild(base)) };
      } catch (e) {
        setStatus(`Build не выбран: ${e?.message || e}`);
      }
    }
    state.settings = await window.noc.settingsSet(patch);
    setPickedVersionText();
    await refreshInstallState();
    await refreshHealthPanelLive();
  });

  $('#username')?.addEventListener('input', async () => {
    if (!state.settings?.account) applyAccountUI();
    updateActionButton();
    await refreshHealthPanelLive();
  });

  window.noc.onLog((d) => {
    logLine(d.type || 'info', d.message || '');
    if ((d.type || '').toLowerCase() === 'error') setRunning(false);
  });

  window.noc.onDownload((d) => {
    if (!d || $('#dlBox')?.classList.contains('hidden')) return;
    const overallPct = (typeof d.overallPercent === 'number') ? d.overallPercent : (d.total ? Math.floor((d.current / d.total) * 100) : 0);
    const pctClamped = Math.max(0, Math.min(100, overallPct));
    if ($('#dlBar')) $('#dlBar').style.width = `${pctClamped}%`;
    if ($('#dlText')) $('#dlText').textContent = `Установка: ${d.overallCurrent || d.current || 0}/${d.overallTotal || d.total || 0} • ${d.type || 'download'}`;
    if ($('#dlPct')) $('#dlPct').textContent = `${pctClamped}%`;
    if ($('#dlPath')) $('#dlPath').textContent = `Папка: ${d.installPath || state.settings?.gameDir || '—'}`;
    setStatus(`Установка… ${pctClamped}%`);
});

  window.noc.onMcState((s) => {
    if (!s) return;
    state.lastMcEventTs = Date.now();
    if (s.state === 'logpath') {
      state.lastLogPath = s.logPath || null;
      state.lastLogDir = s.logDir || null;
      if ($('#crashLogPath')) $('#crashLogPath').value = state.lastLogPath || '';
    }
    if (s.state === 'installing' || s.state === 'downloading') {
      showDlBox(true);
      updateActionButton();
    }
    if (s.state === 'launched') {
      addTimeline('🎮 Minecraft успешно запущен');
      setStatus('Minecraft запущен');
      setTimeout(() => showDlBox(false), 800);
      updateActionButton();
    }
    if (s.state === 'closed') {
      const code = (typeof s.code === 'number') ? s.code : null;
      addTimeline(code === 0 ? '🛑 Игра закрыта' : `⚠ Игра закрылась с кодом ${code}`);
      setStatus(code === 0 ? 'Minecraft закрыт' : 'Minecraft закрылся с ошибкой');
      setRunning(false);
      refreshInstallState();

      if (code !== 0) {
        const hintEl = document.getElementById('crashHint');
        const tailEl = document.getElementById('crashTail');
        const lp = document.getElementById('crashLogPath');
        if (hintEl) hintEl.textContent = s.hint || `Процесс закрылся с кодом ${code}`;
        if (tailEl) tailEl.value = (s.tail || '').trim();
        if (lp) lp.value = s.logPath || state.lastLogPath || '';
        state.lastLogPath = s.logPath || state.lastLogPath;
        openModal('modalCrash');
      }
    }
    if (s.state === 'error') {
      addTimeline(`❌ Ошибка запуска: ${s.error || 'unknown'}`);
      setStatus(`Ошибка: ${s.error || 'unknown'}`);
      showDlBox(false);
      setRunning(false);
      updateActionButton();

      const hintEl = document.getElementById('crashHint');
      const tailEl = document.getElementById('crashTail');
      const lp = document.getElementById('crashLogPath');
      if (hintEl) hintEl.textContent = s.error || 'Ошибка запуска';
      if (tailEl) tailEl.value = (s.tail || '').trim();
      if (lp) lp.value = s.logPath || state.lastLogPath || '';
      state.lastLogPath = s.logPath || state.lastLogPath;
      openModal('modalCrash');
    }
  });


  window.noc.onAuthCode((code) => {
    if (!code) return;
    // Keep latest device-code info so "Открыть вход" works even after reopening modal
    state.msPending = {
      user_code: code.user_code,
      verification_uri: code.verification_uri,
      message: code.message,
      expires_in: code.expires_in,
      ts: Date.now()
    };
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = code.message || `Открой: ${code.verification_uri} и введи код: ${code.user_code}`;
    const log = document.getElementById('authLog');
    if (log) {
      const line = `[${new Date().toLocaleTimeString()}] ${code.message || ('Код: ' + code.user_code + ' • ' + code.verification_uri)}`;
      state.authLog.push(line);
      if (state.authLog.length > 120) state.authLog = state.authLog.slice(-120);
      log.value = state.authLog.join('\n\n');
    }
    const btnOpen = document.getElementById('btnOpenAuthUrl');
    if (btnOpen) btnOpen.disabled = false;
  });

  window.noc.onAuthError((d) => {
    const msg = String(d?.error || 'Неизвестная ошибка авторизации');
    authDiag('Microsoft вход: ошибка', new Error(msg));
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = msg;
    const btnOpen = document.getElementById('btnOpenAuthUrl');
    if (btnOpen) btnOpen.disabled = true;
    const __b = $('#btnRetryAuth'); if(__b) __b.disabled = false;
    setStatus('Microsoft вход: ошибка');
  });


  ['modalVersions', 'modalSettings', 'modalCrash', 'modalBedrockVersions', 'modalBedrockContent', 'modalBedrockVirus', 'modalBedrockMsFix', 'modalBedrockExperiments', 'modalProfiles', 'modalAuth', 'modalVersionToolPick'].forEach((id) => {
    const m = document.getElementById(id);
    if (!m) return;
    m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(id); });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modalVersions')?.classList.contains('hidden')) closeModal('modalVersions');
    if (!$('#modalSettings')?.classList.contains('hidden')) closeModal('modalSettings');
    if (!$('#modalCrash')?.classList.contains('hidden')) closeModal('modalCrash');
    if (!$('#modalBedrockVersions')?.classList.contains('hidden')) closeModal('modalBedrockVersions');
    if (!$('#modalBedrockVirus')?.classList.contains('hidden')) closeModal('modalBedrockVirus');
    if (!$('#modalBedrockMsFix')?.classList.contains('hidden')) closeModal('modalBedrockMsFix');
    if (!$('#modalBedrockExperiments')?.classList.contains('hidden')) closeModal('modalBedrockExperiments');
    if (!$('#modalLocalServers')?.classList.contains('hidden')) closeModal('modalLocalServers');
    if (!$('#modalProfiles')?.classList.contains('hidden')) closeModal('modalProfiles');
    if (!$('#modalAuth')?.classList.contains('hidden')) closeModal('modalAuth');
  });

// Top10 controls
$('#btnAutoSetup')?.addEventListener('click', async () => {
  try {
    setStatus('Автонастройка...');
    // simple tier selection based on RAM
    const total = navigator.deviceMemory ? Math.round(navigator.deviceMemory) : null;
    let tier = 'normal';
    if (total && total <= 4) tier = 'lowend';
    if (total && total >= 16) tier = 'high';
    await window.noc.wizardAutoSetup({ tier, source: $('#downloadSource')?.value || 'auto' });
    await loadSettings();
    setStatus('Автонастройка применена');
  } catch (e) {
    setStatus(`Автонастройка: ${e?.message || e}`);
  }
});

async function refreshSnapshotsUI() {
  try {
    const res = await window.noc.snapshotsList();
    const sel = $('#snapshotSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const items = res?.items || [];
    if (!items.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Нет снимков';
      sel.appendChild(opt);
      return;
    }
    for (const s of items) {
      const opt = document.createElement('option');
      opt.value = s.id;
      const d = new Date(s.createdAt || Date.now());
      opt.textContent = `${d.toLocaleString()}${s.note ? ' — ' + s.note : ''}`;
      sel.appendChild(opt);
    }
  } catch {}
}

$('#btnSnapshot')?.addEventListener('click', async () => {
  try {
    setStatus('Создание снимка...');
    await window.noc.snapshotsCreate('manual');
    await refreshSnapshotsUI();
    setStatus('Снимок создан');
  } catch (e) { setStatus(`Снимок: ${e?.message || e}`); }
});

$('#btnRestoreSnapshot')?.addEventListener('click', async () => {
  try {
    const id = $('#snapshotSelect')?.value;
    if (!id) return setStatus('Снимок не выбран');
    setStatus('Откат...');
    await window.noc.snapshotsRestore(id);
    setStatus('Откат выполнен');
  } catch (e) { setStatus(`Откат: ${e?.message || e}`); }
});

$('#btnRepair')?.addEventListener('click', async () => {
  try {
    setStatus('Проверка файлов...');
    await window.noc.mcRepair({ version: state.settings?.lastVersion });
    setStatus('Проверка завершена');
  } catch (e) { setStatus(`Repair: ${e?.message || e}`); }
});

$('#btnFix')?.addEventListener('click', async () => {
  try {
    setStatus('Исправление...');
    await window.noc.mcFix({ version: state.settings?.lastVersion });
    setStatus('Исправлено');
  } catch (e) { setStatus(`Fix: ${e?.message || e}`); }
});

$('#btnExportInstance')?.addEventListener('click', async () => {
  try {
    setStatus('Экспорт...');
    const res = await window.noc.instanceExportZip();
    if (res?.path) {
      await window.noc.openPath(res.path);
      setStatus('Экспорт готов');
    } else setStatus('Экспорт готов');
  } catch (e) { setStatus(`Экспорт: ${e?.message || e}`); }
});

$('#btnImportDot')?.addEventListener('click', async () => {
  try {
    setStatus('Импорт из .minecraft...');
    const r = await window.noc.instanceImportDotMinecraft();
    if (r?.ok) setStatus('Импорт завершён');
    else if (r?.error && r.error !== 'cancel') setStatus(`Импорт: ${r.error}`);
    else setStatus('Импорт отменён');
  } catch (e) { setStatus(`Импорт: ${e?.message || e}`); }
});

// populate snapshots when opening settings
$('#btnOpenSettings')?.addEventListener('click', () => { setTimeout(refreshSnapshotsUI, 50); });


// Updates / Cleanup / Sync
$('#btnResources')?.addEventListener('click', async () => {
  const url = 'https://github.com/NocCorporation/NocLauncher';
  setStatus('Открываю обновления…');
  try {
    const r = await window.noc.webOpen({ key: 'updates', url, title: 'Обновления NocLauncher' });
    if (r?.ok) return;
  } catch (_) {}
  try { await window.noc.shellOpenExternal(url); } catch (_) {}
});
$('#btnCleanup')?.addEventListener('click', openCleanup);
$('#btnSyncSettings')?.addEventListener('click', openSync);

$('#btnCloseResources')?.addEventListener('click', () => closeModal('modalResources'));
$('#resKind')?.addEventListener('change', refreshResources);
$('#btnResRefresh')?.addEventListener('click', refreshResources);
$('#btnResOpenFolder')?.addEventListener('click', async () => { await window.noc.resourcesOpenFolder($('#resKind')?.value || 'resourcepacks'); });
$('#btnResInstall')?.addEventListener('click', async () => { await window.noc.resourcesInstallFromFile($('#resKind')?.value || 'resourcepacks'); await refreshResources(); });

$('#btnCloseCleanup')?.addEventListener('click', () => closeModal('modalCleanup'));
$('#btnCleanupScan')?.addEventListener('click', scanCleanup);
$('#btnCleanupRun')?.addEventListener('click', runCleanup);

$('#btnCloseSync')?.addEventListener('click', () => closeModal('modalSync'));
$('#btnSyncApply')?.addEventListener('click', applySync);

}

async function renderBedrockVersionsDemo() {
  const wrap = document.getElementById('bedrockVersionsList');
  const st = document.getElementById('bedrockMgrState');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (st) st.textContent = 'Статус: синхронизация с Bedrock Core...';
  const ms = await window.noc.bedrockManagerStatus();
  if (st) {
    if (!ms?.supported) st.textContent = 'Статус: только Windows';
    else if (ms?.installed) st.textContent = 'Статус: Bedrock Core готов';
    else st.textContent = 'Статус: Bedrock Core не установлен (скачается по кнопке)';
  }

  let versions = [];
  try {
    const vr = await window.noc.bedrockVersionsList();
    if (vr?.ok && Array.isArray(vr.versions) && vr.versions.length) {
      versions = vr.versions.slice(0, 20).map(v => ({ id: v.version, channel: v.channel }));
    }
  } catch (_) {}

  if (!versions.length) versions = state.bedrockDemoVersions;

  for (const v of versions) {
    const row = document.createElement('div');
    row.className = 'item mcItem';
    row.innerHTML = `
      <div class="mcItemLeft">
        <div class="mcVer mono">${v.id}</div>
        <div class="mcSub">Канал: ${v.channel} • синхронизировано с Bedrock Core</div>
      </div>
      <div class="mcItemRight">
        <button class="mcPickBtn" data-bedrock-install="${v.id}">Установить</button>
      </div>`;

    const installBtn = row.querySelector('[data-bedrock-install]');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        state.bedrockDemoSelected = v.id;
        setStatus(`Bedrock Core: подготавливаю установку версии ${v.id}...`);
        const setup = await window.noc.bedrockManagerSetup();
        if (!setup?.ok) {
          setStatus(`Ошибка подготовки Bedrock Core: ${setup?.error || 'unknown'}`);
          return;
        }
        const open = await window.noc.bedrockManagerOpen();
        if (!open?.ok) {
          setStatus(`Ошибка запуска Bedrock Core: ${open?.error || 'unknown'}`);
          return;
        }
        setStatus(`Bedrock Core открыт. Установи версию ${v.id}, затем можно удалить старую.`);
      });
    }

    wrap.appendChild(row);
  }
}

function setBedrockContentTab(tab) {
  const tabs = $$('#bedrockContentTabs .segBtn');
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#bedrockTabPacks')?.classList.toggle('hidden', tab !== 'packs');
  $('#bedrockTabWorlds')?.classList.toggle('hidden', tab !== 'worlds');
  $('#bedrockTabSkins')?.classList.toggle('hidden', tab !== 'skins');
}

async function renderBedrockWorlds() {
  const wrap = $('#bedrockWorldsList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const r = await window.noc?.bedrockListWorldsDetailed?.();
  const worlds = (r?.ok && Array.isArray(r.worlds)) ? r.worlds : [];
  if (!worlds.length) {
    wrap.innerHTML = '<div class="mcSub">Миров не найдено.</div>';
    return;
  }
  const fmtDate = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  };

  for (const w of worlds) {
    const row = document.createElement('div');
    row.className = 'item mcItem';
    const icon = w.iconDataUrl ? `<img class="brWorldIcon" src="${w.iconDataUrl}" alt="" />` : `<div class="brWorldIcon ph" aria-hidden="true"></div>`;
    row.innerHTML = `
      <div class="mcItemLeft" style="display:flex; gap:12px; align-items:flex-start;">
        ${icon}
        <div style="min-width:0;">
          <div class="mcVer">${escapeHtml(w.name || w.id)}</div>
          <div class="mcSub" style="margin-top:2px;">${escapeHtml(w.modeText || '—')} • ${escapeHtml(w.difficultyText || '—')} • ${escapeHtml(w.versionText || '—')}</div>
          <div class="mcSub" style="margin-top:6px; display:flex; gap:14px; flex-wrap:wrap;">
            <span class="mono">ID: ${escapeHtml(w.id)}</span>
            <span>Размер: ${escapeHtml(formatBytes(w.sizeBytes || 0))}</span>
            <span>Обновлён: ${escapeHtml(fmtDate(w.mtimeMs))}</span>
            ${w.seedText ? `<span class="mono">Seed: ${escapeHtml(w.seedText)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="mcItemRight" style="display:flex; gap:8px; align-items:center;">
        <button class="mcPickBtn" data-world-open="${escapeHtml(w.id)}">Папка</button>
        <button class="mcPickBtn" data-world-export="${escapeHtml(w.id)}">Скачать</button>
        <button class="mcPickBtn" data-world-delete="${escapeHtml(w.id)}">Удалить</button>
      </div>`;

    row.querySelector('[data-world-open]')?.addEventListener('click', async () => {
      const p = await window.noc?.bedrockWorldOpen?.(w.id);
      if (p?.ok && p.path) await window.noc?.openPath?.(p.path);
    });
    row.querySelector('[data-world-export]')?.addEventListener('click', async () => {
      setStatus('Bedrock: экспорт мира...');
      const ex = await window.noc?.bedrockExportWorld(w.id);
      if (ex?.ok) {
        setStatus('Bedrock: мир сохранён.');
        if (ex?.path) await window.noc?.openPath(ex.path);
      } else if (ex?.error && ex.error !== 'cancel') {
        setStatus(`Bedrock: ошибка экспорта — ${ex.error}`);
      }
    });
    row.querySelector('[data-world-delete]')?.addEventListener('click', async () => {
      const ok = window.confirm(`Удалить мир "${w.name}"?`);
      if (!ok) return;
      setStatus('Bedrock: удаление мира...');
      const del = await window.noc?.bedrockDeleteWorld(w.id);
      if (del?.ok) {
        setStatus('Bedrock: мир удалён.');
        await renderBedrockWorlds();
      } else {
        setStatus(`Bedrock: ошибка удаления — ${del?.error || 'unknown'}`);
      }
    });
    wrap.appendChild(row);
  }
}

async function renderBedrockContent(tab) {
  setBedrockContentTab(tab);
  const hint = $('#bedrockPathsHint');
  try {
    const r = await window.noc?.bedrockContentPaths();
    if (r?.ok) {
      if (hint) hint.textContent = `com.mojang: ${r.paths?.comMojang || '—'}`;
    } else {
      if (hint) hint.textContent = r?.error ? `Ошибка: ${r.error}` : 'Ошибка: paths';
    }
  } catch {
    if (hint) hint.textContent = 'Ошибка: paths';
  }

  if (tab === 'worlds') await renderBedrockWorlds();
}

// Bedrock options (options.txt)

async function renderBedrockOptions() {
  const hint = $('#bedrockOptionsHint');
  const list = $('#brOptionsList');
  if (list) list.innerHTML = '';
  const usefulBtn = $('#btnBrUsefulOnly');
  if (usefulBtn) usefulBtn.textContent = `Только полезные: ${state.bedrockUsefulOnly ? 'ВКЛ' : 'ВЫКЛ'}`;
  try {
    const r = await window.noc?.bedrockOptionsRead?.();
    if (!r?.ok) {
      if (hint) hint.textContent = `Не удалось прочитать options.txt: ${r?.error || 'unknown'}`;
      state.bedrockOptions = [];
      renderBedrockOptionsList();
      return;
    }
    state.bedrockOptions = r.items || [];
    if (hint) hint.textContent = `options.txt: ${r.path || '—'} • параметров: ${state.bedrockOptions.length}`;
    renderBedrockOptionsList();
  } catch (e) {
    state.bedrockOptions = [];
    if (hint) hint.textContent = `Не удалось прочитать options.txt: ${e?.message || e}`;
  }
}

const BEDROCK_OPTION_DESCRIPTIONS = {
  'mp_server_visible': 'Видимость твоего мира по сети. ВКЛ: мир могут видеть/находить по сети. ВЫКЛ: мир скрыт.',
  'mp_xboxlive_visible': 'Видимость мира для Xbox-друзей. ВКЛ: друзья видят и могут заходить. ВЫКЛ: через Xbox не видно.',
  'mp_nex_visible': 'Показывать мир в сетевых сервисах Nintendo/кроссплатформе. ВКЛ: виден. ВЫКЛ: скрыт.',
  'mp_psn_visible': 'Видимость мира для PSN/кроссплатформы. ВКЛ: доступнее для друзей. ВЫКЛ: скрыт.',
  'dvce_filestoragelocation': 'Где Bedrock хранит файлы мира/ресурсов (internal/external).',
  'gfx_viewdistance': 'Дальность прорисовки мира. Больше = красивее, но тяжелее для FPS.',
  'gfx_particleviewdistance': 'Дальность отображения частиц. Больше = эффектнее, но больше нагрузка.',
  'gfx_viewbobbing': 'Покачивание камеры при ходьбе. ВКЛ: живее, ВЫКЛ: стабильнее картинка (удобно для PvP).',
  'gfx_damagebobbing': 'Тряска камеры при получении урона. ВКЛ: кинематографично, ВЫКЛ: меньше дискомфорта.',
  'gfx_transparentleaves': 'Прозрачные листья. ВКЛ: красивее леса, ВЫКЛ: выше FPS.',
  'gfx_smoothlighting': 'Сглаженное освещение. ВКЛ: мягкие тени, ВЫКЛ: резкая "классическая" картинка и выше FPS.',
  'gfx_fancyskies': 'Расширенные эффекты неба. ВКЛ: красиво, ВЫКЛ: экономия ресурсов.',
  'gfx_toggleclouds': 'Отображение облаков. ВКЛ: больше атмосферы, ВЫКЛ: +FPS и чище обзор.',
  'gfx_max_framerate': 'Лимит FPS (0 = без лимита).',
  'gfx_vsync': 'Вертикальная синхронизация. ВКЛ: меньше разрывов кадра, но иногда больше задержка.',
  'gfx_showfps': 'Живой счётчик FPS в игре (в верхнем углу). ВКЛ: показывает текущий FPS.',
  'dev_debug_hud': 'Debug HUD (включает служебный оверлей, где виден FPS).',
  'gfx_field_of_view': 'Угол обзора (FOV). Выше = шире обзор, но сильнее искажение.',
  'gfx_particles': 'Количество частиц (эффекты).',
  'gfx_bloom': 'Эффект свечения (Bloom). ВКЛ: сочнее картинка, ВЫКЛ: выше производительность.',
  'gfx_fancygraphics': 'Расширенная графика. Красивее, но тяжелее.',
  'audio_main': 'Общая громкость.',
  'audio_music': 'Громкость музыки.',
  'audio_sound': 'Громкость игровых звуков.',
  'ctrl_sensitivity2_mouse': 'Чувствительность мыши.',
  'ctrl_sensitivity2_touch': 'Чувствительность касаний (тач).',
  'ctrl_sensitivity2_gamepad': 'Чувствительность геймпада.',
  'ctrl_invertmouse_mouse': 'Инверсия оси Y для мыши. ВКЛ: "вверх-вниз наоборот".',
  'ctrl_autojump_mouse': 'Автопрыжок. ВКЛ: игра прыгает сама у препятствий. ВЫКЛ: полный ручной контроль.',
  'show_advanced_video_settings': 'Показывать расширенные настройки графики. ВКЛ: больше опций в меню.',
  'game_language': 'Язык игры.',
  'game_difficulty_new': 'Уровень сложности мира.'
};

function humanizeBedrockOptionKey(key) {
  const k = String(key || '').toLowerCase();
  const dict = {
    gfx: 'Графика', audio: 'Звук', ctrl: 'Управление', mp: 'Сеть', game: 'Игра', ui: 'Интерфейс',
    viewdistance: 'дальность прорисовки', particleviewdistance: 'дальность частиц', particles: 'частицы',
    max: 'лимит/макс', framerate: 'частота кадров', vsync: 'вертикальная синхронизация',
    field: 'поле', of: ' ', view: 'обзора', fov: 'FOV', smooth: 'сглаживание', lighting: 'освещение',
    transparent: 'прозрачность', leaves: 'листвы', clouds: 'облака', bloom: 'свечение',
    sensitivity: 'чувствительность', mouse: 'мышь', touch: 'сенсор', gamepad: 'геймпад',
    invert: 'инверсия', autojump: 'автопрыжок', language: 'язык', difficulty: 'сложность',
    server: 'сервер', visible: 'видимость', xboxlive: 'Xbox Live', storage: 'хранилище', location: 'расположение'
  };
  return k.split('_').map(p => dict[p] || p).join(' ').replace(/\s+/g, ' ').trim();
}

function describeBedrockOption(key, fallback, isBool) {
  const k = String(key || '').toLowerCase();
  if (BEDROCK_OPTION_DESCRIPTIONS[k]) return BEDROCK_OPTION_DESCRIPTIONS[k] + (isBool ? ' | ВКЛ = активировано, ВЫКЛ = отключено.' : '');

  let scope = 'Системный параметр Bedrock';
  if (k.startsWith('gfx_')) scope = 'Параметр графики';
  else if (k.startsWith('audio_')) scope = 'Параметр звука';
  else if (k.startsWith('ctrl_')) scope = 'Параметр управления';
  else if (k.startsWith('mp_')) scope = 'Сетевой параметр';
  else if (k.startsWith('game_')) scope = 'Игровой параметр';
  else if (k.startsWith('ui_')) scope = 'Параметр интерфейса';

  const human = humanizeBedrockOptionKey(k);
  const base = `${scope}: ${human || k}. ${fallback ? '' : ''}`.trim();
  return isBool
    ? `${base} ВКЛ — функция работает, ВЫКЛ — функция отключена.`
    : `${base} Изменяй аккуратно, это влияет на поведение игры.`;
}

function isUsefulBedrockOptionKey(key) {
  const k = String(key || '').toLowerCase();
  if (BEDROCK_OPTION_DESCRIPTIONS[k]) return true;
  return /^(gfx_|audio_|ctrl_|mp_|game_language|game_difficulty|show_advanced|crossplatform_|screen_animations|dvce_filestoragelocation)/.test(k);
}

function renderBedrockOptionsList() {
  const list = $('#brOptionsList');
  if (!list) return;
  list.innerHTML = '';
  const q = String($('#brOptSearch')?.value || '').trim().toLowerCase();
  const items = (state.bedrockOptions || []).filter(it => {
    const k = String(it.key || '').toLowerCase();
    if (state.bedrockUsefulOnly && !isUsefulBedrockOptionKey(k)) return false;
    return !q || k.includes(q);
  });
  if (!items.length) {
    list.innerHTML = '<div class="mcSub">Ничего не найдено.</div>';
    return;
  }
  for (const it of items.slice(0, 220)) {
    const row = document.createElement('div');
    row.className = 'item mcItem';
    const rawVal = String(it.value ?? '').trim().toLowerCase();
    const isBool = ['0', '1', 'true', 'false'].includes(rawVal);
    const desc = describeBedrockOption(it.key, it.comment, isBool);

    if (isBool) {
      const isOn = (rawVal === '1' || rawVal === 'true');
      row.innerHTML = `
        <div class="mcItemLeft">
          <div class="mcVer mono" style="font-size:14px;">${escapeHtml(it.key)}</div>
          <div class="mcSub">${escapeHtml(desc)}</div>
        </div>
        <div class="mcItemRight" style="gap:8px; align-items:center;">
          <button class="mcPickBtn" data-br-toggle="${escapeHtml(it.key)}" style="min-width:96px;">${isOn ? 'ВКЛ' : 'ВЫКЛ'}</button>
        </div>`;

      const tgl = row.querySelector('button[data-br-toggle]');
      tgl?.addEventListener('click', async () => {
        const curr = String(it.value ?? '').trim().toLowerCase();
        const on = (curr === '1' || curr === 'true');
        const next = on ? '0' : '1';
        const r = await window.noc?.bedrockOptionsSet?.(it.key, next);
        if (r?.ok) {
          const idx = (state.bedrockOptions || []).findIndex(x => x.key === it.key);
          if (idx >= 0) state.bedrockOptions[idx].value = next;
          tgl.textContent = next === '1' ? 'ВКЛ' : 'ВЫКЛ';
          setStatus('Bedrock: настройки сохранены');
        } else if (r?.error && r.error !== 'cancel') {
          setStatus(`Bedrock: ошибка сохранения — ${r.error}`);
        }
      });
    } else {
      row.innerHTML = `
        <div class="mcItemLeft">
          <div class="mcVer mono" style="font-size:14px;">${escapeHtml(it.key)}</div>
          <div class="mcSub">${escapeHtml(desc)}</div>
        </div>
        <div class="mcItemRight" style="gap:8px;">
          <input class="inputMini mono" style="width:180px;" value="${escapeHtml(String(it.value ?? ''))}" data-br-opt="${escapeHtml(it.key)}" />
          <button class="mcPickBtn" data-br-save="${escapeHtml(it.key)}">Сохранить</button>
        </div>`;
      const inp = row.querySelector('input[data-br-opt]');
      const btn = row.querySelector('button[data-br-save]');
      const save = async () => {
        const v = String(inp?.value ?? '');
        const r = await window.noc?.bedrockOptionsSet?.(it.key, v);
        if (r?.ok) {
          setStatus('Bedrock: настройки сохранены');
          const idx = (state.bedrockOptions || []).findIndex(x => x.key === it.key);
          if (idx >= 0) state.bedrockOptions[idx].value = v;
        } else if (r?.error && r.error !== 'cancel') {
          setStatus(`Bedrock: ошибка сохранения — ${r.error}`);
        }
      };
      btn?.addEventListener('click', save);
      inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    }

    list.appendChild(row);
  }
  if ((state.bedrockOptions || []).length > 220) {
    const more = document.createElement('div');
    more.className = 'mcSub';
    more.textContent = 'Показаны первые 220 параметров (используй поиск, чтобы быстро найти нужный).';
    list.appendChild(more);
  }
}

async function applyBedrockPreset(name) {
  setStatus('Bedrock: применяю пресет…');
  const r = await window.noc?.bedrockOptionsApplyPreset?.(name);
  if (r?.ok) {
    setStatus(`Bedrock: пресет применён (${name}).`);
    await renderBedrockOptions();
  } else {
    setStatus(`Bedrock: ошибка пресета — ${r?.error || 'unknown'}`);
  }
}

function describeTreatmentTag(tag) {
  const t = String(tag || '').toLowerCase();
  const map = {
    'mc-enable-inbox': 'Входящие уведомления/инбокс в интерфейсе.',
    'mc-store-enableinbox': 'Интеграция инбокса в магазин.',
    'mc-new-disconnect-screen': 'Новый экран отключения от мира/сервера.',
    'mc-new-friends-drawer': 'Новый боковой блок друзей.',
    'mc-friends-in-worlds-tab': 'Показывать друзей во вкладке миров.',
    'mc-add-friends': 'Функции добавления друзей.',
    'mc-realms-button-2024': 'Новая версия кнопки Realms.',
    'mc-screenshots-gallery': 'Галерея скриншотов в клиенте.',
    'mc-screenshots-controls': 'Элементы управления скриншотами.',
    'mc-enable-gametips-feature': 'Игровые подсказки/советы.'
  };
  if (map[t]) return map[t];
  if (t.includes('friends')) return 'Функции друзей/социального списка.';
  if (t.includes('realms')) return 'Функции Realms и подписок.';
  if (t.includes('inbox') || t.includes('messaging')) return 'Уведомления/сообщения и связанный UX.';
  if (t.includes('store') || t.includes('marketplace') || t.includes('purchasing')) return 'Функции магазина/маркетплейса и покупок.';
  if (t.includes('screenshots')) return 'Функции скриншотов и медиа.';
  if (t.includes('profile') || t.includes('persona')) return 'Функции профиля/персонажа.';
  if (t.includes('pause') || t.includes('menu')) return 'Изменения паузы/меню.';
  if (t.includes('signaling') || t.includes('service') || t.includes('rpc')) return 'Служебная сеть/бэкенд-функция (лучше менять аккуратно).';
  return 'Служебный/экспериментальный тег Bedrock (A/B feature flag).';
}

async function renderBedrockTreatments() {
  const hint = $('#bedrockExpHint');
  const list = $('#brExpList');
  if (list) list.innerHTML = '';
  const r = await window.noc?.bedrockTreatmentsRead?.();
  if (!r?.ok) {
    state.bedrockTreatments = [];
    if (hint) hint.textContent = `Не удалось прочитать treatment tags: ${r?.error || 'unknown'}`;
    renderBedrockTreatmentsList();
    return;
  }
  state.bedrockTreatments = (r.tags || []).map(tag => ({ tag, enabled: true }));
  if (hint) hint.textContent = `Файл: ${r.path || '—'} • тегов: ${state.bedrockTreatments.length}`;
  renderBedrockTreatmentsList();
}

function renderBedrockTreatmentsList() {
  const list = $('#brExpList');
  if (!list) return;
  list.innerHTML = '';
  const q = String($('#brExpSearch')?.value || '').trim().toLowerCase();
  const items = (state.bedrockTreatments || []).filter(x => !q || String(x.tag || '').toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML = '<div class="mcSub">Ничего не найдено.</div>';
    return;
  }
  for (const it of items.slice(0, 600)) {
    const on = !!it.enabled;
    const row = document.createElement('div');
    row.className = 'item mcItem';
    row.innerHTML = `
      <div class="mcItemLeft">
        <div class="mcVer mono" style="font-size:14px;">${escapeHtml(it.tag)}</div>
        <div class="mcSub">${escapeHtml(describeTreatmentTag(it.tag))}</div>
      </div>
      <div class="mcItemRight" style="gap:8px; align-items:center;">
        <button class="mcPickBtn" data-br-exp-toggle="${escapeHtml(it.tag)}" data-on="${on ? '1' : '0'}" style="min-width:96px;">${on ? 'ВКЛ' : 'ВЫКЛ'}</button>
      </div>`;
    list.appendChild(row);
  }
}

async function loadInstalledProfiles() {
  const r = await window.noc.listInstalledProfiles();
  state.profiles = (r?.ok && Array.isArray(r.profiles)) ? r.profiles : [];
  return state.profiles;
}

function renderProfilesList() {
  const wrap = document.getElementById('profilesList');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!state.profiles.length) {
    wrap.innerHTML = '<div class="mcSub">Профилей пока нет.</div>';
    return;
  }

  for (const p of state.profiles) {
    const row = document.createElement('div');
    row.className = 'item mcItem';
    row.innerHTML = `
      <div class="mcItemLeft">
        <div class="mcVer mono">${p.id}</div>
        <div class="mcSub">Тип: ${p.kind}</div>
      </div>
      <div class="mcItemRight">
        <button class="mcPickBtn" data-launch-profile="${p.id}">Играть</button>
      </div>`;

    row.querySelector('[data-launch-profile]')?.addEventListener('click', async () => {
      document.getElementById('versionSelect').value = p.id;
      await window.noc.settingsSet({ lastProfileVersion: p.id, lastVersion: p.id });
      closeModal('modalProfiles');
      await doPlay();
    });

    wrap.appendChild(row);
  }
}

// quick start removed by user preference

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
  if (id === 'modalAuth') stopAuthStatusPoll();
}


async function openModsModal() {
  try { setLibraryTab(state.libraryTab); } catch {}
  // show title with current instance/version/loader
  const instId = state.settings?.activeInstanceId || 'default';
  const version = state.settings?.lastVersion || '(не выбрана версия)';
  const loader = (state.settings?.loaderMode || 'vanilla').toUpperCase();
  const tabLabel = state.libraryTab === 'mods' ? 'Моды' : (state.libraryTab === 'resourcepacks' ? 'Текстуры' : 'Шейдеры');
  $('#modsTitle').textContent = `Библиотека • ${tabLabel} • ${version} • ${loader} • ${instId}`;
  openModal('modsModal');
  await refreshLibraryInstalled();
  $('#modsSearch')?.focus();
}

function setLibraryTab(tab) {
  state.libraryTab = tab;
  // UI
  const wrap = document.getElementById('libraryTabs');
  wrap?.querySelectorAll('.segBtn')?.forEach(b => {
    const t = b.getAttribute('data-libtab');
    b.classList.toggle('active', t === tab);
  });
  // Controls: update-all/analyze/rollback are mods-only
  const modsOnly = (tab === 'mods');
  $('#modsUpdateAllBtn')?.classList.toggle('hidden', !modsOnly);
  $('#modsAnalyzeBtn')?.classList.toggle('hidden', !modsOnly);
  $('#modsRollbackBtn')?.classList.toggle('hidden', !modsOnly);
  $('#modsDisableLastBtn')?.classList.toggle('hidden', !modsOnly);

  // Placeholders
  const ph = tab === 'mods' ? 'Поиск модов…' : (tab === 'resourcepacks' ? 'Поиск текстур…' : 'Поиск шейдеров…');
  const si = $('#modsSearch');
  if (si) si.placeholder = ph;

  // Update title if modal is open
  if (!document.getElementById('modsModal')?.classList.contains('hidden')) {
    const instId = state.settings?.activeInstanceId || 'default';
    const version = state.settings?.lastVersion || '(не выбрана версия)';
    const loader = (state.settings?.loaderMode || 'vanilla').toUpperCase();
    const tabLabel = tab === 'mods' ? 'Моды' : (tab === 'resourcepacks' ? 'Текстуры' : 'Шейдеры');
    $('#modsTitle').textContent = `Библиотека • ${tabLabel} • ${version} • ${loader} • ${instId}`;
  }
}

async function refreshLibraryInstalled() {
  if (state.libraryTab === 'mods') return refreshModsInstalled();
  return refreshResourcesInstalled(state.libraryTab);
}

async function refreshResourcesInstalled(kind) {
  const listEl = $('#modsInstalledList');
  if (!listEl) return;
  listEl.innerHTML = '';
  setHint('modsHint', 'Загрузка…');
  const r = await window.noc.resourcesList(kind);
  const files = r?.files || [];
  setHint('modsHint', files.length ? `Файлов: ${files.length}` : 'Пусто');
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'listItem';

    const left = document.createElement('div');
    left.className = 'itemMain';
    const t = document.createElement('div');
    t.className = 'itemTitle';
    t.textContent = f.name || f.filename || f;
    const s = document.createElement('div');
    s.className = 'itemSub';
    const mb = (Number(f.sizeMB || 0) || 0).toFixed(2);
    s.textContent = mb && mb !== '0.00' ? `${mb} MB` : '';
    left.appendChild(t);
    left.appendChild(s);

    const btns = document.createElement('div');
    btns.className = 'itemBtns';

    const del = document.createElement('button');
    del.className = 'btn btnSmall';
    del.textContent = 'Удалить';
    del.onclick = async () => {
      await window.noc.resourcesRemove(kind, f.name || f.filename || f);
      await refreshResourcesInstalled(kind);
    };
    btns.appendChild(del);

    row.appendChild(left);
    row.appendChild(btns);
    listEl.appendChild(row);
  }
}

function setHint(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

async function refreshModsInstalled() {
  const listEl = $('#modsInstalledList');
  if (!listEl) return;
  listEl.innerHTML = '';
  setHint('modsHint', 'Загрузка списка модов...');
  const r = await window.noc.modsList();
  const mods = r?.mods || [];
  setHint('modsHint', mods.length ? `Модов: ${mods.length}` : 'Моды не установлены');
  for (const m of mods) {
    const row = document.createElement('div');
    row.className = 'listItem';

    const left = document.createElement('div');
    left.className = 'itemMain';
    const t = document.createElement('div');
    t.className = 'itemTitle';
    t.textContent = m.displayName || m.filename;
    const s = document.createElement('div');
    s.className = 'itemSub';
    s.textContent = `${m.enabled ? 'включен' : 'выключен'} • ${(m.sizeMB||0).toFixed(2)} MB` + (m.source ? ` • ${m.source}` : '');
    left.appendChild(t); left.appendChild(s);

    const btns = document.createElement('div');
    btns.className = 'itemBtns';

    const tg = document.createElement('span');
    tg.className = 'tag';
    tg.textContent = m.enabled ? 'ON' : 'OFF';
    btns.appendChild(tg);

    const toggle = document.createElement('button');
    toggle.className = 'btn btnSmall';
    toggle.textContent = m.enabled ? 'Выключить' : 'Включить';
    toggle.onclick = async () => {
      await window.noc.modsToggle({ filename: m.filename, enabled: !m.enabled });
      await refreshModsInstalled();
    };
    btns.appendChild(toggle);

    const del = document.createElement('button');
    del.className = 'btn btnSmall';
    del.textContent = 'Удалить';
    del.onclick = async () => {
      await window.noc.modsRemove(m.filename);
      await refreshModsInstalled();
    };
    btns.appendChild(del);

    row.appendChild(left);
    row.appendChild(btns);
    listEl.appendChild(row);
  }
}


function renderModsIssues(issues) {
  const el = document.getElementById('modsIssues');
  if (!el) return;
  el.innerHTML = '';
  if (!issues || !issues.length) return;
  for (const it of issues) {
    const row = document.createElement('div');
    row.className = 'row';
    const t = document.createElement('div');
    t.className = 'rowTitle';
    t.textContent = it.message || it.type || 'Проблема';
    const s = document.createElement('div');
    s.className = 'rowSub';
    const parts = [];
    if (it.file) parts.push('Файл: ' + it.file);
    if (it.dep) parts.push('Зависимость: ' + it.dep);
    if (it.id) parts.push('ID: ' + it.id);
    if (it.files && Array.isArray(it.files)) parts.push('Файлы: ' + it.files.join(', '));
    s.textContent = parts.join(' • ');
    row.appendChild(t);
    row.appendChild(s);
    el.appendChild(row);
  }
}

async function doModsSearch() {
  const q = String($('#modsSearch')?.value || '').trim();
  if (!q) { setHint('modsHint', 'Введите запрос'); return; }

  const resEl = $('#modsSearchList');
  if (resEl) resEl.innerHTML = '';
  setHint('modsHint', 'Поиск...');

  const mcVersion = getSelectedBaseVersion();
  const loader = String($('#loaderMode')?.value || state.settings?.loaderMode || 'vanilla');

  let items = [];
  try {
    if (state.libraryTab === 'mods') {
      const resp = await window.noc.modsSearch(q);
      items = resp?.hits || [];
    } else {
      const resp = await window.noc.resourcesSearchModrinth({ kind: state.libraryTab, query: q, mcVersion, loader });
      items = resp?.hits || [];
    }
  } catch (e) {
    setHint('modsHint', 'Ошибка поиска');
    logLine('error', e?.message || e);
    return;
  }

  setHint('modsHint', items.length ? `Найдено: ${items.length}` : 'Ничего не найдено');

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'rowItem';
    const title = document.createElement('div');
    title.className = 'rowTitle';
    title.textContent = it.title || it.name || it.slug || String(it.project_id || it.id);

    const sub = document.createElement('div');
    sub.className = 'rowSub';
    sub.textContent = it.description || it.summary || '';

    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = 'Установить';
    btn.onclick = async () => {
      try {
        setHint('modsHint', 'Установка...');
        if (state.libraryTab === 'mods') {
          const r2 = await window.noc.modsInstallModrinth({ projectId: it.project_id });
          if (!r2?.ok) throw new Error(r2?.error || 'install failed');
          await refreshModsInstalled();
        } else {
          const r2 = await window.noc.resourcesInstallModrinth({ kind: state.libraryTab, projectId: it.project_id, mcVersion, loader });
          if (!r2?.ok) throw new Error(r2?.error || 'install failed');
          await refreshResourcesInstalled(state.libraryTab);
        }
        setHint('modsHint', 'Готово');
      } catch (e) {
        setHint('modsHint', 'Ошибка установки');
        logLine('error', e?.message || e);
      }
    };

    row.appendChild(title);
    row.appendChild(sub);
    row.appendChild(btn);
    resEl?.appendChild(row);
  }
}


(async function init() {
  try { wireUI(); } catch (e) { console.error(e); }
  await loadSettings();
  try {
    applyPerformanceMode();
    if (!state.settings?.uiLowPower && !state.fxStarted) {
      initFX();
      state.fxStarted = true;
    }
  } catch (e) { console.error(e); }

  // Fill UI immediately from settings (avoid "пустой лаунчер")
  try { applyMini(); } catch {}

  await refreshVersions();
  await refreshInstallState();
  setMode('java');
  $('#btnAuthDiag')?.classList.add('hidden');

  // Mark ready only if we have versions (otherwise keep error status)
  if (state.manifest?.versions?.length) {
    setStatus('Готов');
    addTimeline('✨ NocLauncher готов к запуску');
  }

  await refreshHealthPanelLive();

  // Lightweight UI refresh (adaptive frequency)
  setInterval(() => {
    if (document.hidden) return;
    try { applyMini(); } catch {}
    try {
      // in low-power mode avoid frequent health/network work
      if (!state.settings?.uiLowPower) refreshHealthPanelLive();
    } catch {}
  }, state.settings?.uiLowPower ? 30000 : 10000);
})();
