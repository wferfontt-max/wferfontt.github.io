/* ── State ─────────────────────────────────────────────────── */
let currentPage = 'dashboard';
let currentAdmin = null;
let modalMode = null; // 'add' | 'edit'
let modalEntity = null;
let editingId = null;
let allPlayers = []; // for character dropdowns
let allFactions = []; // for character dropdowns
let settingsData = {};

/* ── Init ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupNav();
  await loadPage('dashboard');
});

async function checkAuth() {
  try {
    const r = await api('GET', '/api/auth/me');
    currentAdmin = r.data;
    document.getElementById('adminName').textContent = currentAdmin.username;
    document.getElementById('adminRole').textContent = currentAdmin.role;
    document.getElementById('adminAvatar').textContent = currentAdmin.username[0].toUpperCase();
    if (currentAdmin.role !== 'superadmin') {
      document.querySelector('[data-page="admins"]').style.display = 'none';
    }
  } catch (e) {
    window.location.href = '/admin/login';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/admin/login';
}

function setupNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });
}

/* ── Page Navigation ───────────────────────────────────────── */
const pageTitles = {
  dashboard: 'DASHBOARD', news: 'NOTICIAS', players: 'JUGADORES',
  characters: 'PERSONAJES', factions: 'FACCIONES', team: 'EQUIPO',
  rules: 'REGLAS', store: 'TIENDA', forum: 'FORO', items: 'ITEMS',
  settings: 'CONFIGURACIÓN', admins: 'ADMINISTRADORES',
  usuarios: 'USUARIOS WEB', compras: 'COMPRAS',
};

async function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[page] || page.toUpperCase();
  currentPage = page;
  await loadPage(page);
}

async function loadPage(page) {
  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'news': await loadNews(); break;
    case 'players': await loadPlayers(); break;
    case 'characters': await loadCharacters(); break;
    case 'factions': await loadFactions(); break;
    case 'team': await loadTeam(); break;
    case 'rules': await loadRules(); break;
    case 'store': await loadStore(); break;
    case 'forum': await loadForum(); break;
    case 'items': await loadItems(); break;
    case 'settings': await loadSettings(); break;
    case 'admins': await loadAdmins(); break;
    case 'usuarios': await loadUsuarios(); break;
    case 'compras': await loadCompras(); break;
  }
}

/* ── API helper ────────────────────────────────────────────── */
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

/* ── Dashboard ─────────────────────────────────────────────── */
async function loadDashboard() {
  try {
    const { data } = await api('GET', '/api/admin/stats');
    const { stats, recent_activity } = data;

    document.getElementById('dashStats').innerHTML = [
      ['Jugadores', stats.players, 'primary'],
      ['Activos', stats.active_players, 'success'],
      ['Baneados', stats.banned_players, 'danger'],
      ['Personajes', stats.characters, 'primary'],
      ['Facciones', stats.factions, 'primary'],
      ['Noticias', stats.news, 'primary'],
      ['Pendientes WL', stats.pending_whitelist, 'warning'],
      ['Admins', stats.admins, 'muted'],
    ].map(([label, value, cls]) => `
      <div class="stat-card">
        <div class="stat-card-label">${label}</div>
        <div class="stat-card-value ${cls}">${value ?? 0}</div>
      </div>
    `).join('');

    const actionIcons = { LOGIN:'🔑', CREATE_NEWS:'📰', UPDATE_NEWS:'✏️', DELETE_NEWS:'🗑️', CREATE_PLAYER:'👤', UPDATE_PLAYER:'✏️', DELETE_PLAYER:'🗑️', CREATE_FACTION:'⚔️', UPDATE_SETTINGS:'⚙️', CREATE_RULE:'📋', CREATE_CHARACTER:'🎭', CREATE_ADMIN:'🔑' };

    document.getElementById('activityList').innerHTML = recent_activity.length
      ? recent_activity.slice(0,12).map(a => `
          <div class="activity-item">
            <div class="activity-icon">${actionIcons[a.action] || '●'}</div>
            <div class="activity-body">
              <div class="activity-text">${esc(a.details || a.action)}</div>
              <div class="activity-meta">${esc(a.admin_username || 'Sistema')} · ${fmtDate(a.created_at)}</div>
            </div>
          </div>
        `).join('')
      : '<div class="empty-state"><span class="empty-icon">📋</span>Sin actividad reciente</div>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── News ──────────────────────────────────────────────────── */
async function loadNews() {
  try {
    const { data } = await api('GET', '/api/admin/news');
    const cats = { general:'General', update:'Actualización', event:'Evento', urgent:'Urgente' };
    const catBadge = { general:'info', update:'success', event:'info', urgent:'danger' };
    document.getElementById('newsTable').innerHTML = data.length
      ? data.map(n => `
        <tr data-title="${esc(n.title)}" data-excerpt="${esc(n.excerpt||'')}">
          <td style="max-width:260px;"><strong style="color:var(--text-bright)">${esc(n.title)}</strong></td>
          <td><span class="badge badge-${catBadge[n.category]||'muted'}">${cats[n.category]||n.category}</span></td>
          <td>${esc(n.author)}</td>
          <td><span class="badge badge-${n.is_published?'success':'muted'}">${n.is_published?'Publicado':'Borrador'}</span></td>
          <td>${n.views}</td>
          <td>${fmtDate(n.created_at)}</td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('news',${n.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('news',${n.id},'${esc(n.title)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty-state"><span class="empty-icon">📰</span>Sin noticias</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Players ───────────────────────────────────────────────── */
async function loadPlayers() {
  try {
    const { data } = await api('GET', '/api/admin/players');
    allPlayers = data;
    const wlBadge = { approved:'success', pending:'warning', rejected:'danger' };
    const stBadge = { active:'success', warned:'warning', banned:'danger' };
    document.getElementById('playersTable').innerHTML = data.length
      ? data.map(p => `
        <tr data-username="${esc(p.username)}" data-email="${esc(p.email||'')}" data-steam_id="${esc(p.steam_id||'')}">
          <td><strong style="color:var(--text-bright)">${esc(p.username)}</strong></td>
          <td><code style="font-size:.75rem;color:var(--muted)">${esc(p.steam_id||'—')}</code></td>
          <td><span class="badge badge-${wlBadge[p.whitelist_status]||'muted'}">${p.whitelist_status}</span></td>
          <td><span class="badge badge-${stBadge[p.status]||'muted'}">${p.status}</span></td>
          <td>${p.total_hours}h</td>
          <td>${p.warnings}</td>
          <td>${fmtDate(p.joined_at)}</td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('players',${p.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('players',${p.id},'${esc(p.username)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty-state"><span class="empty-icon">👥</span>Sin jugadores</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Characters ────────────────────────────────────────────── */
async function loadCharacters() {
  try {
    await loadFactionsList();
    const { data } = await api('GET', '/api/admin/characters');
    const stBadge = { active:'success', dead:'danger', inactive:'muted' };
    document.getElementById('charsTable').innerHTML = data.length
      ? data.map(c => `
        <tr data-name="${esc(c.name)}" data-player_username="${esc(c.player_username||'')}" data-occupation="${esc(c.occupation||'')}">
          <td><strong style="color:var(--text-bright)">${esc(c.name)}</strong></td>
          <td>${esc(c.player_username||'—')}</td>
          <td>${c.age||'—'}</td>
          <td>${esc(c.faction_name||'Sin facción')}</td>
          <td>${esc(c.occupation||'—')}</td>
          <td><span class="badge badge-${stBadge[c.status]||'muted'}">${c.status}</span></td>
          <td>${fmtDate(c.created_at)}</td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('characters',${c.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('characters',${c.id},'${esc(c.name)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty-state"><span class="empty-icon">🎭</span>Sin personajes</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Factions ──────────────────────────────────────────────── */
async function loadFactions() {
  try {
    const { data } = await api('GET', '/api/admin/factions');
    allFactions = data;
    const typeLabel = { police:'Policía', emergency:'Emergencias', criminal:'Criminal', civilian:'Civil' };
    document.getElementById('factionsTable').innerHTML = data.length
      ? data.map(f => `
        <tr>
          <td><span class="color-dot" style="background:${f.color};box-shadow:0 0 6px ${f.color}80"></span></td>
          <td><strong style="color:var(--text-bright)">${esc(f.name)}</strong></td>
          <td><code style="font-size:.75rem;color:${f.color}">${esc(f.short_name||'—')}</code></td>
          <td>${typeLabel[f.type]||f.type}</td>
          <td>${esc(f.leader||'—')}</td>
          <td>${f.member_count}</td>
          <td><span class="badge badge-${f.is_active?'success':'muted'}">${f.is_active?'Activa':'Inactiva'}</span></td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('factions',${f.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('factions',${f.id},'${esc(f.name)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty-state"><span class="empty-icon">⚔️</span>Sin facciones</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadFactionsList() {
  if (!allFactions.length) {
    const { data } = await api('GET', '/api/admin/factions');
    allFactions = data;
  }
}

/* ── Team ──────────────────────────────────────────────────── */
async function loadTeam() {
  try {
    const { data } = await api('GET', '/api/admin/team');
    const roleBadge = { founder:'warning', cofounder:'muted', developer:'info', staff:'primary', moderator:'muted', admin:'danger' };
    const roleLabel = { founder:'Fundador', cofounder:'Co-Fundador', developer:'Desarrollador', staff:'Staff', moderator:'Moderador', admin:'Admin' };
    document.getElementById('teamTable').innerHTML = data.length
      ? data.map(t => `
        <tr>
          <td>${t.member_order}</td>
          <td><strong style="color:var(--text-bright)">${esc(t.name)}</strong></td>
          <td>${esc(t.title)}</td>
          <td><span class="badge badge-${roleBadge[t.role]||'muted'}">${roleLabel[t.role]||t.role}</span></td>
          <td>${esc(t.discord||'—')}</td>
          <td>${esc(t.joined_date||'—')}</td>
          <td><span class="badge badge-${t.is_active?'success':'muted'}">${t.is_active?'Activo':'Inactivo'}</span></td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('team',${t.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('team',${t.id},'${esc(t.name)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty-state"><span class="empty-icon">👥</span>Sin miembros</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Rules ─────────────────────────────────────────────────── */
async function loadRules() {
  try {
    const { data } = await api('GET', '/api/admin/rules');
    document.getElementById('rulesTable').innerHTML = data.length
      ? data.map(r => `
        <tr>
          <td>${r.rule_order}</td>
          <td>${esc(r.category)}</td>
          <td><strong style="color:var(--text-bright)">${esc(r.title)}</strong></td>
          <td><span class="badge badge-${r.is_active?'success':'muted'}">${r.is_active?'Activa':'Inactiva'}</span></td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('rules',${r.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('rules',${r.id},'${esc(r.title)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty-state"><span class="empty-icon">📋</span>Sin reglas</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Settings ──────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const { data } = await api('GET', '/api/admin/settings');
    settingsData = {};
    data.forEach(s => settingsData[s.key] = s);
    const regular   = data.filter(s => !s.key.startsWith('story_') && !s.key.startsWith('feature'));
    const story     = data.filter(s =>  s.key.startsWith('story_'));
    const features  = data.filter(s =>  s.key.startsWith('feature'));
    document.getElementById('settingsGrid').innerHTML =
      regular.map(s => `
        <div class="settings-item">
          <label>${esc(s.description || s.key)}</label>
          <div class="setting-desc">Clave: <code>${esc(s.key)}</code></div>
          <input type="${s.key === 'smtp_pass' ? 'password' : 'text'}" id="setting-${s.key}" value="${esc(s.value)}" />
        </div>
      `).join('') +
      (story.length ? `
        <div class="settings-item" style="grid-column:1/-1;border-top:1px solid rgba(255,255,255,0.08);padding-top:22px;margin-top:12px;">
          <label style="font-size:1.05rem;color:var(--accent)">Historia del Servidor</label>
          <div class="setting-desc">Edita el texto de la sección de historia en la página principal</div>
        </div>` +
        story.map(s => `
          <div class="settings-item" style="grid-column:1/-1;">
            <label>${esc(s.description || s.key)}</label>
            <div class="setting-desc">Clave: <code>${esc(s.key)}</code></div>
            <textarea id="setting-${s.key}" rows="${s.value.split('\n').length > 3 ? 7 : 3}" style="width:100%;background:var(--bg-card);border:1px solid rgba(255,255,255,0.1);color:var(--text);padding:10px 12px;border-radius:6px;font-size:.875rem;line-height:1.6;resize:vertical;">${esc(s.value)}</textarea>
          </div>
        `).join('') : '') +
      (features.length ? `
        <div class="settings-item" style="grid-column:1/-1;border-top:1px solid rgba(255,255,255,0.08);padding-top:22px;margin-top:12px;">
          <label style="font-size:1.05rem;color:var(--accent)">Características del Servidor</label>
          <div class="setting-desc">Edita las 6 tarjetas de características de la página principal</div>
        </div>` +
        features.map(s => `
          <div class="settings-item">
            <label>${esc(s.description || s.key)}</label>
            <input type="text" id="setting-${s.key}" value="${esc(s.value)}" />
          </div>
        `).join('') : '');
  } catch (e) { showToast(e.message, 'error'); }
}

async function saveSettings() {
  const settings = {};
  Object.keys(settingsData).forEach(key => {
    const el = document.getElementById(`setting-${key}`);
    if (el) settings[key] = el.value;
  });
  try {
    await api('PUT', '/api/admin/settings', { settings });
    showToast('Configuración guardada', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Admins ────────────────────────────────────────────────── */
async function loadAdmins() {
  try {
    const { data } = await api('GET', '/api/admin/admins');
    const roleBadge = { superadmin:'danger', admin:'warning', moderator:'info' };
    document.getElementById('adminsTable').innerHTML = data.length
      ? data.map(a => `
        <tr>
          <td><strong style="color:var(--text-bright)">${esc(a.username)}</strong></td>
          <td>${esc(a.email)}</td>
          <td><span class="badge badge-${roleBadge[a.role]||'muted'}">${a.role}</span></td>
          <td>${a.last_login ? fmtDate(a.last_login) : 'Nunca'}</td>
          <td><span class="badge badge-${a.is_active?'success':'muted'}">${a.is_active?'Activo':'Inactivo'}</span></td>
          <td><div class="td-actions">
            ${a.id !== currentAdmin?.id ? `<button class="btn-delete" onclick="confirmDelete('admins',${a.id},'${esc(a.username)}')">Desactivar</button>` : '<span style="font-size:.75rem;color:var(--muted)">Tú</span>'}
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty-state"><span class="empty-icon">🔑</span>Sin admins</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Rich Text Editor ──────────────────────────────────────── */
let _richSel = null;

function saveRichSel() {
  const s = window.getSelection();
  if (s && s.rangeCount > 0) _richSel = s.getRangeAt(0).cloneRange();
}
function restoreRichSel() {
  if (!_richSel) return;
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(_richSel);
}

function rfmt(cmd, val) {
  restoreRichSel();
  document.execCommand(cmd, false, val !== undefined ? val : null);
  updateRichToolbarState();
}
function rfmtBlock(sel) {
  if (!sel.value) return;
  rfmt('formatBlock', sel.value);
  sel.value = '<p>';
}
function rfmtSize(sel) {
  if (!sel.value) return;
  rfmt('fontSize', sel.value);
  sel.value = '3';
}
function rfmtColor(input) {
  const editor = document.querySelector('.rich-editor[contenteditable]');
  if (editor) editor.focus();
  restoreRichSel();
  document.execCommand('foreColor', false, input.value);
}
function rfmtJustify() {
  restoreRichSel();
  const sel = window.getSelection();
  const editor = document.querySelector('.rich-editor[contenteditable]');
  if (!editor) return;
  if (!sel || !sel.rangeCount) {
    editor.querySelectorAll('p,div,h1,h2,h3,li,blockquote').forEach(el => { el.style.textAlign = 'justify'; });
    updateRichToolbarState(); return;
  }
  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  if (node === editor) {
    editor.querySelectorAll('p,div,h1,h2,h3,li,blockquote').forEach(el => {
      if (range.intersectsNode(el)) el.style.textAlign = el.style.textAlign === 'justify' ? '' : 'justify';
    });
  } else {
    while (node && node !== editor && !['P','DIV','H1','H2','H3','LI','BLOCKQUOTE'].includes(node.tagName)) node = node.parentNode;
    if (node && node !== editor) node.style.textAlign = node.style.textAlign === 'justify' ? '' : 'justify';
  }
  updateRichToolbarState();
}
function rfmtLink() {
  restoreRichSel();
  const url = prompt('URL del enlace (ej: https://ejemplo.com):');
  if (url) document.execCommand('createLink', false, url);
}
function updateRichToolbarState() {
  const cmds = ['bold','italic','underline','strikeThrough','justifyLeft','justifyCenter','justifyRight','justifyFull','insertUnorderedList','insertOrderedList'];
  cmds.forEach(cmd => {
    document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach(btn => {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  });
}

function richContent(text) {
  if (!text) return '';
  if (/<[a-z]/i.test(text)) return text;
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function richEditor(id, content, minH) {
  const h = minH ? `style="min-height:${minH}px"` : '';
  return `
  <div class="rich-wrap">
    <div class="rich-toolbar">
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('undo')" title="Deshacer (Ctrl+Z)">↩</button>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('redo')" title="Rehacer (Ctrl+Y)">↪</button>
      <div class="rtb-sep"></div>
      <select class="rtb-select" title="Estilo de párrafo" onchange="rfmtBlock(this)">
        <option value="<p>">Párrafo</option>
        <option value="<h1>">Título 1</option>
        <option value="<h2>">Título 2</option>
        <option value="<h3>">Título 3</option>
        <option value="<blockquote>">Cita</option>
      </select>
      <select class="rtb-select" title="Tamaño de texto" onchange="rfmtSize(this)">
        <option value="3">Normal</option>
        <option value="1">Muy peq.</option>
        <option value="2">Pequeño</option>
        <option value="4">Grande</option>
        <option value="5">Muy grande</option>
        <option value="6">Extra grande</option>
      </select>
      <div class="rtb-sep"></div>
      <button type="button" class="rtb" data-cmd="bold" onmousedown="event.preventDefault()" onclick="rfmt('bold')" title="Negrita (Ctrl+B)"><b>B</b></button>
      <button type="button" class="rtb" data-cmd="italic" onmousedown="event.preventDefault()" onclick="rfmt('italic')" title="Cursiva (Ctrl+I)"><i>I</i></button>
      <button type="button" class="rtb" data-cmd="underline" onmousedown="event.preventDefault()" onclick="rfmt('underline')" title="Subrayado (Ctrl+U)"><u>U</u></button>
      <button type="button" class="rtb" data-cmd="strikeThrough" onmousedown="event.preventDefault()" onclick="rfmt('strikeThrough')" title="Tachado"><s>S</s></button>
      <div class="rtb-sep"></div>
      <label class="rtb-color-wrap" title="Color de texto">
        A&nbsp;<input type="color" class="rtb-color-input" value="#ffffff" onchange="rfmtColor(this)" onclick="saveRichSel()" title="Color de texto">
      </label>
      <div class="rtb-sep"></div>
      <button type="button" class="rtb" data-cmd="justifyLeft" onmousedown="event.preventDefault()" onclick="rfmt('justifyLeft')" title="Alinear izquierda">&#x21e4;</button>
      <button type="button" class="rtb" data-cmd="justifyCenter" onmousedown="event.preventDefault()" onclick="rfmt('justifyCenter')" title="Centrar">&#x2261;</button>
      <button type="button" class="rtb" data-cmd="justifyRight" onmousedown="event.preventDefault()" onclick="rfmt('justifyRight')" title="Alinear derecha">&#x21e5;</button>
      <button type="button" class="rtb" data-cmd="justifyFull" onmousedown="event.preventDefault()" onclick="rfmtJustify()" title="Justificar">&#x2263;</button>
      <div class="rtb-sep"></div>
      <button type="button" class="rtb" data-cmd="insertUnorderedList" onmousedown="event.preventDefault()" onclick="rfmt('insertUnorderedList')" title="Lista con viñetas">• Lista</button>
      <button type="button" class="rtb" data-cmd="insertOrderedList" onmousedown="event.preventDefault()" onclick="rfmt('insertOrderedList')" title="Lista numerada">1. Lista</button>
      <div class="rtb-sep"></div>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('outdent')" title="Reducir sangría">&#x21e4;</button>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('indent')" title="Aumentar sangría">&#x21e5;</button>
      <div class="rtb-sep"></div>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmtLink()" title="Insertar enlace">&#x1f517;</button>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('insertHorizontalRule')" title="Línea separadora">&#x2500;</button>
      <button type="button" class="rtb" onmousedown="event.preventDefault()" onclick="rfmt('removeFormat')" title="Limpiar formato" style="color:#f87171">&#x2715;</button>
    </div>
    <div class="rich-editor" id="${id}" contenteditable="true" ${h}
      onblur="saveRichSel()"
      onkeyup="saveRichSel(); updateRichToolbarState()"
      onmouseup="saveRichSel(); updateRichToolbarState()"
    >${richContent(content)}</div>
  </div>`;
}

/* ── Modal Forms ───────────────────────────────────────────── */
const formTemplates = {
  news: (data) => `
    <div class="form-group"><label>Título *</label><input type="text" id="f-title" value="${esc(data?.title||'')}" placeholder="Título de la noticia" /></div>
    <div class="form-group"><label>Extracto</label><input type="text" id="f-excerpt" value="${esc(data?.excerpt||'')}" placeholder="Breve descripción (opcional)" /></div>
    <div class="form-group"><label>Contenido *</label>${richEditor('f-content', data?.content||'', 180)}</div>
    <div class="form-row">
      <div class="form-group"><label>Categoría</label><select id="f-category">
        <option value="general" ${data?.category==='general'?'selected':''}>General</option>
        <option value="update" ${data?.category==='update'?'selected':''}>Actualización</option>
        <option value="event" ${data?.category==='event'?'selected':''}>Evento</option>
        <option value="urgent" ${data?.category==='urgent'?'selected':''}>Urgente</option>
      </select></div>
      <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:4px;"><label class="checkbox-label"><input type="checkbox" id="f-published" ${data?.is_published!==0?'checked':''} /> Publicar inmediatamente</label></div>
    </div>
    <div class="form-group">
      <label>Imagen de portada</label>
      ${data?.image_url ? `<div style="margin-bottom:6px;"><img src="${esc(data.image_url)}" style="height:80px;border-radius:6px;object-fit:cover;background:var(--card2);padding:2px;" />&nbsp;<label class="checkbox-label" style="display:inline-flex;gap:4px;"><input type="checkbox" id="f-remove_image"> Eliminar imagen</label></div>` : ''}
      <input type="file" id="f-image" accept="image/*" style="color:var(--text)" />
      <small style="color:var(--muted)">JPG, PNG, GIF, WebP. Máx 8 MB. Se mostrará como banner en inicio.</small>
    </div>
    <div class="form-group">
      <label>Video (YouTube embed URL)</label>
      <input type="text" id="f-video_url" value="${esc(data?.video_url||'')}" placeholder="https://www.youtube.com/embed/..." />
      <small style="color:var(--muted)">Pega la URL de embed de YouTube (youtube.com/embed/ID).</small>
    </div>
  `,
  players: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Usuario *</label><input type="text" id="f-username" value="${esc(data?.username||'')}" /></div>
      <div class="form-group"><label>Email</label><input type="email" id="f-email" value="${esc(data?.email||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Steam ID</label><input type="text" id="f-steam_id" value="${esc(data?.steam_id||'')}" /></div>
      <div class="form-group"><label>Discord ID</label><input type="text" id="f-discord_id" value="${esc(data?.discord_id||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Estado</label><select id="f-status">
        <option value="active" ${data?.status==='active'?'selected':''}>Activo</option>
        <option value="warned" ${data?.status==='warned'?'selected':''}>Advertido</option>
        <option value="banned" ${data?.status==='banned'?'selected':''}>Baneado</option>
      </select></div>
      <div class="form-group"><label>Whitelist</label><select id="f-whitelist_status">
        <option value="pending" ${data?.whitelist_status==='pending'?'selected':''}>Pendiente</option>
        <option value="approved" ${data?.whitelist_status==='approved'?'selected':''}>Aprobado</option>
        <option value="rejected" ${data?.whitelist_status==='rejected'?'selected':''}>Rechazado</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Horas jugadas</label><input type="number" id="f-total_hours" value="${data?.total_hours||0}" min="0" /></div>
      <div class="form-group"><label>Avisos</label><input type="number" id="f-warnings" value="${data?.warnings||0}" min="0" /></div>
    </div>
    <div class="form-group"><label>Razón de ban</label><input type="text" id="f-ban_reason" value="${esc(data?.ban_reason||'')}" placeholder="Dejar vacío si no está baneado" /></div>
  `,
  characters: (data) => {
    const factionOpts = allFactions.map(f => `<option value="${f.id}" ${data?.faction_id==f.id?'selected':''}>${esc(f.name)}</option>`).join('');
    const playerOpts = allPlayers.map(p => `<option value="${p.id}" ${data?.player_id==p.id?'selected':''}>${esc(p.username)}</option>`).join('');
    return `
    <div class="form-row">
      <div class="form-group"><label>Nombre *</label><input type="text" id="f-name" value="${esc(data?.name||'')}" /></div>
      <div class="form-group"><label>Jugador *</label><select id="f-player_id"><option value="">— Seleccionar —</option>${playerOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Edad</label><input type="number" id="f-age" value="${data?.age||''}" min="18" max="90" /></div>
      <div class="form-group"><label>Nacionalidad</label><input type="text" id="f-nationality" value="${esc(data?.nationality||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Facción</label><select id="f-faction_id"><option value="">Sin facción</option>${factionOpts}</select></div>
      <div class="form-group"><label>Ocupación</label><input type="text" id="f-occupation" value="${esc(data?.occupation||'')}" /></div>
    </div>
    <div class="form-group"><label>Estado</label><select id="f-status">
      <option value="active" ${data?.status==='active'?'selected':''}>Activo</option>
      <option value="dead" ${data?.status==='dead'?'selected':''}>Muerto</option>
      <option value="inactive" ${data?.status==='inactive'?'selected':''}>Inactivo</option>
    </select></div>
    <div class="form-group"><label>Historia / Backstory</label>${richEditor('f-backstory', data?.backstory||'', 120)}</div>
  `},
  factions: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Nombre *</label><input type="text" id="f-name" value="${esc(data?.name||'')}" /></div>
      <div class="form-group"><label>Sigla</label><input type="text" id="f-short_name" value="${esc(data?.short_name||'')}" placeholder="Ej: LSPD" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Tipo</label><select id="f-type">
        <option value="police" ${data?.type==='police'?'selected':''}>Policía</option>
        <option value="emergency" ${data?.type==='emergency'?'selected':''}>Emergencias</option>
        <option value="criminal" ${data?.type==='criminal'?'selected':''}>Criminal</option>
        <option value="civilian" ${data?.type==='civilian'?'selected':''}>Civil</option>
      </select></div>
      <div class="form-group"><label>Color</label><input type="color" id="f-color" value="${data?.color||'#00c4cc'}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Líder</label><input type="text" id="f-leader" value="${esc(data?.leader||'')}" /></div>
      <div class="form-group"><label>Miembros</label><input type="number" id="f-member_count" value="${data?.member_count||0}" min="0" /></div>
    </div>
    <div class="form-group"><label>Descripción</label>${richEditor('f-description', data?.description||'', 110)}</div>
    <div class="form-row">
      <div class="form-group" style="display:flex;align-items:center;gap:8px;"><label class="checkbox-label"><input type="checkbox" id="f-is_recruiting" ${data?.is_recruiting?'checked':''} /> Reclutando</label></div>
      ${data ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;"><label class="checkbox-label"><input type="checkbox" id="f-is_active" ${data?.is_active?'checked':''} /> Activa</label></div>` : ''}
    </div>
  `,
  rules: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Categoría *</label><input type="text" id="f-category" value="${esc(data?.category||'')}" placeholder="Ej: Reglas Generales" /></div>
      <div class="form-group"><label>Orden</label><input type="number" id="f-rule_order" value="${data?.rule_order||0}" min="0" /></div>
    </div>
    <div class="form-group"><label>Título *</label><input type="text" id="f-title" value="${esc(data?.title||'')}" /></div>
    <div class="form-group"><label>Contenido *</label>${richEditor('f-content', data?.content||'', 150)}</div>
    <div class="form-group">
      <label>Adjunto (imagen o PDF)</label>
      ${data?.file_url ? `<div style="margin-bottom:6px;font-size:.82rem;color:var(--muted)">Archivo actual: <a href="${esc(data.file_url)}" target="_blank" style="color:var(--primary)">${esc(data.file_name||'Ver archivo')}</a> &nbsp;<label class="checkbox-label" style="display:inline-flex;gap:4px;"><input type="checkbox" id="f-remove_file"> Eliminar</label></div>` : ''}
      <input type="file" id="f-file" accept="image/*,.pdf" style="color:var(--text)" />
      <small style="color:var(--muted)">Imágenes (JPG, PNG, GIF, WebP) o PDF. Máx 10 MB.</small>
    </div>
    ${data ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;"><label class="checkbox-label"><input type="checkbox" id="f-is_active" ${data?.is_active?'checked':''} /> Regla activa</label></div>` : ''}
  `,
  team: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Nombre *</label><input type="text" id="f-name" value="${esc(data?.name||'')}" placeholder="Ej: Juan Pérez" /></div>
      <div class="form-group"><label>Rol *</label><select id="f-role">
        <option value="founder"   ${data?.role==='founder'  ?'selected':''}>👑 Fundador</option>
        <option value="cofounder" ${data?.role==='cofounder'?'selected':''}>🥈 Co-Fundador</option>
        <option value="developer" ${data?.role==='developer'?'selected':''}>💻 Desarrollador</option>
        <option value="admin"     ${data?.role==='admin'    ?'selected':''}>🔑 Administrador</option>
        <option value="staff"     ${data?.role==='staff'    ?'selected':''}>⭐ Staff</option>
        <option value="moderator" ${data?.role==='moderator'?'selected':''}>🛡️ Moderador</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Título mostrado *</label><input type="text" id="f-title" value="${esc(data?.title||'')}" placeholder="Ej: Fundador & CEO" /></div>
      <div class="form-group"><label>Orden</label><input type="number" id="f-member_order" value="${data?.member_order??0}" min="0" /></div>
    </div>
    <div class="form-group"><label>Foto (URL de imagen)</label><input type="text" id="f-photo_url" value="${esc(data?.photo_url||'')}" placeholder="https://... (dejar vacío para usar iniciales)" /></div>
    <div class="form-row">
      <div class="form-group"><label>Discord</label><input type="text" id="f-discord" value="${esc(data?.discord||'')}" placeholder="@usuario" /></div>
      <div class="form-group"><label>Año de ingreso</label><input type="text" id="f-joined_date" value="${esc(data?.joined_date||'')}" placeholder="Ej: 2022" /></div>
    </div>
    <div class="form-group"><label>Historia / Biografía</label>${richEditor('f-bio', data?.bio||'', 120)}</div>
    ${data ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;"><label class="checkbox-label"><input type="checkbox" id="f-is_active" ${data?.is_active?'checked':''} /> Miembro activo (visible en el sitio)</label></div>` : ''}
  `,
  donors: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Usuario *</label><input type="text" id="f-username" value="${esc(data?.username||'')}" placeholder="Nombre del donador" /></div>
      <div class="form-group"><label>Monto ($)</label><input type="number" id="f-amount" value="${data?.amount||0}" min="0" step="0.01" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Discord</label><input type="text" id="f-discord" value="${esc(data?.discord||'')}" placeholder="@usuario" /></div>
      <div class="form-group"><label>Avatar URL</label><input type="text" id="f-avatar_url" value="${esc(data?.avatar_url||'')}" placeholder="https://..." /></div>
    </div>
    <div class="form-group"><label>Mensaje público</label><input type="text" id="f-message" value="${esc(data?.message||'')}" placeholder="Mensaje de agradecimiento (opcional)" /></div>
  `,
  items: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Nombre *</label><input type="text" id="f-name" value="${esc(data?.name||'')}" placeholder="Ej: Pistola Desert Eagle" /></div>
      <div class="form-group"><label>Categoría</label><input type="text" id="f-category" value="${esc(data?.category||'')}" placeholder="Ej: Armas, Vehículos, Ropa..." /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Precio ($)</label><input type="number" id="f-price" value="${data?.price||0}" min="0" step="0.01" /></div>
      <div class="form-group"><label>Peso (kg)</label><input type="number" id="f-weight" value="${data?.weight||0}" min="0" step="0.1" /></div>
    </div>
    <div class="form-group"><label>Descripción</label>${richEditor('f-description', data?.description||'', 100)}</div>
    <div class="form-group">
      <label>Imagen del item</label>
      ${data?.image_url ? `<div style="margin-bottom:6px;"><img src="${esc(data.image_url)}" style="height:60px;border-radius:4px;object-fit:contain;background:var(--card2);padding:4px;" />&nbsp;<label class="checkbox-label" style="display:inline-flex;gap:4px;"><input type="checkbox" id="f-remove_image"> Eliminar imagen</label></div>` : ''}
      <input type="file" id="f-image" accept="image/*" style="color:var(--text)" />
      <small style="color:var(--muted)">JPG, PNG, GIF, WebP. Máx 5 MB.</small>
    </div>
    ${data ? `<div class="form-group" style="display:flex;align-items:center;gap:8px;"><label class="checkbox-label"><input type="checkbox" id="f-is_active" ${data?.is_active?'checked':''} /> Item activo (visible en tienda)</label></div>` : ''}
  `,
  admins: (data) => `
    <div class="form-row">
      <div class="form-group"><label>Usuario *</label><input type="text" id="f-username" value="${esc(data?.username||'')}" /></div>
      <div class="form-group"><label>Email *</label><input type="email" id="f-email" value="${esc(data?.email||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Contraseña ${data?'(dejar vacío = no cambiar)':'*'}</label><input type="password" id="f-password" placeholder="Nueva contraseña" /></div>
      <div class="form-group"><label>Rol</label><select id="f-role">
        <option value="moderator" ${data?.role==='moderator'?'selected':''}>Moderador</option>
        <option value="admin" ${data?.role==='admin'?'selected':''}>Admin</option>
        <option value="superadmin" ${data?.role==='superadmin'?'selected':''}>Super Admin</option>
      </select></div>
    </div>
  `,
};

function showAddModal(entity) {
  if (entity === 'characters') loadPlayers().catch(() => {});
  modalMode = 'add';
  modalEntity = entity;
  editingId = null;
  const titles = { news:'Nueva Noticia', players:'Nuevo Jugador', characters:'Nuevo Personaje', factions:'Nueva Facción', team:'Nuevo Miembro del Equipo', rules:'Nueva Regla', admins:'Nuevo Administrador', donors:'Nuevo Donador', items:'Nuevo Item' };
  document.getElementById('modalTitle').textContent = titles[entity] || 'Nuevo';
  document.getElementById('modalBody').innerHTML = formTemplates[entity]?.() || '';
  document.getElementById('mainModal').classList.add('active');
}

async function editItem(entity, id) {
  try {
    if (entity === 'characters') {
      await loadPlayers();
      await loadFactionsList();
    }
    const endpointMap = { news:'/api/admin/news', players:'/api/admin/players', characters:'/api/admin/characters', factions:'/api/admin/factions', team:'/api/admin/team', rules:'/api/admin/rules', donors:'/api/admin/donors', items:'/api/admin/items' };
    const { data } = await api('GET', endpointMap[entity]);
    const item = data.find(i => i.id === id);
    if (!item) { showToast('Elemento no encontrado', 'error'); return; }
    modalMode = 'edit';
    modalEntity = entity;
    editingId = id;
    const titles = { news:'Editar Noticia', players:'Editar Jugador', characters:'Editar Personaje', factions:'Editar Facción', team:'Editar Miembro del Equipo', rules:'Editar Regla', donors:'Editar Donador', items:'Editar Item' };
    document.getElementById('modalTitle').textContent = titles[entity] || 'Editar';
    document.getElementById('modalBody').innerHTML = formTemplates[entity]?.(item) || '';
    document.getElementById('mainModal').classList.add('active');
  } catch (e) { showToast(e.message, 'error'); }
}

function closeMainModal() {
  document.getElementById('mainModal').classList.remove('active');
  modalMode = null; modalEntity = null; editingId = null;
}

function getFieldVal(id) {
  const el = document.getElementById(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.contentEditable === 'true') return el.innerHTML;
  return el.value;
}
function hasField(id) { return !!document.getElementById(id); }

async function saveModal() {
  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    let body = {};
    const e = modalEntity;

    if (e === 'news') {
      const fd = new FormData();
      fd.append('title', getFieldVal('f-title') || '');
      fd.append('content', getFieldVal('f-content') || '');
      fd.append('excerpt', getFieldVal('f-excerpt') || '');
      fd.append('category', getFieldVal('f-category') || 'general');
      fd.append('is_published', getFieldVal('f-published') ? '1' : '0');
      fd.append('video_url', getFieldVal('f-video_url') || '');
      if (hasField('f-remove_image') && document.getElementById('f-remove_image').checked) fd.append('remove_image', 'true');
      const fi = document.getElementById('f-image');
      if (fi?.files?.[0]) fd.append('image', fi.files[0]);
      const nUrl = '/api/admin/news' + (modalMode === 'edit' ? `/${editingId}` : '');
      const nResp = await fetch(nUrl, { method: modalMode === 'edit' ? 'PUT' : 'POST', body: fd, credentials: 'same-origin' });
      if (!nResp.ok) { const err = await nResp.json().catch(() => ({})); throw new Error(err.error || 'Error al guardar'); }
      const nResult = await nResp.json();
      showToast(nResult.message || 'Guardado exitosamente', 'success');
      closeMainModal();
      await loadPage(currentPage);
      return;
    }
    else if (e === 'players') body = { username: getFieldVal('f-username'), email: getFieldVal('f-email'), steam_id: getFieldVal('f-steam_id'), discord_id: getFieldVal('f-discord_id'), status: getFieldVal('f-status'), whitelist_status: getFieldVal('f-whitelist_status'), total_hours: parseFloat(getFieldVal('f-total_hours')||0), warnings: parseInt(getFieldVal('f-warnings')||0), ban_reason: getFieldVal('f-ban_reason') };
    else if (e === 'characters') body = { name: getFieldVal('f-name'), player_id: getFieldVal('f-player_id'), age: parseInt(getFieldVal('f-age')||0)||null, nationality: getFieldVal('f-nationality'), faction_id: getFieldVal('f-faction_id')||null, occupation: getFieldVal('f-occupation'), backstory: getFieldVal('f-backstory'), status: hasField('f-status') ? getFieldVal('f-status') : 'active' };
    else if (e === 'factions') body = { name: getFieldVal('f-name'), short_name: getFieldVal('f-short_name'), description: getFieldVal('f-description'), color: getFieldVal('f-color'), type: getFieldVal('f-type'), leader: getFieldVal('f-leader'), member_count: parseInt(getFieldVal('f-member_count')||0), is_recruiting: getFieldVal('f-is_recruiting'), is_active: hasField('f-is_active') ? getFieldVal('f-is_active') : true };
    else if (e === 'rules') {
      const fd = new FormData();
      fd.append('category', getFieldVal('f-category') || '');
      fd.append('title', getFieldVal('f-title') || '');
      fd.append('content', getFieldVal('f-content') || '');
      fd.append('rule_order', getFieldVal('f-rule_order') || '0');
      if (hasField('f-is_active')) fd.append('is_active', getFieldVal('f-is_active') ? 'true' : 'false');
      if (hasField('f-remove_file') && document.getElementById('f-remove_file').checked) fd.append('remove_file', 'true');
      const fi = document.getElementById('f-file');
      if (fi?.files?.[0]) fd.append('file', fi.files[0]);
      const rUrl = '/api/admin/rules' + (modalMode === 'edit' ? `/${editingId}` : '');
      const rResp = await fetch(rUrl, { method: modalMode === 'edit' ? 'PUT' : 'POST', body: fd, credentials: 'same-origin' });
      if (!rResp.ok) { const err = await rResp.json().catch(() => ({})); throw new Error(err.error || 'Error al guardar'); }
      const rResult = await rResp.json();
      showToast(rResult.message || 'Guardado exitosamente', 'success');
      closeMainModal();
      await loadPage(currentPage);
      return;
    }
    else if (e === 'team') body = { name: getFieldVal('f-name'), role: getFieldVal('f-role'), title: getFieldVal('f-title'), bio: getFieldVal('f-bio'), photo_url: getFieldVal('f-photo_url'), discord: getFieldVal('f-discord'), member_order: parseInt(getFieldVal('f-member_order')||0), joined_date: getFieldVal('f-joined_date'), is_active: hasField('f-is_active') ? getFieldVal('f-is_active') : true };
    else if (e === 'admins') { body = { username: getFieldVal('f-username'), email: getFieldVal('f-email'), role: getFieldVal('f-role') }; const pw = getFieldVal('f-password'); if (pw) body.password = pw; }
    else if (e === 'donors') body = { username: getFieldVal('f-username'), amount: parseFloat(getFieldVal('f-amount')||0), discord: getFieldVal('f-discord'), avatar_url: getFieldVal('f-avatar_url'), message: getFieldVal('f-message') };
    else if (e === 'items') {
      const fd = new FormData();
      fd.append('name', getFieldVal('f-name') || '');
      fd.append('description', getFieldVal('f-description') || '');
      fd.append('category', getFieldVal('f-category') || 'general');
      fd.append('price', getFieldVal('f-price') || '0');
      fd.append('weight', getFieldVal('f-weight') || '0');
      if (hasField('f-is_active')) fd.append('is_active', getFieldVal('f-is_active') ? 'true' : 'false');
      if (hasField('f-remove_image') && document.getElementById('f-remove_image').checked) fd.append('remove_image', 'true');
      const fi = document.getElementById('f-image');
      if (fi?.files?.[0]) fd.append('image', fi.files[0]);
      const iUrl = '/api/admin/items' + (modalMode === 'edit' ? `/${editingId}` : '');
      const iResp = await fetch(iUrl, { method: modalMode === 'edit' ? 'PUT' : 'POST', body: fd, credentials: 'same-origin' });
      if (!iResp.ok) { const err = await iResp.json().catch(() => ({})); throw new Error(err.error || 'Error al guardar'); }
      const iResult = await iResp.json();
      showToast(iResult.message || 'Guardado exitosamente', 'success');
      closeMainModal();
      await loadPage(currentPage);
      return;
    }

    const endpointMap = { news:'/api/admin/news', players:'/api/admin/players', characters:'/api/admin/characters', factions:'/api/admin/factions', team:'/api/admin/team', admins:'/api/admin/admins', donors:'/api/admin/donors' };
    const url = endpointMap[e] + (modalMode === 'edit' ? `/${editingId}` : '');
    const method = modalMode === 'edit' ? 'PUT' : 'POST';

    const result = await api(method, url, body);
    showToast(result.message || 'Guardado exitosamente', 'success');
    closeMainModal();
    await loadPage(currentPage);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

/* ── Confirm Delete ────────────────────────────────────────── */
let pendingDelete = null;

function confirmDelete(entity, id, name) {
  const entityNames = { news:'la noticia', players:'al jugador', characters:'al personaje', factions:'la facción', team:'al miembro del equipo', rules:'la regla', admins:'al administrador', donors:'al donador', items:'el item' };
  document.getElementById('confirmText').innerHTML = `¿Estás seguro de que deseas eliminar ${entityNames[entity]||'el elemento'} <strong>"${esc(name)}"</strong>? Esta acción no se puede deshacer.`;
  pendingDelete = { entity, id };
  document.getElementById('confirmDeleteBtn').onclick = () => executeDelete();
  document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('active');
  pendingDelete = null;
}

async function executeDelete() {
  if (!pendingDelete) return;
  const { entity, id } = pendingDelete;
  const endpointMap = { news:'/api/admin/news', players:'/api/admin/players', characters:'/api/admin/characters', factions:'/api/admin/factions', team:'/api/admin/team', rules:'/api/admin/rules', admins:'/api/admin/admins', donors:'/api/admin/donors', items:'/api/admin/items', forum:'/api/admin/forum' };
  try {
    const result = await api('DELETE', `${endpointMap[entity]}/${id}`);
    showToast(result.message || 'Eliminado exitosamente', 'success');
    closeConfirmModal();
    await loadPage(currentPage);
  } catch (e) { showToast(e.message, 'error'); closeConfirmModal(); }
}

/* ── Table filter ──────────────────────────────────────────── */
function filterTable(input, tableId, ...fields) {
  const q = input.value.toLowerCase();
  document.querySelectorAll(`#${tableId} tr`).forEach(row => {
    const match = fields.some(f => (row.dataset[f]||'').toLowerCase().includes(q));
    row.style.display = match ? '' : 'none';
  });
}

/* ── Helpers ───────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('adminToast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

// Close modals on overlay click
document.getElementById('mainModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMainModal(); });
document.getElementById('confirmModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirmModal(); });

/* ── Store ─────────────────────────────────────────────────── */
async function loadStore() {
  try {
    const [{ data: donors }, { data: settings }] = await Promise.all([
      api('GET', '/api/admin/donors'),
      api('GET', '/api/admin/settings'),
    ]);
    const payUrl = settings.find(s => s.key === 'store_payment_url')?.value || '#';
    const urlEl = document.getElementById('storePaymentUrlDisplay');
    if (urlEl) urlEl.textContent = payUrl;

    const medals = ['🥇','🥈','🥉'];
    document.getElementById('donorsTable').innerHTML = donors.length
      ? donors.map((d, i) => `
        <tr>
          <td><span class="donor-rank donor-rank-${i+1}">${medals[i] || `#${i+1}`}</span></td>
          <td><strong style="color:var(--text-bright)">${esc(d.username)}</strong></td>
          <td>${esc(d.discord||'—')}</td>
          <td><span class="donor-amount">$${parseFloat(d.amount).toFixed(2)}</span></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.message||'—')}</td>
          <td>${fmtDate(d.created_at)}</td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('donors',${d.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('donors',${d.id},'${esc(d.username)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty-state"><span class="empty-icon">🛒</span>Sin donadores registrados</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Forum ─────────────────────────────────────────────────── */
async function loadForum() {
  try {
    const { data } = await api('GET', '/api/admin/forum');
    const catBadge = { general:'muted', discusion:'info', media:'success', reporte:'danger' };
    document.getElementById('forumTable').innerHTML = data.length
      ? data.map(p => `
        <tr>
          <td><strong style="color:var(--text-bright)">${esc(p.author_name)}</strong></td>
          <td style="max-width:220px;">${esc(p.title)}</td>
          <td><span class="badge badge-${catBadge[p.category]||'muted'}">${esc(p.category)}</span></td>
          <td>${p.image_url ? `<a href="${esc(p.image_url)}" target="_blank" style="color:var(--primary);font-size:.75rem;">Ver</a>` : '—'}</td>
          <td>${p.likes}</td>
          <td><span class="badge badge-${p.is_active?'success':'danger'}">${p.is_active?'Activo':'Eliminado'}</span></td>
          <td>${fmtDate(p.created_at)}</td>
          <td><div class="td-actions">
            ${p.is_active ? `<button class="btn-delete" onclick="confirmDelete('forum',${p.id},'${esc(p.title)}')">Eliminar</button>` : '<span style="font-size:.75rem;color:var(--muted)">Eliminado</span>'}
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty-state"><span class="empty-icon">💬</span>Sin posts en el foro</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Usuarios Web ──────────────────────────────────────────── */
async function loadUsuarios() {
  try {
    const { data } = await api('GET', '/api/admin/users');
    document.getElementById('usuariosTable').innerHTML = data.length
      ? data.map(u => `
        <tr data-full_name="${esc(u.full_name)}" data-email="${esc(u.email)}" data-discord_username="${esc(u.discord_username||'')}">
          <td>${u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">` : '<div style="width:36px;height:36px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;">👤</div>'}</td>
          <td><strong style="color:var(--text-bright)">${esc(u.full_name)}</strong></td>
          <td style="color:var(--muted)">${esc(u.email)}</td>
          <td>${u.discord_username ? `<span style="color:#7289da">💬 ${esc(u.discord_username)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
          <td style="font-size:.75rem;color:var(--muted)">${fmtDate(u.created_at)}</td>
          <td style="font-size:.75rem;color:var(--muted)">${u.last_login ? fmtDate(u.last_login) : '<span style="color:var(--muted)">Nunca</span>'}</td>
          <td style="text-align:center">${u.total_purchases || 0}</td>
          <td style="color:var(--primary);font-weight:700">$${parseFloat(u.total_spent||0).toFixed(2)}</td>
          <td><span class="badge badge-${u.is_active ? 'success' : 'danger'}">${u.is_active ? 'Activo' : 'Inactivo'}</span></td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="toggleUser(${u.id})">${u.is_active ? 'Desactivar' : 'Activar'}</button>
            ${currentAdmin.role === 'superadmin' ? `<button class="btn-delete" onclick="deleteUser(${u.id},'${esc(u.full_name)}')">Eliminar</button>` : ''}
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="10" class="empty-state"><span class="empty-icon">🧑‍💻</span>Sin usuarios registrados</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

async function toggleUser(id) {
  try {
    await api('PATCH', `/api/admin/users/${id}/toggle`);
    showToast('Estado de usuario actualizado', 'success');
    await loadUsuarios();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteUser(id, name) {
  if (!confirm(`¿Eliminar permanentemente la cuenta de "${name}"?\nEsta acción no se puede deshacer.`)) return;
  try {
    await api('DELETE', `/api/admin/users/${id}`);
    showToast('Cuenta eliminada permanentemente', 'success');
    await loadUsuarios();
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Compras ───────────────────────────────────────────────── */
async function loadCompras() {
  try {
    const { data } = await api('GET', '/api/admin/purchases');
    const statusBadge = s => s === 'completed' ? 'badge-success' : s === 'failed' ? 'badge-danger' : 'badge-warning';
    const statusLabel = s => s === 'completed' ? 'Completada' : s === 'failed' ? 'Fallida' : 'Pendiente';
    document.getElementById('comprasTable').innerHTML = data.length
      ? data.map(p => `
        <tr data-item_name="${esc(p.item_name)}" data-full_name="${esc(p.full_name||'')}" data-buy_order="${esc(p.buy_order||'')}">
          <td><strong style="color:var(--text-bright)">${esc(p.item_name)}</strong></td>
          <td><div style="font-size:.85rem">${esc(p.full_name||'—')}</div><div style="font-size:.72rem;color:var(--muted)">${esc(p.email||'')}</div></td>
          <td style="color:var(--primary);font-weight:700">$${parseFloat(p.item_price).toFixed(2)}</td>
          <td style="font-size:.72rem;color:var(--muted);word-break:break-all;max-width:180px">${esc(p.buy_order||'—')}</td>
          <td><span class="badge ${statusBadge(p.status)}">${statusLabel(p.status)}</span></td>
          <td style="font-size:.75rem;color:var(--muted)">${fmtDate(p.created_at)}</td>
          <td><div class="td-actions" style="flex-wrap:wrap;gap:4px;">
            ${p.status !== 'completed' ? `<button class="btn-edit" onclick="updatePurchaseStatus(${p.id},'completed')">✓ Confirmar</button>` : ''}
            ${p.status === 'pending' ? `<button class="btn-delete" onclick="updatePurchaseStatus(${p.id},'failed')">✗ Rechazar</button>` : ''}
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty-state"><span class="empty-icon">💳</span>Sin compras registradas</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

async function updatePurchaseStatus(id, status) {
  try {
    await api('PATCH', `/api/admin/purchases/${id}`, { status });
    showToast(status === 'completed' ? '✓ Compra confirmada — donador actualizado' : '✗ Compra rechazada', status === 'completed' ? 'success' : 'error');
    await loadCompras();
  } catch (e) { showToast(e.message, 'error'); }
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/* ── Items ─────────────────────────────────────────────────── */
async function loadItems() {
  try {
    const { data } = await api('GET', '/api/admin/items');
    document.getElementById('itemsTable').innerHTML = data.length
      ? data.map(item => `
        <tr data-name="${esc(item.name)}" data-category="${esc(item.category||'')}">
          <td>${item.image_url
            ? `<img src="${esc(item.image_url)}" style="height:42px;width:42px;object-fit:contain;border-radius:4px;background:var(--card2);" />`
            : `<div style="width:42px;height:42px;background:var(--card2);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">📦</div>`}
          </td>
          <td><strong style="color:var(--text-bright)">${esc(item.name)}</strong></td>
          <td><span class="badge badge-muted">${esc(item.category||'—')}</span></td>
          <td style="color:var(--primary);font-weight:700;">$${parseFloat(item.price||0).toFixed(2)}</td>
          <td>${item.weight||0} kg</td>
          <td><span class="badge badge-${item.is_active?'success':'muted'}">${item.is_active?'Activo':'Inactivo'}</span></td>
          <td><div class="td-actions">
            <button class="btn-edit" onclick="editItem('items',${item.id})">Editar</button>
            <button class="btn-delete" onclick="confirmDelete('items',${item.id},'${esc(item.name)}')">Eliminar</button>
          </div></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty-state"><span class="empty-icon">📦</span>Sin items creados</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}
