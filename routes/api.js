const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const db = require('../db');

const imgFilter = (req, file, cb) => {
  ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.originalname).toLowerCase())
    ? cb(null, true) : cb(new Error('Solo imágenes'));
};

const forumUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: imgFilter,
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: imgFilter,
});

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

// ── NEWS ─────────────────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const category = req.query.category;
  let sql = 'SELECT id, title, excerpt, author, category, image_url, video_url, views, created_at FROM news WHERE is_published = 1';
  const params = [];
  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  res.json({ success: true, data: await db.all(sql, params) });
});

router.get('/news/:id', async (req, res) => {
  const news = await db.get('SELECT * FROM news WHERE id = ? AND is_published = 1', [req.params.id]);
  if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });
  await db.run('UPDATE news SET views = views + 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true, data: news });
});

// ── FACTIONS ──────────────────────────────────────────────────────────────────
router.get('/factions', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM factions WHERE is_active = 1 ORDER BY type, name') });
});

// ── RULES ────────────────────────────────────────────────────────────────────
router.get('/rules', async (req, res) => {
  const rules = await db.all('SELECT * FROM rules WHERE is_active = 1 ORDER BY rule_order');
  const grouped = rules.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {});
  res.json({ success: true, data: grouped });
});

// ── TEAM ─────────────────────────────────────────────────────────────────────
router.get('/team', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM team_members WHERE is_active = 1 ORDER BY member_order') });
});

// ── STORY (public) ───────────────────────────────────────────────────────────
router.get('/story', async (req, res) => {
  const rows = await db.all("SELECT key, value FROM server_settings WHERE key LIKE 'story_%'");
  const data = rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
  res.json({ success: true, data });
});

// ── STATS (public) ───────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  let registered = 0, online = 0, discord_members = 0, rating = 5.0;
  let discord_url = 'https://discord.gg/furiousind', server_ip = 'play.furiousin.com', server_port = '30120';
  try {
    const ru = await db.get('SELECT COUNT(*) as c FROM users');
    const ra = await db.get('SELECT COUNT(*) as c FROM admins');
    registered = (parseInt(String(ru?.c || 0), 10) || 0) + (parseInt(String(ra?.c || 0), 10) || 0);
  } catch (_) {}
  try {
    const rows = await db.all("SELECT key, value FROM server_settings WHERE key IN ('stats_online','stats_discord_members','discord_guild_id','discord_bot_token','discord_url','server_ip','server_port')");
    const s = rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
    online = parseInt(s.stats_online, 10) || 0;
    discord_members = parseInt(s.stats_discord_members, 10) || 0;
    if (s.discord_url) discord_url = s.discord_url;
    if (s.server_ip) server_ip = s.server_ip;
    if (s.server_port) server_port = s.server_port;
    const botToken = process.env.DISCORD_BOT_TOKEN || s.discord_bot_token || '';
    const guildId = s.discord_guild_id || '';
    if (botToken && guildId) {
      try {
        const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, { headers: { Authorization: `Bot ${botToken}` } });
        if (resp.ok) {
          const g = await resp.json();
          discord_members = g.approximate_member_count || discord_members;
          await db.run("UPDATE server_settings SET value=? WHERE key='stats_discord_members'", [String(discord_members)]);
        }
      } catch (_) {}
    }
  } catch (_) {}
  try {
    const avgRow = await db.get('SELECT AVG(rating) as avg FROM reviews');
    const avg = parseFloat(String(avgRow?.avg || ''));
    if (!isNaN(avg) && avg > 0) {
      rating = Math.round(avg * 10) / 10;
    } else {
      const sr = await db.get("SELECT value FROM server_settings WHERE key='stats_rating'");
      rating = parseFloat(sr?.value) || 5.0;
    }
  } catch (_) {
    try {
      const sr = await db.get("SELECT value FROM server_settings WHERE key='stats_rating'");
      rating = parseFloat(sr?.value) || 5.0;
    } catch (_2) {}
  }
  res.json({ success: true, data: { registered, online, discord_members, rating, discord_url, server_ip, server_port } });
});

// ── REVIEWS (public) ─────────────────────────────────────────────────────────
router.get('/reviews', async (req, res) => {
  try {
    const [reviews, summary] = await Promise.all([
      db.all('SELECT r.id, r.author_name, r.comment, r.rating, r.created_at, u.avatar_url FROM reviews r LEFT JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC LIMIT 50'),
      db.get('SELECT AVG(rating) as avg, COUNT(*) as total FROM reviews'),
    ]);
    const avg = summary?.avg ? Math.round(parseFloat(String(summary.avg)) * 10) / 10 : null;
    const total = parseInt(String(summary?.total || 0)) || 0;
    res.json({ success: true, data: reviews, avg, total });
  } catch (_) {
    res.json({ success: true, data: [], avg: null, total: 0 });
  }
});

router.post('/reviews', requireUser, async (req, res) => {
  const rating = parseInt(req.body.rating);
  const comment = (req.body.comment || '').trim().substring(0, 500);
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Valoración debe ser entre 1 y 5 estrellas' });
  try {
    const user = await db.get('SELECT full_name FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    const existing = await db.get('SELECT id FROM reviews WHERE user_id = ?', [req.session.userId]);
    if (existing) {
      await db.run('UPDATE reviews SET comment = ?, rating = ? WHERE user_id = ?', [comment, rating, req.session.userId]);
    } else {
      await db.run('INSERT INTO reviews (user_id, author_name, comment, rating) VALUES (?, ?, ?, ?)',
        [req.session.userId, user.full_name, comment, rating]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar la valoración' });
  }
});

// ── FEATURES (public) ────────────────────────────────────────────────────────
router.get('/features', async (req, res) => {
  const rows = await db.all("SELECT key, value FROM server_settings WHERE key LIKE 'feature%'");
  const data = rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
  res.json({ success: true, data });
});

// ── STORE SETTINGS (public) ───────────────────────────────────────────────────
router.get('/store/settings', async (req, res) => {
  const s = await db.get("SELECT value FROM server_settings WHERE key = 'store_payment_url'");
  res.json({ success: true, data: { payment_url: s?.value || '#' } });
});

// ── DONORS ───────────────────────────────────────────────────────────────────
router.get('/donors', async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM donors ORDER BY amount DESC LIMIT 50') });
});

// ── FORUM ────────────────────────────────────────────────────────────────────
router.get('/forum/posts', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const category = req.query.category;
  let sql = 'SELECT * FROM forum_posts WHERE is_active = 1';
  const params = [];
  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const posts = await db.all(sql, params);
  if (posts.length) {
    const ids = posts.map(p => p.id);
    const ph = ids.map(() => '?').join(',');
    const [ccRows, rcRows] = await Promise.all([
      db.all(`SELECT post_id, COUNT(*) as c FROM forum_comments WHERE post_id IN (${ph}) GROUP BY post_id`, ids),
      db.all(`SELECT post_id, emoji, COUNT(*) as c FROM forum_reactions WHERE post_id IN (${ph}) GROUP BY post_id, emoji`, ids),
    ]);
    let myReactions = {};
    if (req.session?.userId) {
      const mr = await db.all(`SELECT post_id, emoji FROM forum_reactions WHERE post_id IN (${ph}) AND user_id = ?`, [...ids, req.session.userId]);
      mr.forEach(r => { if (!myReactions[r.post_id]) myReactions[r.post_id] = []; myReactions[r.post_id].push(r.emoji); });
    }
    const ccMap = ccRows.reduce((a, r) => { a[r.post_id] = parseInt(String(r.c||0)); return a; }, {});
    const rcMap = {};
    rcRows.forEach(r => { if (!rcMap[r.post_id]) rcMap[r.post_id] = []; rcMap[r.post_id].push({ emoji: r.emoji, count: parseInt(String(r.c||0)) }); });
    posts.forEach(p => { p.comment_count = ccMap[p.id] || 0; p.reactions = rcMap[p.id] || []; p.my_reactions = myReactions[p.id] || []; });
  }
  res.json({ success: true, data: posts });
});

router.post('/forum/posts', requireUser, forumUpload.single('image'), async (req, res) => {
  const { title, content, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Título es requerido' });
  const user = await db.get('SELECT full_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
  const image_url = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
  const r = await db.run(
    'INSERT INTO forum_posts (author_name, author_avatar, title, content, image_url, category) VALUES (?, ?, ?, ?, ?, ?)',
    [user?.full_name || 'Usuario', user?.avatar_url || null, title, content || null, image_url, category || 'general']
  );
  res.json({ success: true, data: { id: r.lastInsertRowid }, message: 'Post creado exitosamente' });
});

router.post('/forum/posts/:id/like', async (req, res) => {
  await db.run('UPDATE forum_posts SET likes = likes + 1 WHERE id = ? AND is_active = 1', [req.params.id]);
  res.json({ success: true });
});

router.get('/forum/posts/:id/comments', async (req, res) => {
  const comments = await db.all('SELECT * FROM forum_comments WHERE post_id = ? ORDER BY created_at ASC', [req.params.id]);
  res.json({ success: true, data: comments });
});

router.post('/forum/posts/:id/comments', requireUser, async (req, res) => {
  const content = (req.body.content || '').trim().substring(0, 1000);
  if (!content) return res.status(400).json({ error: 'El comentario no puede estar vacío' });
  const user = await db.get('SELECT full_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
  await db.run(
    'INSERT INTO forum_comments (post_id, user_id, author_name, author_avatar, content) VALUES (?, ?, ?, ?, ?)',
    [req.params.id, req.session.userId, user.full_name, user.avatar_url || null, content]
  );
  res.json({ success: true });
});

router.get('/forum/posts/:id/reactions', async (req, res) => {
  const data = await db.all('SELECT emoji, COUNT(*) as count FROM forum_reactions WHERE post_id = ? GROUP BY emoji ORDER BY count DESC', [req.params.id]);
  let userReactions = [];
  if (req.session?.userId) {
    const ur = await db.all('SELECT emoji FROM forum_reactions WHERE post_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
    userReactions = ur.map(r => r.emoji);
  }
  res.json({ success: true, data: data.map(r => ({ emoji: r.emoji, count: parseInt(String(r.count||0)) })), userReactions });
});

router.post('/forum/posts/:id/reactions', requireUser, async (req, res) => {
  const ALLOWED = ['👍','❤️','😂','😮','😢','🔥'];
  const emoji = req.body.emoji;
  if (!ALLOWED.includes(emoji)) return res.status(400).json({ error: 'Emoji no válido' });
  const existing = await db.get('SELECT id FROM forum_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?', [req.params.id, req.session.userId, emoji]);
  if (existing) {
    await db.run('DELETE FROM forum_reactions WHERE id = ?', [existing.id]);
    res.json({ success: true, action: 'removed' });
  } else {
    await db.run('INSERT INTO forum_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)', [req.params.id, req.session.userId, emoji]);
    res.json({ success: true, action: 'added' });
  }
});

// ── REGISTER ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { full_name, birth_date, email, password, discord_username, discord_id } = req.body;
  const missing = [];
  if (!full_name?.trim())  missing.push('Nombre completo');
  if (!birth_date)         missing.push('Fecha de nacimiento');
  if (!email?.trim())      missing.push('Correo electrónico');
  if (!password)           missing.push('Contraseña');
  if (missing.length)
    return res.status(400).json({ error: `Faltan campos: ${missing.join(', ')}` });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Correo electrónico inválido' });
  if (password.length < 6)
    return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });

  if (await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]))
    return res.status(409).json({ error: 'El correo electrónico ya está registrado' });

  if (discord_id?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_id = ?', [discord_id.trim()]))
      return res.status(409).json({ error: 'Ese Discord ID ya está registrado en otra cuenta' });
  }
  if (discord_username?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_username = ?', [discord_username.trim()]))
      return res.status(409).json({ error: 'Ese nick de Discord ya está registrado en otra cuenta' });
  }

  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  const hash = bcrypt.hashSync(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(
    'INSERT INTO users (full_name, birth_date, email, password_hash, discord_username, discord_id, email_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [full_name.trim(), birth_date, email.toLowerCase().trim(), hash, discord_username?.trim() || null, discord_id?.trim() || null, token]
  );
  const user = await db.get('SELECT id, full_name, email FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  try {
    const { sendWelcomeEmail, sendVerificationEmail } = require('../services/mailer');
    sendWelcomeEmail(user).catch(() => {});
    sendVerificationEmail(user, token).catch(() => {});
  } catch (_) {}
  res.json({ success: true, message: '¡Registro exitoso! Revisa tu correo para verificar tu cuenta.' });
});

// ── VERIFY EMAIL ─────────────────────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  const user = await db.get('SELECT id, email_verified FROM users WHERE verification_token = ?', [token]);
  if (!user) return res.status(404).json({ error: 'Enlace inválido o ya utilizado' });
  if (user.email_verified) return res.json({ success: true, message: 'Tu cuenta ya estaba verificada' });
  await db.run('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);
  res.json({ success: true, message: '¡Cuenta verificada! Ya puedes iniciar sesión.' });
});

// ── ITEMS ────────────────────────────────────────────────────────────────────
router.get('/items', async (req, res) => {
  const category = req.query.category;
  let sql = 'SELECT * FROM items WHERE is_active = 1';
  const params = [];
  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY category, name';
  res.json({ success: true, data: await db.all(sql, params) });
});

// ── USER AUTH ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = await db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Credenciales incorrectas' });
  await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  req.session.userId = user.id;
  res.json({ success: true, data: { id: user.id, full_name: user.full_name, email: user.email, avatar_url: user.avatar_url } });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── USER PROFILE ─────────────────────────────────────────────────────────────
router.get('/me', requireUser, async (req, res) => {
  const user = await db.get(
    'SELECT id, full_name, birth_date, email, discord_username, discord_id, avatar_url, created_at, last_login FROM users WHERE id = ?',
    [req.session.userId]
  );
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const purchases = await db.all('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
  res.json({ success: true, data: { ...user, purchases } });
});

router.put('/me', requireUser, async (req, res) => {
  const { full_name, discord_username, discord_id } = req.body;
  if (!full_name) return res.status(400).json({ error: 'El nombre es requerido' });

  const current = await db.get('SELECT discord_username, discord_id FROM users WHERE id = ?', [req.session.userId]);

  // Discord fields are locked once set — ignore incoming value if already registered
  const newDiscordUser = current?.discord_username || discord_username?.trim() || null;
  const newDiscordId   = current?.discord_id       || discord_id?.trim()       || null;

  if (!current?.discord_id && discord_id?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_id = ? AND id != ?', [discord_id.trim(), req.session.userId]))
      return res.status(409).json({ error: 'Ese Discord ID ya está registrado en otra cuenta' });
  }
  if (!current?.discord_username && discord_username?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_username = ? AND id != ?', [discord_username.trim(), req.session.userId]))
      return res.status(409).json({ error: 'Ese nick de Discord ya está registrado en otra cuenta' });
  }

  await db.run(
    'UPDATE users SET full_name = ?, discord_username = ?, discord_id = ? WHERE id = ?',
    [full_name.trim(), newDiscordUser, newDiscordId, req.session.userId]
  );
  res.json({ success: true, message: 'Perfil actualizado' });
});

router.post('/me/avatar', requireUser, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
  const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [dataUri, req.session.userId]);
  res.json({ success: true, data: { avatar_url: dataUri } });
});

router.get('/me/purchases', requireUser, async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId]) });
});

// ── TRANSBANK HELPERS ─────────────────────────────────────────────────────────
const { WebpayPlus, Options, IntegrationApiKeys, Environment, IntegrationCommerceCodes } = require('transbank-sdk');

function getBaseUrl(req, siteUrl) {
  const url = siteUrl?.replace(/\/$/, '') || '';
  // If site_url is localhost or empty, use the actual request host (Railway URL)
  if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return url;
}

async function getWebpayTx() {
  const rows = await db.all(
    "SELECT key, value FROM server_settings WHERE key IN ('transbank_environment','transbank_commerce_code','transbank_api_key')"
  );
  const s = rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
  const env = (s.transbank_environment || 'integration').toLowerCase().trim();

  if (env === 'production') {
    const code = s.transbank_commerce_code;
    const key  = s.transbank_api_key;
    if (!code || !key) throw new Error('Código de comercio o API key de producción no configurados en el panel admin');
    return new WebpayPlus.Transaction(new Options(code, key, Environment.Production));
  }

  // Integration: solo usar credenciales de la BD si están configuradas ambas; mezclar una sola da 401
  const hasCustom = s.transbank_commerce_code && s.transbank_api_key;
  const code = hasCustom ? s.transbank_commerce_code : IntegrationCommerceCodes.WEBPAY_PLUS;
  const key  = hasCustom ? s.transbank_api_key       : IntegrationApiKeys.WEBPAY;
  return new WebpayPlus.Transaction(new Options(code, key, Environment.Integration));
}

async function creditDonor(userId, amount, token) {
  if (!userId) return;
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return;
    const existing = await db.get('SELECT id FROM donors WHERE user_id = ?', [userId]);
    if (existing) {
      await db.run('UPDATE donors SET amount = amount + ?, avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?',
        [amount, user.avatar_url || null, userId]);
    } else {
      await db.run('INSERT INTO donors (username, amount, avatar_url, discord, user_id) VALUES (?, ?, ?, ?, ?)',
        [user.full_name, amount, user.avatar_url || null, user.discord_username || null, userId]);
    }
  } catch (_) {}
}

// ── STORE BUY ────────────────────────────────────────────────────────────────
router.post('/store/buy', requireUser, async (req, res) => {
  const { item_id } = req.body;
  const item = await db.get('SELECT * FROM items WHERE id = ? AND is_active = 1', [item_id]);
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });

  const amount = Math.round(item.price);
  if (amount < 1) return res.status(400).json({ error: 'Este artículo no tiene precio configurado. Contacta al administrador.' });

  const buyOrder = `FURI${Date.now()}${req.session.userId}`.substring(0, 26);
  await db.run(
    'INSERT INTO purchases (user_id, item_id, item_name, item_price, buy_order, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.userId, item.id, item.name, item.price, buyOrder, 'pending']
  );

  try {
    const siteRow = await db.get("SELECT value FROM server_settings WHERE key = 'site_url'");
    const base = getBaseUrl(req, siteRow?.value);
    const tx = await getWebpayTx();
    const tbk = await tx.create(buyOrder, String(req.session.userId), amount, `${base}/api/store/webpay/return`);
    res.json({ success: true, data: { redirect_url: `${tbk.url}?token_ws=${tbk.token}`, buy_order: buyOrder } });
  } catch (err) {
    await db.run("UPDATE purchases SET status = 'failed' WHERE buy_order = ?", [buyOrder]);
    console.error('Transbank create error:', err.message, err.stack);
    res.status(500).json({ error: `Error Transbank: ${err.message}` });
  }
});

// ── CART CHECKOUT ─────────────────────────────────────────────────────────────
router.post('/store/cart-buy', requireUser, async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'El carrito está vacío' });

  const cartItems = [];
  for (const { item_id, quantity = 1 } of items) {
    const item = await db.get('SELECT * FROM items WHERE id = ? AND is_active = 1', [item_id]);
    if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });
    cartItems.push({ ...item, quantity: Math.max(1, parseInt(quantity) || 1) });
  }

  const total = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const amount = Math.round(total);
  if (amount < 1) return res.status(400).json({ error: 'El total del carrito debe ser mayor a $0.' });

  const buyOrder = `CART${Date.now()}${req.session.userId}`.substring(0, 26);

  for (const item of cartItems) {
    await db.run(
      'INSERT INTO purchases (user_id, item_id, item_name, item_price, buy_order, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.userId, item.id, `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`, item.price * item.quantity, buyOrder, 'pending']
    );
  }

  try {
    const siteRow = await db.get("SELECT value FROM server_settings WHERE key = 'site_url'");
    const base = getBaseUrl(req, siteRow?.value);
    const tx = await getWebpayTx();
    const tbk = await tx.create(buyOrder, String(req.session.userId), amount, `${base}/api/store/webpay/return`);
    res.json({ success: true, data: { redirect_url: `${tbk.url}?token_ws=${tbk.token}`, buy_order: buyOrder, total } });
  } catch (err) {
    await db.run("UPDATE purchases SET status = 'failed' WHERE buy_order = ?", [buyOrder]);
    console.error('Transbank cart error:', err.message, err.stack);
    res.status(500).json({ error: `Error Transbank: ${err.message}` });
  }
});

// ── WEBPAY RETURN (Transbank POST back after payment) ─────────────────────────
router.post('/store/webpay/return', async (req, res) => {
  const token_ws  = req.body.token_ws;
  const TBK_TOKEN = req.body.TBK_TOKEN;
  const TBK_ORDER = req.body.TBK_ORDEN_COMPRA;

  // Cancelled by user or timeout (TBK_TOKEN present, no valid token_ws)
  if (TBK_TOKEN) {
    if (TBK_ORDER) {
      await db.run(
        "UPDATE purchases SET status='failed', webpay_token=? WHERE buy_order=? AND status='pending'",
        [TBK_TOKEN, TBK_ORDER]
      ).catch(() => {});
    }
    return res.redirect('/tienda/confirmacion?result=cancelled');
  }

  if (!token_ws) return res.redirect('/tienda/confirmacion?result=error');

  try {
    const tx = await getWebpayTx();
    const resp = await tx.commit(token_ws);

    if (resp.status === 'AUTHORIZED') {
      const purchases = await db.all('SELECT * FROM purchases WHERE buy_order = ?', [resp.buy_order]);
      await db.run(
        "UPDATE purchases SET status='completed', webpay_token=?, completed_at=CURRENT_TIMESTAMP WHERE buy_order=? AND status='pending'",
        [token_ws, resp.buy_order]
      );
      const totalPaid = purchases.reduce((s, p) => s + parseFloat(p.item_price || 0), 0);
      const userId = purchases[0]?.user_id;
      if (userId) await creditDonor(userId, totalPaid, token_ws);
      return res.redirect(`/tienda/confirmacion?buy_order=${encodeURIComponent(resp.buy_order)}&result=success`);
    } else {
      await db.run(
        "UPDATE purchases SET status='failed', webpay_token=? WHERE buy_order=? AND status='pending'",
        [token_ws, resp.buy_order]
      );
      return res.redirect(`/tienda/confirmacion?buy_order=${encodeURIComponent(resp.buy_order)}&result=failed`);
    }
  } catch (err) {
    console.error('Transbank commit error:', err.message);
    return res.redirect('/tienda/confirmacion?result=error');
  }
});

// ── STORE STATUS ──────────────────────────────────────────────────────────────
router.get('/store/status', requireUser, async (req, res) => {
  const { buy_order } = req.query;
  if (!buy_order) return res.status(400).json({ error: 'buy_order requerido' });
  const purchases = await db.all(
    'SELECT * FROM purchases WHERE buy_order = ? AND user_id = ? ORDER BY created_at ASC',
    [buy_order, req.session.userId]
  );
  if (!purchases.length) return res.status(404).json({ error: 'Compra no encontrada' });
  res.json({ success: true, data: purchases });
});

module.exports = router;
