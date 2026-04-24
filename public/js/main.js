/* ── State ─────────────────────────────────────────────────── */
let serverIP = 'play.furiousin.com';
let discordURL = '#';

/* ── Init ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initMobileMenu();
  initScrollAnimations();
  loadStats();
  loadDonors();
  setInterval(loadDonors, 30000);
});

/* ── API ───────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const r = await fetch('/api/stats');
    const { data } = await r.json();
    serverIP = data.server_ip + ':' + data.server_port;
    discordURL = data.discord_url || '#';
    const ipEl = document.getElementById('serverIPDisplay');
    if (ipEl) ipEl.textContent = serverIP;
    ['navDiscord', 'discordFooterLink', 'discordFooterLink2'].forEach(id => {
      const a = document.getElementById(id);
      if (a) a.href = discordURL;
    });
    animateCounter('statOnline', data.players_online);
    animateCounter('statTotal', data.total_players);
    animateCounter('statFactions', data.active_factions);
    animateCounter('statChars', data.total_characters);
  } catch (e) { console.error('Error loading stats', e); }
}

async function loadDonors() {
  const grid = document.getElementById('donorsGrid');
  if (!grid) return;
  try {
    const r = await fetch('/api/donors');
    const { data } = await r.json();
    if (!data || !data.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--muted);">¡Sé el primero en donar y aparecer aquí!</div>';
      return;
    }
    const medals = ['🥇','🥈','🥉'];
    const topClass = ['donor-top-1','donor-top-2','donor-top-3'];
    grid.innerHTML = data.map((d, i) => {
      const avatar = d.avatar_url
        ? `<img src="${esc(d.avatar_url)}" alt="${esc(d.username)}" class="donor-avatar" onerror="this.outerHTML='<div class=\\'donor-avatar\\'>👤</div>'">`
        : `<div class="donor-avatar">👤</div>`;
      return `
        <div class="donor-card${i < 3 ? ' ' + topClass[i] : ''} fade-in">
          <div class="donor-rank-num">${medals[i] || '#' + (i + 1)}</div>
          ${avatar}
          <div class="donor-info">
            <div class="donor-name">${esc(d.username)}</div>
            ${d.discord ? `<div class="donor-discord">💬 ${esc(d.discord)}</div>` : ''}
            ${d.message ? `<div class="donor-message">"${esc(d.message)}"</div>` : ''}
          </div>
          <div class="donor-amount">$${parseFloat(d.amount).toFixed(2)}</div>
        </div>`;
    }).join('');
    setTimeout(() => grid.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible')), 50);
  } catch (_) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--muted);">Error al cargar donadores.</div>';
  }
}

/* ── Helpers ───────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 1500, start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.floor((1 - Math.pow(1 - progress, 3)) * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
function copyServerIP() {
  if (!serverIP) { showToast('Servidor no disponible'); return; }
  navigator.clipboard.writeText(serverIP)
    .then(() => showToast('✓ IP copiada: ' + serverIP))
    .catch(() => showToast('IP del servidor: ' + serverIP));
}
function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

/* ── Navbar ────────────────────────────────────────────────── */
function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 50), { passive: true });
}
function initMobileMenu() {
  const toggle = document.getElementById('mobileToggle');
  const links  = document.getElementById('navLinks');
  if (toggle && links) toggle.addEventListener('click', () => links.classList.toggle('open'));
}

/* ── Scroll Animations ─────────────────────────────────────── */
function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
}
