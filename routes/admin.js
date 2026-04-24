const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'rules');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `rule_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten imágenes y PDFs'));
  },
});

const imgFilter = (req, file, cb) => {
  const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Solo imágenes'));
};

const itemsDir = path.join(__dirname, '..', 'public', 'uploads', 'items');
const itemUpload = multer({
  storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, itemsDir), filename: (r, f, cb) => cb(null, `item_${Date.now()}${path.extname(f.originalname)}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imgFilter,
});

router.use(requireAuth);

function log(db, req, action, type, id, details) {
  db.prepare('INSERT INTO activity_log (admin_id, admin_username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(req.session.adminId, req.session.adminUsername, action, type, id, details);
}

// ── STATS ──────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const db = getDb();
  res.json({
    success: true,
    data: {
      stats: {
        players: db.prepare('SELECT COUNT(*) as c FROM players').get().c,
        active_players: db.prepare("SELECT COUNT(*) as c FROM players WHERE status='active'").get().c,
        banned_players: db.prepare("SELECT COUNT(*) as c FROM players WHERE status='banned'").get().c,
        characters: db.prepare('SELECT COUNT(*) as c FROM characters').get().c,
        factions: db.prepare('SELECT COUNT(*) as c FROM factions WHERE is_active=1').get().c,
        news: db.prepare('SELECT COUNT(*) as c FROM news').get().c,
        admins: db.prepare('SELECT COUNT(*) as c FROM admins WHERE is_active=1').get().c,
        pending_whitelist: db.prepare("SELECT COUNT(*) as c FROM players WHERE whitelist_status='pending'").get().c,
      },
      recent_activity: db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 25').all(),
    }
  });
});

// ── NEWS ──────────────────────────────────────────────────────────
router.get('/news', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM news ORDER BY created_at DESC').all() });
});

router.post('/news', (req, res) => {
  const { title, content, excerpt, category, is_published } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Título y contenido son requeridos' });
  const db = getDb();
  const r = db.prepare('INSERT INTO news (title, content, excerpt, author, category, is_published) VALUES (?, ?, ?, ?, ?, ?)').run(title, content, excerpt || content.substring(0, 150) + '...', req.session.adminUsername, category || 'general', is_published ? 1 : 0);
  log(db, req, 'CREATE_NEWS', 'news', r.lastInsertRowid, `Creó noticia: ${title}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Noticia creada exitosamente' });
});

router.put('/news/:id', (req, res) => {
  const { title, content, excerpt, category, is_published } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Título y contenido son requeridos' });
  const db = getDb();
  db.prepare('UPDATE news SET title=?, content=?, excerpt=?, category=?, is_published=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title, content, excerpt || content.substring(0, 150) + '...', category || 'general', is_published ? 1 : 0, req.params.id);
  log(db, req, 'UPDATE_NEWS', 'news', req.params.id, `Actualizó noticia: ${title}`);
  res.json({ success: true, message: 'Noticia actualizada' });
});

router.delete('/news/:id', (req, res) => {
  const db = getDb();
  const n = db.prepare('SELECT title FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM news WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_NEWS', 'news', req.params.id, `Eliminó noticia: ${n.title}`);
  res.json({ success: true, message: 'Noticia eliminada' });
});

// ── PLAYERS ──────────────────────────────────────────────────────
router.get('/players', (req, res) => {
  const db = getDb();
  const search = req.query.search || '';
  const status = req.query.status || '';
  let query = 'SELECT * FROM players WHERE 1=1';
  const params = [];
  if (search) { query += ' AND (username LIKE ? OR steam_id LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { query += ' AND status=?'; params.push(status); }
  query += ' ORDER BY joined_at DESC LIMIT 200';
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

router.post('/players', (req, res) => {
  const { steam_id, discord_id, username, email, whitelist_status } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO players (steam_id, discord_id, username, email, whitelist_status) VALUES (?, ?, ?, ?, ?)').run(steam_id || null, discord_id || null, username, email || null, whitelist_status || 'pending');
    log(db, req, 'CREATE_PLAYER', 'player', r.lastInsertRowid, `Creó jugador: ${username}`);
    res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Jugador creado' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Steam ID ya existe' });
    throw e;
  }
});

router.put('/players/:id', (req, res) => {
  const { username, email, status, ban_reason, whitelist_status, total_hours, warnings } = req.body;
  const db = getDb();
  db.prepare('UPDATE players SET username=?, email=?, status=?, ban_reason=?, whitelist_status=?, total_hours=?, warnings=? WHERE id=?').run(username, email || null, status || 'active', ban_reason || null, whitelist_status || 'pending', total_hours || 0, warnings || 0, req.params.id);
  log(db, req, 'UPDATE_PLAYER', 'player', req.params.id, `Actualizó jugador: ${username}`);
  res.json({ success: true, message: 'Jugador actualizado' });
});

router.delete('/players/:id', (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT username FROM players WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM players WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_PLAYER', 'player', req.params.id, `Eliminó jugador: ${p.username}`);
  res.json({ success: true, message: 'Jugador eliminado' });
});

// ── CHARACTERS ────────────────────────────────────────────────────
router.get('/characters', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT c.*, p.username as player_username, f.name as faction_name FROM characters c LEFT JOIN players p ON c.player_id=p.id LEFT JOIN factions f ON c.faction_id=f.id ORDER BY c.created_at DESC LIMIT 200').all() });
});

router.post('/characters', (req, res) => {
  const { player_id, name, age, nationality, faction_id, occupation, backstory } = req.body;
  if (!name || !player_id) return res.status(400).json({ error: 'Nombre y jugador son requeridos' });
  const db = getDb();
  const r = db.prepare('INSERT INTO characters (player_id, name, age, nationality, faction_id, occupation, backstory) VALUES (?, ?, ?, ?, ?, ?, ?)').run(player_id, name, age || null, nationality || null, faction_id || null, occupation || null, backstory || null);
  log(db, req, 'CREATE_CHARACTER', 'character', r.lastInsertRowid, `Creó personaje: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Personaje creado' });
});

router.put('/characters/:id', (req, res) => {
  const { name, age, nationality, faction_id, occupation, backstory, status } = req.body;
  const db = getDb();
  db.prepare('UPDATE characters SET name=?, age=?, nationality=?, faction_id=?, occupation=?, backstory=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, age || null, nationality || null, faction_id || null, occupation || null, backstory || null, status || 'active', req.params.id);
  log(db, req, 'UPDATE_CHARACTER', 'character', req.params.id, `Actualizó personaje: ${name}`);
  res.json({ success: true, message: 'Personaje actualizado' });
});

router.delete('/characters/:id', (req, res) => {
  const db = getDb();
  const c = db.prepare('SELECT name FROM characters WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM characters WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_CHARACTER', 'character', req.params.id, `Eliminó personaje: ${c.name}`);
  res.json({ success: true, message: 'Personaje eliminado' });
});

// ── FACTIONS ──────────────────────────────────────────────────────
router.get('/factions', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM factions ORDER BY name').all() });
});

router.post('/factions', (req, res) => {
  const { name, short_name, description, color, type, leader, is_recruiting } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const db = getDb();
  const r = db.prepare('INSERT INTO factions (name, short_name, description, color, type, leader, is_recruiting) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, short_name || null, description || null, color || '#ff4500', type || 'civilian', leader || null, is_recruiting ? 1 : 0);
  log(db, req, 'CREATE_FACTION', 'faction', r.lastInsertRowid, `Creó facción: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Facción creada' });
});

router.put('/factions/:id', (req, res) => {
  const { name, short_name, description, color, type, leader, member_count, is_recruiting, is_active } = req.body;
  const db = getDb();
  db.prepare('UPDATE factions SET name=?, short_name=?, description=?, color=?, type=?, leader=?, member_count=?, is_recruiting=?, is_active=? WHERE id=?').run(name, short_name || null, description || null, color || '#ff4500', type || 'civilian', leader || null, member_count || 0, is_recruiting ? 1 : 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
  log(db, req, 'UPDATE_FACTION', 'faction', req.params.id, `Actualizó facción: ${name}`);
  res.json({ success: true, message: 'Facción actualizada' });
});

router.delete('/factions/:id', (req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT name FROM factions WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM factions WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_FACTION', 'faction', req.params.id, `Eliminó facción: ${f.name}`);
  res.json({ success: true, message: 'Facción eliminada' });
});

// ── RULES ─────────────────────────────────────────────────────────
router.get('/rules', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM rules ORDER BY rule_order').all() });
});

router.post('/rules', upload.single('file'), (req, res) => {
  const { category, title, content, rule_order } = req.body;
  if (!category || !title || !content) return res.status(400).json({ error: 'Categoría, título y contenido requeridos' });
  const db = getDb();
  let file_url = null, file_type = null, file_name = null;
  if (req.file) {
    file_url = `/uploads/rules/${req.file.filename}`;
    file_name = req.file.originalname;
    file_type = req.file.mimetype.startsWith('image/') ? 'image' : 'pdf';
  }
  const r = db.prepare('INSERT INTO rules (category, title, content, rule_order, file_url, file_type, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)').run(category, title, content, rule_order || 0, file_url, file_type, file_name);
  log(db, req, 'CREATE_RULE', 'rule', r.lastInsertRowid, `Creó regla: ${title}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Regla creada' });
});

router.put('/rules/:id', upload.single('file'), (req, res) => {
  const { category, title, content, rule_order, is_active, remove_file } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM rules WHERE id=?').get(req.params.id);
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

  db.prepare('UPDATE rules SET category=?, title=?, content=?, rule_order=?, is_active=?, file_url=?, file_type=?, file_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    category, title, content, rule_order || 0,
    is_active !== undefined ? (is_active === 'true' || is_active === true ? 1 : 0) : 1,
    file_url, file_type, file_name, req.params.id
  );
  log(db, req, 'UPDATE_RULE', 'rule', req.params.id, `Actualizó regla: ${title}`);
  res.json({ success: true, message: 'Regla actualizada' });
});

router.delete('/rules/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT title, file_url FROM rules WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  if (r.file_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', r.file_url)); } catch (_) {} }
  db.prepare('DELETE FROM rules WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_RULE', 'rule', req.params.id, `Eliminó regla: ${r.title}`);
  res.json({ success: true, message: 'Regla eliminada' });
});

// ── TEAM ──────────────────────────────────────────────────────────
router.get('/team', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM team_members ORDER BY member_order').all() });
});

router.post('/team', (req, res) => {
  const { name, role, title, bio, photo_url, discord, member_order, joined_date } = req.body;
  if (!name || !role || !title) return res.status(400).json({ error: 'Nombre, rol y título son requeridos' });
  const db = getDb();
  const r = db.prepare('INSERT INTO team_members (name, role, title, bio, photo_url, discord, member_order, joined_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, role, title, bio || null, photo_url || null, discord || null, member_order || 0, joined_date || null);
  log(db, req, 'CREATE_TEAM', 'team', r.lastInsertRowid, `Creó miembro: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Miembro creado' });
});

router.put('/team/:id', (req, res) => {
  const { name, role, title, bio, photo_url, discord, member_order, joined_date, is_active } = req.body;
  const db = getDb();
  db.prepare('UPDATE team_members SET name=?, role=?, title=?, bio=?, photo_url=?, discord=?, member_order=?, joined_date=?, is_active=? WHERE id=?').run(name, role, title, bio || null, photo_url || null, discord || null, member_order || 0, joined_date || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id);
  log(db, req, 'UPDATE_TEAM', 'team', req.params.id, `Actualizó miembro: ${name}`);
  res.json({ success: true, message: 'Miembro actualizado' });
});

router.delete('/team/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT name FROM team_members WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM team_members WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_TEAM', 'team', req.params.id, `Eliminó miembro: ${t.name}`);
  res.json({ success: true, message: 'Miembro eliminado' });
});

// ── SETTINGS ──────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM server_settings').all() });
});

router.put('/settings', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Formato inválido' });
  const db = getDb();
  const upd = db.prepare('UPDATE server_settings SET value=?, updated_at=CURRENT_TIMESTAMP WHERE key=?');
  for (const [key, value] of Object.entries(settings)) upd.run(value, key);
  log(db, req, 'UPDATE_SETTINGS', 'settings', null, 'Actualizó configuración del servidor');
  res.json({ success: true, message: 'Configuración guardada' });
});

// ── ADMINS (superadmin only) ───────────────────────────────────────
router.get('/admins', requireSuperAdmin, (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT id, username, email, role, created_at, last_login, is_active FROM admins ORDER BY created_at').all() });
});

router.post('/admins', requireSuperAdmin, (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO admins (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email, bcrypt.hashSync(password, 12), role || 'moderator');
    log(db, req, 'CREATE_ADMIN', 'admin', r.lastInsertRowid, `Creó admin: ${username}`);
    res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Administrador creado' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Usuario o email ya existe' });
    throw e;
  }
});

router.delete('/admins/:id', requireSuperAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  const db = getDb();
  const a = db.prepare('SELECT username FROM admins WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('UPDATE admins SET is_active=0 WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_ADMIN', 'admin', req.params.id, `Desactivó admin: ${a.username}`);
  res.json({ success: true, message: 'Administrador desactivado' });
});

router.get('/activity', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100').all() });
});

// ── DONORS ────────────────────────────────────────────────────
router.get('/donors', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM donors ORDER BY amount DESC').all() });
});

router.post('/donors', (req, res) => {
  const { username, amount, avatar_url, discord, message } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });
  const db = getDb();
  const r = db.prepare('INSERT INTO donors (username, amount, avatar_url, discord, message) VALUES (?, ?, ?, ?, ?)').run(username, parseFloat(amount) || 0, avatar_url || null, discord || null, message || null);
  log(db, req, 'CREATE_DONOR', 'donor', r.lastInsertRowid, `Creó donador: ${username}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Donador creado' });
});

router.put('/donors/:id', (req, res) => {
  const { username, amount, avatar_url, discord, message } = req.body;
  if (!username) return res.status(400).json({ error: 'Nombre requerido' });
  const db = getDb();
  db.prepare('UPDATE donors SET username=?, amount=?, avatar_url=?, discord=?, message=? WHERE id=?').run(username, parseFloat(amount) || 0, avatar_url || null, discord || null, message || null, req.params.id);
  log(db, req, 'UPDATE_DONOR', 'donor', req.params.id, `Actualizó donador: ${username}`);
  res.json({ success: true, message: 'Donador actualizado' });
});

router.delete('/donors/:id', (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT username FROM donors WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM donors WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_DONOR', 'donor', req.params.id, `Eliminó donador: ${d.username}`);
  res.json({ success: true, message: 'Donador eliminado' });
});

// ── FORUM (moderation) ────────────────────────────────────────
router.get('/forum', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM forum_posts ORDER BY created_at DESC LIMIT 200').all() });
});

router.delete('/forum/:id', (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT title, image_url FROM forum_posts WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (p.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', p.image_url)); } catch (_) {} }
  db.prepare('UPDATE forum_posts SET is_active=0 WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_FORUM_POST', 'forum', req.params.id, `Eliminó post: ${p.title}`);
  res.json({ success: true, message: 'Post eliminado' });
});

// ── ITEMS ─────────────────────────────────────────────────────
router.get('/items', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM items ORDER BY category, name').all() });
});

router.post('/items', itemUpload.single('image'), (req, res) => {
  const { name, description, category, price, weight, image_url: bodyImageUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const db = getDb();
  const image_url = req.file ? `/uploads/items/${req.file.filename}` : (bodyImageUrl || null);
  const r = db.prepare('INSERT INTO items (name, description, category, image_url, price, weight) VALUES (?, ?, ?, ?, ?, ?)').run(name, description || null, category || 'general', image_url, parseFloat(price) || 0, parseFloat(weight) || 0);
  log(db, req, 'CREATE_ITEM', 'item', r.lastInsertRowid, `Creó item: ${name}`);
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Item creado' });
});

router.put('/items/:id', itemUpload.single('image'), (req, res) => {
  const { name, description, category, price, weight, is_active, remove_image, image_url: bodyImageUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
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
  db.prepare('UPDATE items SET name=?, description=?, category=?, image_url=?, price=?, weight=?, is_active=? WHERE id=?').run(name, description || null, category || 'general', image_url, parseFloat(price) || 0, parseFloat(weight) || 0, active, req.params.id);
  log(db, req, 'UPDATE_ITEM', 'item', req.params.id, `Actualizó item: ${name}`);
  res.json({ success: true, message: 'Item actualizado' });
});

router.delete('/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT name, image_url FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  if (item.image_url) { try { fs.unlinkSync(path.join(__dirname, '..', 'public', item.image_url)); } catch (_) {} }
  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  log(db, req, 'DELETE_ITEM', 'item', req.params.id, `Eliminó item: ${item.name}`);
  res.json({ success: true, message: 'Item eliminado' });
});

// ── REGISTERED USERS ─────────────────────────────────────────
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.full_name, u.birth_date, u.email, u.discord_username, u.discord_id,
           u.avatar_url, u.is_active, u.created_at, u.last_login,
           COUNT(p.id) as total_purchases,
           COALESCE(SUM(CASE WHEN p.status='completed' THEN p.item_price ELSE 0 END), 0) as total_spent
    FROM users u
    LEFT JOIN purchases p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ success: true, data: users });
});

router.patch('/users/:id/toggle', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, is_active, full_name FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare('UPDATE users SET is_active = ? WHERE id=?').run(user.is_active ? 0 : 1, user.id);
  log(db, req, user.is_active ? 'DISABLE_USER' : 'ENABLE_USER', 'user', user.id, `${user.is_active ? 'Desactivó' : 'Activó'} usuario: ${user.full_name}`);
  res.json({ success: true, message: user.is_active ? 'Usuario desactivado' : 'Usuario activado' });
});

// ── PURCHASES MANAGEMENT ──────────────────────────────────────
router.get('/purchases', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.*, u.full_name, u.email
    FROM purchases p
    LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 200
  `).all();
  res.json({ success: true, data: rows });
});

router.patch('/purchases/:id', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'completed', 'failed'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const db = getDb();
  const purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'No encontrado' });
  db.prepare("UPDATE purchases SET status=?, completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?").run(status, status, req.params.id);
  if (status === 'completed' && purchase.status !== 'completed') {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(purchase.user_id);
      if (user) {
        const existing = db.prepare('SELECT * FROM donors WHERE user_id=?').get(purchase.user_id);
        if (existing) {
          db.prepare('UPDATE donors SET amount=amount+?, avatar_url=COALESCE(?,avatar_url) WHERE user_id=?').run(purchase.item_price, user.avatar_url || null, user.id);
        } else {
          db.prepare('INSERT INTO donors (username, amount, avatar_url, discord, user_id) VALUES (?,?,?,?,?)').run(user.full_name, purchase.item_price, user.avatar_url || null, user.discord_username || null, user.id);
        }
      }
    } catch (_) {}
  }
  log(db, req, 'UPDATE_PURCHASE', 'purchase', req.params.id, `Estado compra → ${status}`);
  res.json({ success: true, message: 'Estado actualizado' });
});

module.exports = router;
