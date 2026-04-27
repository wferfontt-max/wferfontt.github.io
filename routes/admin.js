const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'rules');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `rule_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg','.jpeg','.png','.gif','.webp','.pdf'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Solo imágenes y PDFs'));
  },
});

const itemUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads', 'items')),
    filename: (req, file, cb) => cb(null, `item_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

router.use(requireAuth);

function log(req, action, type, id, details) {
  db.run(
    'INSERT INTO activity_log (admin_id, admin_username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.adminId, req.session.adminUsername, action, type, id, details]
  ).catch(() => {});
}

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const [players, activePlayers, bannedPlayers, characters, factions, news, admins, pendingWL, activity] = await Promise.all([
    db.get('SELECT COUNT(*) as c FROM players'),
    db.get("SELECT COUNT(*) as c FROM players WHERE status = 'active'"),
    db.get("SELECT COUNT(*) as c FROM players WHERE status = 'banned'"),
    db.get('SELECT COUNT(*) as c FROM characters'),
    db.get('SELECT COUNT(*) as c FROM factions WHERE is_active = 1'),
    db.get('SELECT COUNT(*) as c FROM news'),
    db.get('SELECT COUNT(*) as c FROM admins WHERE is_active = 1'),
    db.get("SELECT COUNT(*) as c FROM players WHERE whitelist_status = 'pending'"),
    db.all('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 25'),
  ]);
  res.json({
    success: true,
    data: {
      stats: {
        players: parseInt(players.c), active_players: parseInt(activePlayers.c),
        banned_players: parseInt(bannedPlayers.c), characters: parseInt(characters.c),
        factions: parseInt(factions.c), news: parseInt(news.c),
        admins: parseInt(admins.c), pending_whitelist: parseInt(pendingWL.c),
      },
      recent_activity: activity,
    }
  });
});

const newsImgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

// ── NEWS ──────────────────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM news ORDER BY created_at DESC') });
});

router.post('/news', newsImgUpload.single('image'), async (req, res) => {
  const { title, content, excerpt, category, is_published, video_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Título y contenido son requeridos' });
  const image_url = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : (req.body.image_url || null);
  const r = await db.run(
    'INSERT INTO news (title, content, excerpt, author, category, is_published, image_url, video_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [title, content, excerpt || content.substring(0, 150) + '...', req.session.adminUsername, category || 'general', is_published ? 1 : 0, image_url, video_url || null]
  );
  log(req, 'CREATE_NEWS', 'news', r.lastInsertRowid, `Creó noticia: ${title}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Noticia creada' });
});

router.put('/news/:id', newsImgUpload.single('image'), async (req, res) => {
  const { title, content, excerpt, category, is_published, video_url, remove_image } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Título y contenido son requeridos' });
  const current = await db.get('SELECT image_url FROM news WHERE id = ?', [req.params.id]);
  let image_url = current?.image_url || null;
  if (remove_image === 'true') image_url = null;
  if (req.file) image_url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  else if (req.body.image_url !== undefined) image_url = req.body.image_url || null;
  await db.run(
    'UPDATE news SET title=?, content=?, excerpt=?, category=?, is_published=?, image_url=?, video_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [title, content, excerpt || content.substring(0, 150) + '...', category || 'general', is_published ? 1 : 0, image_url, video_url || null, req.params.id]
  );
  log(req, 'UPDATE_NEWS', 'news', req.params.id, `Actualizó noticia: ${title}`);
  res.json({ success: true, message: 'Noticia actualizada' });
});

router.delete('/news/:id', async (req, res) => {
  const n = await db.get('SELECT title FROM news WHERE id = ?', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM news WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_NEWS', 'news', req.params.id, `Eliminó noticia: ${n.title}`);
  res.json({ success: true, message: 'Noticia eliminada' });
});

// ── PLAYERS ───────────────────────────────────────────────────────────────────
router.get('/players', async (req, res) => {
  const search = req.query.search || '';
  const status = req.query.status || '';
  let sql = 'SELECT * FROM players WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (username LIKE ? OR steam_id LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY joined_at DESC LIMIT 200';
  res.json({ success: true, data: await db.all(sql, params) });
});

router.post('/players', async (req, res) => {
  const { steam_id, discord_id, username, email, whitelist_status } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
  try {
    const r = await db.run(
      'INSERT INTO players (steam_id, discord_id, username, email, whitelist_status) VALUES (?, ?, ?, ?, ?)',
      [steam_id || null, discord_id || null, username, email || null, whitelist_status || 'pending']
    );
    log(req, 'CREATE_PLAYER', 'player', r.lastInsertRowid, `Creó jugador: ${username}`);
    res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Jugador creado' });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('unique')) return res.status(400).json({ error: 'Steam ID ya existe' });
    throw e;
  }
});

router.put('/players/:id', async (req, res) => {
  const { username, email, status, ban_reason, whitelist_status, total_hours, warnings } = req.body;
  await db.run(
    'UPDATE players SET username=?, email=?, status=?, ban_reason=?, whitelist_status=?, total_hours=?, warnings=? WHERE id=?',
    [username, email || null, status || 'active', ban_reason || null, whitelist_status || 'pending', total_hours || 0, warnings || 0, req.params.id]
  );
  log(req, 'UPDATE_PLAYER', 'player', req.params.id, `Actualizó jugador: ${username}`);
  res.json({ success: true, message: 'Jugador actualizado' });
});

router.delete('/players/:id', async (req, res) => {
  const p = await db.get('SELECT username FROM players WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM players WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_PLAYER', 'player', req.params.id, `Eliminó jugador: ${p.username}`);
  res.json({ success: true, message: 'Jugador eliminado' });
});

// ── CHARACTERS ────────────────────────────────────────────────────────────────
router.get('/characters', async (req, res) => {
  res.json({ success: true, data: await db.all(
    'SELECT c.*, p.username as player_username, f.name as faction_name FROM characters c LEFT JOIN players p ON c.player_id=p.id LEFT JOIN factions f ON c.faction_id=f.id ORDER BY c.created_at DESC LIMIT 200'
  )});
});

router.post('/characters', async (req, res) => {
  const { player_id, name, age, nationality, faction_id, occupation, backstory } = req.body;
  if (!name || !player_id) return res.status(400).json({ error: 'Nombre y jugador son requeridos' });
  const r = await db.run(
    'INSERT INTO characters (player_id, name, age, nationality, faction_id, occupation, backstory) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [player_id, name, age || null, nationality || null, faction_id || null, occupation || null, backstory || null]
  );
  log(req, 'CREATE_CHARACTER', 'character', r.lastInsertRowid, `Creó personaje: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Personaje creado' });
});

router.put('/characters/:id', async (req, res) => {
  const { name, age, nationality, faction_id, occupation, backstory, status } = req.body;
  await db.run(
    'UPDATE characters SET name=?, age=?, nationality=?, faction_id=?, occupation=?, backstory=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [name, age || null, nationality || null, faction_id || null, occupation || null, backstory || null, status || 'active', req.params.id]
  );
  log(req, 'UPDATE_CHARACTER', 'character', req.params.id, `Actualizó personaje: ${name}`);
  res.json({ success: true, message: 'Personaje actualizado' });
});

router.delete('/characters/:id', async (req, res) => {
  const c = await db.get('SELECT name FROM characters WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM characters WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_CHARACTER', 'character', req.params.id, `Eliminó personaje: ${c.name}`);
  res.json({ success: true, message: 'Personaje eliminado' });
});

// ── FACTIONS ──────────────────────────────────────────────────────────────────
router.get('/factions', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM factions ORDER BY name') });
});

router.post('/factions', async (req, res) => {
  const { name, short_name, description, color, type, leader, is_recruiting } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const r = await db.run(
    'INSERT INTO factions (name, short_name, description, color, type, leader, is_recruiting) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, short_name || null, description || null, color || '#ff4500', type || 'civilian', leader || null, is_recruiting ? 1 : 0]
  );
  log(req, 'CREATE_FACTION', 'faction', r.lastInsertRowid, `Creó facción: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Facción creada' });
});

router.put('/factions/:id', async (req, res) => {
  const { name, short_name, description, color, type, leader, member_count, is_recruiting, is_active } = req.body;
  await db.run(
    'UPDATE factions SET name=?, short_name=?, description=?, color=?, type=?, leader=?, member_count=?, is_recruiting=?, is_active=? WHERE id=?',
    [name, short_name || null, description || null, color || '#ff4500', type || 'civilian', leader || null, member_count || 0, is_recruiting ? 1 : 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id]
  );
  log(req, 'UPDATE_FACTION', 'faction', req.params.id, `Actualizó facción: ${name}`);
  res.json({ success: true, message: 'Facción actualizada' });
});

router.delete('/factions/:id', async (req, res) => {
  const f = await db.get('SELECT name FROM factions WHERE id = ?', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM factions WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_FACTION', 'faction', req.params.id, `Eliminó facción: ${f.name}`);
  res.json({ success: true, message: 'Facción eliminada' });
});

// ── RULES ─────────────────────────────────────────────────────────────────────
router.get('/rules', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM rules ORDER BY rule_order') });
});

router.post('/rules', upload.single('file'), async (req, res) => {
  const { category, title, content, rule_order } = req.body;
  if (!category || !title || !content) return res.status(400).json({ error: 'Categoría, título y contenido requeridos' });
  let file_url = null, file_type = null, file_name = null;
  if (req.file) {
    file_url = `/uploads/rules/${req.file.filename}`;
    file_name = req.file.originalname;
    file_type = req.file.mimetype.startsWith('image/') ? 'image' : 'pdf';
  }
  const r = await db.run(
    'INSERT INTO rules (category, title, content, rule_order, file_url, file_type, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [category, title, content, rule_order || 0, file_url, file_type, file_name]
  );
  log(req, 'CREATE_RULE', 'rule', r.lastInsertRowid, `Creó regla: ${title}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Regla creada' });
});

router.put('/rules/:id', upload.single('file'), async (req, res) => {
  const { category, title, content, rule_order, is_active, remove_file } = req.body;
  const existing = await db.get('SELECT * FROM rules WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'No encontrado' });
  let { file_url, file_type, file_name } = existing;
  if (req.file) {
    if (existing.file_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', existing.file_url)); } catch (_) {} }
    file_url = `/uploads/rules/${req.file.filename}`;
    file_name = req.file.originalname;
    file_type = req.file.mimetype.startsWith('image/') ? 'image' : 'pdf';
  } else if (remove_file === 'true') {
    if (existing.file_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', existing.file_url)); } catch (_) {} }
    file_url = null; file_type = null; file_name = null;
  }
  await db.run(
    'UPDATE rules SET category=?, title=?, content=?, rule_order=?, is_active=?, file_url=?, file_type=?, file_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [category, title, content, rule_order || 0, is_active !== undefined ? (is_active === 'true' || is_active === true ? 1 : 0) : 1, file_url, file_type, file_name, req.params.id]
  );
  log(req, 'UPDATE_RULE', 'rule', req.params.id, `Actualizó regla: ${title}`);
  res.json({ success: true, message: 'Regla actualizada' });
});

router.delete('/rules/:id', async (req, res) => {
  const r = await db.get('SELECT title, file_url FROM rules WHERE id = ?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  if (r.file_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', r.file_url)); } catch (_) {} }
  await db.run('DELETE FROM rules WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_RULE', 'rule', req.params.id, `Eliminó regla: ${r.title}`);
  res.json({ success: true, message: 'Regla eliminada' });
});

// ── TEAM ──────────────────────────────────────────────────────────────────────
router.get('/team', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM team_members ORDER BY member_order') });
});

router.post('/team', async (req, res) => {
  const { name, role, title, bio, photo_url, discord, member_order, joined_date } = req.body;
  if (!name || !role || !title) return res.status(400).json({ error: 'Nombre, rol y título son requeridos' });
  const r = await db.run(
    'INSERT INTO team_members (name, role, title, bio, photo_url, discord, member_order, joined_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, role, title, bio || null, photo_url || null, discord || null, member_order || 0, joined_date || null]
  );
  log(req, 'CREATE_TEAM', 'team', r.lastInsertRowid, `Creó miembro: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Miembro creado' });
});

router.put('/team/:id', async (req, res) => {
  const { name, role, title, bio, photo_url, discord, member_order, joined_date, is_active } = req.body;
  await db.run(
    'UPDATE team_members SET name=?, role=?, title=?, bio=?, photo_url=?, discord=?, member_order=?, joined_date=?, is_active=? WHERE id=?',
    [name, role, title, bio || null, photo_url || null, discord || null, member_order || 0, joined_date || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id]
  );
  log(req, 'UPDATE_TEAM', 'team', req.params.id, `Actualizó miembro: ${name}`);
  res.json({ success: true, message: 'Miembro actualizado' });
});

router.delete('/team/:id', async (req, res) => {
  const t = await db.get('SELECT name FROM team_members WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM team_members WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_TEAM', 'team', req.params.id, `Eliminó miembro: ${t.name}`);
  res.json({ success: true, message: 'Miembro eliminado' });
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM server_settings') });
});

router.put('/settings', async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Formato inválido' });
  for (const [key, value] of Object.entries(settings)) {
    await db.run('UPDATE server_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [value, key]);
  }
  log(req, 'UPDATE_SETTINGS', 'settings', null, 'Actualizó configuración');
  res.json({ success: true, message: 'Configuración guardada' });
});

// ── ADMINS (superadmin only) ───────────────────────────────────────────────────
router.get('/admins', requireSuperAdmin, async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT id, username, email, role, created_at, last_login, is_active FROM admins ORDER BY created_at') });
});

router.post('/admins', requireSuperAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  try {
    const r = await db.run(
      'INSERT INTO admins (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, bcrypt.hashSync(password, 12), role || 'moderator']
    );
    log(req, 'CREATE_ADMIN', 'admin', r.lastInsertRowid, `Creó admin: ${username}`);
    res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Administrador creado' });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('unique')) return res.status(400).json({ error: 'Usuario o email ya existe' });
    throw e;
  }
});

router.delete('/admins/:id', requireSuperAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  const a = await db.get('SELECT username FROM admins WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  await db.run('UPDATE admins SET is_active = 0 WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_ADMIN', 'admin', req.params.id, `Desactivó admin: ${a.username}`);
  res.json({ success: true, message: 'Administrador desactivado' });
});

router.get('/activity', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100') });
});

// ── DONORS ────────────────────────────────────────────────────────────────────
router.get('/donors', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM donors ORDER BY amount DESC') });
});

router.post('/donors', async (req, res) => {
  const { username, amount, avatar_url, discord, message } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });
  const r = await db.run(
    'INSERT INTO donors (username, amount, avatar_url, discord, message) VALUES (?, ?, ?, ?, ?)',
    [username, parseFloat(amount) || 0, avatar_url || null, discord || null, message || null]
  );
  log(req, 'CREATE_DONOR', 'donor', r.lastInsertRowid, `Creó donador: ${username}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Donador creado' });
});

router.put('/donors/:id', async (req, res) => {
  const { username, amount, avatar_url, discord, message } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });
  await db.run(
    'UPDATE donors SET username=?, amount=?, avatar_url=?, discord=?, message=? WHERE id=?',
    [username, parseFloat(amount) || 0, avatar_url || null, discord || null, message || null, req.params.id]
  );
  log(req, 'UPDATE_DONOR', 'donor', req.params.id, `Actualizó donador: ${username}`);
  res.json({ success: true, message: 'Donador actualizado' });
});

router.delete('/donors/:id', async (req, res) => {
  const d = await db.get('SELECT username FROM donors WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'No encontrado' });
  await db.run('DELETE FROM donors WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_DONOR', 'donor', req.params.id, `Eliminó donador: ${d.username}`);
  res.json({ success: true, message: 'Donador eliminado' });
});

// ── FORUM MODERATION ──────────────────────────────────────────────────────────
router.get('/forum', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM forum_posts ORDER BY created_at DESC LIMIT 200') });
});

router.delete('/forum/:id', async (req, res) => {
  const p = await db.get('SELECT title, image_url FROM forum_posts WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (p.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', p.image_url)); } catch (_) {} }
  await db.run('UPDATE forum_posts SET is_active = 0 WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_FORUM_POST', 'forum', req.params.id, `Eliminó post: ${p.title}`);
  res.json({ success: true, message: 'Post eliminado' });
});

// ── ITEMS ─────────────────────────────────────────────────────────────────────
router.get('/items', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM items ORDER BY category, name') });
});

router.post('/items', itemUpload.single('image'), async (req, res) => {
  const { name, description, category, price, weight, image_url: bodyImageUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const image_url = req.file ? `/uploads/items/${req.file.filename}` : (bodyImageUrl || null);
  const r = await db.run(
    'INSERT INTO items (name, description, category, image_url, price, weight) VALUES (?, ?, ?, ?, ?, ?)',
    [name, description || null, category || 'general', image_url, parseFloat(price) || 0, parseFloat(weight) || 0]
  );
  log(req, 'CREATE_ITEM', 'item', r.lastInsertRowid, `Creó item: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Item creado' });
});

router.put('/items/:id', itemUpload.single('image'), async (req, res) => {
  const { name, description, category, price, weight, is_active, remove_image, image_url: bodyImageUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const existing = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'No encontrado' });
  let image_url = existing.image_url;
  if (req.file) {
    if (existing.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', existing.image_url)); } catch (_) {} }
    image_url = `/uploads/items/${req.file.filename}`;
  } else if (remove_image === 'true') {
    if (existing.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', existing.image_url)); } catch (_) {} }
    image_url = null;
  } else if (bodyImageUrl !== undefined) {
    image_url = bodyImageUrl || null;
  }
  const active = is_active !== undefined ? (is_active === 'true' || is_active === true ? 1 : 0) : 1;
  await db.run(
    'UPDATE items SET name=?, description=?, category=?, image_url=?, price=?, weight=?, is_active=? WHERE id=?',
    [name, description || null, category || 'general', image_url, parseFloat(price) || 0, parseFloat(weight) || 0, active, req.params.id]
  );
  log(req, 'UPDATE_ITEM', 'item', req.params.id, `Actualizó item: ${name}`);
  res.json({ success: true, message: 'Item actualizado' });
});

router.delete('/items/:id', async (req, res) => {
  const item = await db.get('SELECT name, image_url FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  if (item.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', item.image_url)); } catch (_) {} }
  await db.run('DELETE FROM items WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_ITEM', 'item', req.params.id, `Eliminó item: ${item.name}`);
  res.json({ success: true, message: 'Item eliminado' });
});

// ── REGISTERED USERS ──────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const users = await db.all(`
    SELECT u.id, u.full_name, u.birth_date, u.email, u.discord_username, u.discord_id,
           u.avatar_url, u.is_active, u.created_at, u.last_login,
           COUNT(p.id) as total_purchases,
           COALESCE(SUM(CASE WHEN p.status='completed' THEN p.item_price ELSE 0 END), 0) as total_spent
    FROM users u
    LEFT JOIN purchases p ON p.user_id = u.id
    GROUP BY u.id, u.full_name, u.birth_date, u.email, u.discord_username, u.discord_id,
             u.avatar_url, u.is_active, u.created_at, u.last_login
    ORDER BY u.created_at DESC
  `);
  res.json({ success: true, data: users });
});

router.patch('/users/:id/toggle', async (req, res) => {
  const user = await db.get('SELECT id, is_active, full_name FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const newActive = user.is_active ? 0 : 1;
  await db.run('UPDATE users SET is_active = ? WHERE id = ?', [newActive, user.id]);
  log(req, newActive ? 'ENABLE_USER' : 'DISABLE_USER', 'user', user.id, `${newActive ? 'Activó' : 'Desactivó'} usuario: ${user.full_name}`);
  res.json({ success: true, message: newActive ? 'Usuario activado' : 'Usuario desactivado' });
});

router.delete('/users/:id', requireSuperAdmin, async (req, res) => {
  const user = await db.get('SELECT id, full_name FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  log(req, 'DELETE_USER', 'user', req.params.id, `Eliminó cuenta de usuario: ${user.full_name}`);
  res.json({ success: true, message: 'Cuenta eliminada permanentemente' });
});

// ── PURCHASES ─────────────────────────────────────────────────────────────────
router.get('/purchases', async (req, res) => {
  const rows = await db.all(`
    SELECT p.*, u.full_name, u.email
    FROM purchases p LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 200
  `);
  res.json({ success: true, data: rows });
});

router.patch('/purchases/:id', async (req, res) => {
  const { status } = req.body;
  if (!['pending','completed','failed'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
  if (!purchase) return res.status(404).json({ error: 'No encontrado' });
  await db.run(
    "UPDATE purchases SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?",
    [status, status, req.params.id]
  );
  if (status === 'completed' && purchase.status !== 'completed') {
    try {
      const user = await db.get('SELECT * FROM users WHERE id = ?', [purchase.user_id]);
      if (user) {
        const existing = await db.get('SELECT * FROM donors WHERE user_id = ?', [purchase.user_id]);
        if (existing) {
          await db.run('UPDATE donors SET amount = amount + ?, avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?',
            [purchase.item_price, user.avatar_url || null, user.id]);
        } else {
          await db.run('INSERT INTO donors (username, amount, avatar_url, discord, user_id) VALUES (?, ?, ?, ?, ?)',
            [user.full_name, purchase.item_price, user.avatar_url || null, user.discord_username || null, user.id]);
        }
      }
    } catch (_) {}
  }
  log(req, 'UPDATE_PURCHASE', 'purchase', req.params.id, `Estado compra → ${status}`);
  res.json({ success: true, message: 'Estado actualizado' });
});

module.exports = router;
