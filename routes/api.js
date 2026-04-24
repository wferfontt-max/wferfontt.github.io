const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { getDb } = require('../database');

const forumDir = path.join(__dirname, '..', 'public', 'uploads', 'forum');
const forumStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, forumDir),
  filename: (req, file, cb) => cb(null, `forum_${Date.now()}${path.extname(file.originalname)}`),
});
const forumUpload = multer({
  storage: forumStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

const avatarDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => cb(null, `avatar_${req.session.userId}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

router.get('/news', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 10;
  const category = req.query.category;
  let query = 'SELECT id, title, excerpt, author, category, views, created_at FROM news WHERE is_published = 1';
  const params = [];
  if (category && category !== 'all') { query += ' AND category = ?'; params.push(category); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

router.get('/news/:id', (req, res) => {
  const db = getDb();
  const news = db.prepare('SELECT * FROM news WHERE id = ? AND is_published = 1').get(req.params.id);
  if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });
  db.prepare('UPDATE news SET views = views + 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true, data: news });
});

router.get('/factions', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM factions WHERE is_active = 1 ORDER BY type, name').all() });
});

router.get('/rules', (req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM rules WHERE is_active = 1 ORDER BY rule_order').all();
  const grouped = rules.reduce((acc, rule) => {
    if (!acc[rule.category]) acc[rule.category] = [];
    acc[rule.category].push(rule);
    return acc;
  }, {});
  res.json({ success: true, data: grouped });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const settings = db.prepare("SELECT key, value FROM server_settings WHERE key IN ('players_online','server_ip','discord_url','server_port')").all();
  const s = settings.reduce((a, x) => { a[x.key] = x.value; return a; }, {});
  res.json({
    success: true,
    data: {
      players_online: parseInt(s.players_online) || 0,
      total_players: db.prepare('SELECT COUNT(*) as c FROM players').get().c,
      active_factions: db.prepare('SELECT COUNT(*) as c FROM factions WHERE is_active = 1').get().c,
      total_characters: db.prepare('SELECT COUNT(*) as c FROM characters').get().c,
      server_ip: s.server_ip || 'play.furiousin.com',
      server_port: s.server_port || '30120',
      discord_url: s.discord_url || '#',
    }
  });
});

router.get('/team', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM team_members WHERE is_active = 1 ORDER BY member_order').all() });
});

// ── STORE SETTINGS (public) ───────────────────────────────────
router.get('/store/settings', (req, res) => {
  const db = getDb();
  const s = db.prepare("SELECT value FROM server_settings WHERE key='store_payment_url'").get();
  res.json({ success: true, data: { payment_url: s?.value || '#' } });
});

// ── DONORS ────────────────────────────────────────────────────
router.get('/donors', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM donors ORDER BY amount DESC LIMIT 50').all() });
});

// ── FORUM ─────────────────────────────────────────────────────
router.get('/forum/posts', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 20;
  const category = req.query.category;
  let query = 'SELECT * FROM forum_posts WHERE is_active=1';
  const params = [];
  if (category && category !== 'all') { query += ' AND category=?'; params.push(category); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

router.post('/forum/posts', forumUpload.single('image'), (req, res) => {
  const { author_name, title, content, category } = req.body;
  if (!author_name || !title) return res.status(400).json({ error: 'Nombre y título son requeridos' });
  const db = getDb();
  const image_url = req.file ? `/uploads/forum/${req.file.filename}` : null;
  const r = db.prepare('INSERT INTO forum_posts (author_name, title, content, image_url, category) VALUES (?, ?, ?, ?, ?)').run(author_name, title, content || null, image_url, category || 'general');
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Post creado exitosamente' });
});

router.post('/forum/posts/:id/like', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE forum_posts SET likes=likes+1 WHERE id=? AND is_active=1').run(req.params.id);
  res.json({ success: true });
});

// ── REGISTER ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { full_name, birth_date, email, password, discord_username, discord_id } = req.body;
  const missing = [];
  if (!full_name?.trim())  missing.push('Nombre completo');
  if (!birth_date)         missing.push('Fecha de nacimiento');
  if (!email?.trim())      missing.push('Correo electrónico');
  if (!password)           missing.push('Contraseña');
  if (missing.length)
    return res.status(400).json({ error: `Faltan campos obligatorios: ${missing.join(', ')}` });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Correo electrónico inválido' });
  if (password.length < 6)
    return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim()))
    return res.status(409).json({ error: 'El correo electrónico ya está registrado' });
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  const hash = bcrypt.hashSync(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO users (full_name, birth_date, email, password_hash, discord_username, discord_id, email_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(
    full_name.trim(), birth_date, email.toLowerCase().trim(), hash,
    discord_username?.trim() || null, discord_id?.trim() || null, token
  );
  const user = db.prepare('SELECT id, full_name, email FROM users WHERE email = ?').get(email.toLowerCase().trim());
  // Send emails asynchronously (don't block response)
  try {
    const { sendWelcomeEmail, sendVerificationEmail } = require('../services/mailer');
    sendWelcomeEmail(user).catch(() => {});
    sendVerificationEmail(user, token).catch(() => {});
  } catch (_) {}
  res.json({ success: true, message: '¡Registro exitoso! Revisa tu correo para verificar tu cuenta.' });
});

// ── VERIFY EMAIL ──────────────────────────────────────────────
router.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  const db = getDb();
  const user = db.prepare('SELECT id, email_verified FROM users WHERE verification_token = ?').get(token);
  if (!user) return res.status(404).json({ error: 'Enlace inválido o ya utilizado' });
  if (user.email_verified) return res.json({ success: true, message: 'Tu cuenta ya estaba verificada' });
  db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
  res.json({ success: true, message: '¡Cuenta verificada exitosamente! Ya puedes iniciar sesión.' });
});

// ── ITEMS ─────────────────────────────────────────────────────
router.get('/items', (req, res) => {
  const db = getDb();
  const category = req.query.category;
  let query = 'SELECT * FROM items WHERE is_active=1';
  const params = [];
  if (category && category !== 'all') { query += ' AND category=?'; params.push(category); }
  query += ' ORDER BY category, name';
  res.json({ success: true, data: db.prepare(query).all(...params) });
});

// ── USER AUTH ─────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Credenciales incorrectas' });
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  req.session.userId = user.id;
  res.json({ success: true, data: { id: user.id, full_name: user.full_name, email: user.email, avatar_url: user.avatar_url } });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── USER PROFILE ───────────────────────────────────────────────
router.get('/me', requireUser, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, full_name, birth_date, email, discord_username, discord_id, avatar_url, created_at, last_login FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const purchases = db.prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  res.json({ success: true, data: { ...user, purchases } });
});

router.put('/me', requireUser, (req, res) => {
  const { full_name, discord_username, discord_id } = req.body;
  if (!full_name) return res.status(400).json({ error: 'El nombre es requerido' });
  getDb().prepare('UPDATE users SET full_name = ?, discord_username = ?, discord_id = ? WHERE id = ?')
    .run(full_name.trim(), discord_username?.trim() || null, discord_id?.trim() || null, req.session.userId);
  res.json({ success: true, message: 'Perfil actualizado correctamente' });
});

router.post('/me/avatar', requireUser, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
  const url = `/uploads/avatars/${req.file.filename}`;
  getDb().prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, req.session.userId);
  res.json({ success: true, data: { avatar_url: url } });
});

router.get('/me/purchases', requireUser, (req, res) => {
  res.json({ success: true, data: getDb().prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId) });
});

// ── STORE BUY ─────────────────────────────────────────────────
router.post('/store/buy', requireUser, (req, res) => {
  const { item_id } = req.body;
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND is_active = 1').get(item_id);
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });
  const payRow = db.prepare("SELECT value FROM server_settings WHERE key='store_payment_url'").get();
  if (!payRow?.value || payRow.value === '#') return res.status(400).json({ error: 'URL de pago no configurada. Contacta al administrador.' });
  const buyOrder = `FURI-${Date.now()}-${req.session.userId}`;
  db.prepare('INSERT INTO purchases (user_id, item_id, item_name, item_price, buy_order, status) VALUES (?, ?, ?, ?, ?, ?)').run(req.session.userId, item.id, item.name, item.price, buyOrder, 'pending');
  const returnUrl = `${req.protocol}://${req.get('host')}/tienda/confirmacion?buy_order=${encodeURIComponent(buyOrder)}`;
  const sep = payRow.value.includes('?') ? '&' : '?';
  const redirectUrl = `${payRow.value}${sep}amount=${item.price}&buy_order=${encodeURIComponent(buyOrder)}&item=${encodeURIComponent(item.name)}&return_url=${encodeURIComponent(returnUrl)}`;
  res.json({ success: true, data: { redirect_url: redirectUrl, buy_order: buyOrder } });
});

router.get('/store/confirm', (req, res) => {
  const { buy_order, status } = req.query;
  if (!buy_order) return res.status(400).json({ error: 'buy_order requerido' });
  const db = getDb();
  const purchase = db.prepare('SELECT * FROM purchases WHERE buy_order = ?').get(buy_order);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
  if (purchase.status === 'pending') {
    const resolved = (status === 'success' || status === 'AUTHORIZED') ? 'completed' : 'failed';
    db.prepare('UPDATE purchases SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE buy_order = ?').run(resolved, buy_order);
    purchase.status = resolved;
  }
  res.json({ success: true, data: purchase });
});

// Mark purchase completed via buy_order (called from confirmation page after WebPay returns)
router.post('/store/confirm', (req, res) => {
  const { buy_order, token_ws, TBK_TOKEN } = req.body;
  if (!buy_order && !token_ws && !TBK_TOKEN) return res.status(400).json({ error: 'Parámetros requeridos' });
  const db = getDb();
  const bo = buy_order || '';
  const purchase = db.prepare('SELECT * FROM purchases WHERE buy_order = ?').get(bo);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
  const resolved = TBK_TOKEN ? 'failed' : 'completed';
  if (purchase.status === 'pending') {
    db.prepare('UPDATE purchases SET status = ?, webpay_token = ?, completed_at = CURRENT_TIMESTAMP WHERE buy_order = ?')
      .run(resolved, token_ws || TBK_TOKEN || null, bo);
    // Auto-add to donor ranking when purchase confirmed
    if (resolved === 'completed') {
      try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(purchase.user_id);
        if (user) {
          const existing = db.prepare('SELECT * FROM donors WHERE user_id = ?').get(purchase.user_id);
          if (existing) {
            db.prepare('UPDATE donors SET amount = amount + ?, avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?')
              .run(purchase.item_price, user.avatar_url || null, purchase.user_id);
          } else {
            db.prepare('INSERT INTO donors (username, amount, avatar_url, discord, user_id) VALUES (?, ?, ?, ?, ?)')
              .run(user.full_name, purchase.item_price, user.avatar_url || null, user.discord_username || null, user.id);
          }
        }
      } catch (_) {}
    }
  }
  res.json({ success: true, data: { ...purchase, status: resolved } });
});

module.exports = router;
