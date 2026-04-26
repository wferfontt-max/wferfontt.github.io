const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const db = require('../db');

const forumDir = path.join(__dirname, '..', 'public', 'uploads', 'forum');
const forumUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, forumDir),
    filename: (req, file, cb) => cb(null, `forum_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads', 'avatars')),
    filename: (req, file, cb) => cb(null, `avatar_${req.session.userId}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true) : cb(new Error('Solo imágenes'));
  },
});

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

// ── NEWS ─────────────────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const category = req.query.category;
  let sql = 'SELECT id, title, excerpt, author, category, views, created_at FROM news WHERE is_published = 1';
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

// ── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const [settings, totalPlayers, activeFactions, totalChars] = await Promise.all([
    db.all("SELECT key, value FROM server_settings WHERE key IN ('players_online','server_ip','discord_url','server_port')"),
    db.get('SELECT COUNT(*) as c FROM players'),
    db.get('SELECT COUNT(*) as c FROM factions WHERE is_active = 1'),
    db.get('SELECT COUNT(*) as c FROM characters'),
  ]);
  const s = settings.reduce((a, x) => { a[x.key] = x.value; return a; }, {});
  res.json({
    success: true,
    data: {
      players_online: parseInt(s.players_online) || 0,
      total_players: parseInt(totalPlayers.c),
      active_factions: parseInt(activeFactions.c),
      total_characters: parseInt(totalChars.c),
      server_ip: s.server_ip || 'play.furiousin.com',
      server_port: s.server_port || '30120',
      discord_url: s.discord_url || '#',
    }
  });
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
  try {
    const userCount = await db.get('SELECT COUNT(*) as c FROM users');
    const rows = await db.all("SELECT key, value FROM server_settings WHERE key IN ('stats_online','stats_rating','stats_discord_members','discord_guild_id','discord_bot_token')");
    const s = rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
    let discordMembers = parseInt(s.stats_discord_members || 0);
    const botToken = process.env.DISCORD_BOT_TOKEN || s.discord_bot_token || '';
    const guildId = s.discord_guild_id || '';
    if (botToken && guildId) {
      try {
        const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, { headers: { Authorization: `Bot ${botToken}` } });
        if (r.ok) {
          const g = await r.json();
          discordMembers = g.approximate_member_count || discordMembers;
          await db.run("UPDATE server_settings SET value=? WHERE key='stats_discord_members'", [String(discordMembers)]);
        }
      } catch (_) {}
    }
    res.json({ success: true, data: { registered: Number(userCount?.c) || 0, online: Number(s.stats_online) || 0, discord_members: Number(discordMembers) || 0, rating: Number(s.stats_rating) || 5.0 } });
  } catch (_) {
    res.json({ success: true, data: { registered: 0, online: 0, discord_members: 0, rating: 5.0 } });
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
  res.json({ success: true, data: await db.all(sql, params) });
});

router.post('/forum/posts', requireUser, forumUpload.single('image'), async (req, res) => {
  const { title, content, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Título es requerido' });
  const user = await db.get('SELECT full_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
  const image_url = req.file ? `/uploads/forum/${req.file.filename}` : null;
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

  if (discord_id?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_id = ? AND id != ?', [discord_id.trim(), req.session.userId]))
      return res.status(409).json({ error: 'Ese Discord ID ya está registrado en otra cuenta' });
  }
  if (discord_username?.trim()) {
    if (await db.get('SELECT id FROM users WHERE discord_username = ? AND id != ?', [discord_username.trim(), req.session.userId]))
      return res.status(409).json({ error: 'Ese nick de Discord ya está registrado en otra cuenta' });
  }

  await db.run(
    'UPDATE users SET full_name = ?, discord_username = ?, discord_id = ? WHERE id = ?',
    [full_name.trim(), discord_username?.trim() || null, discord_id?.trim() || null, req.session.userId]
  );
  res.json({ success: true, message: 'Perfil actualizado' });
});

router.post('/me/avatar', requireUser, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen' });
  const url = `/uploads/avatars/${req.file.filename}`;
  await db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [url, req.session.userId]);
  res.json({ success: true, data: { avatar_url: url } });
});

router.get('/me/purchases', requireUser, async (req, res) => {
  res.json({ success: true, data: await db.all('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId]) });
});

// ── STORE BUY ────────────────────────────────────────────────────────────────
router.post('/store/buy', requireUser, async (req, res) => {
  const { item_id } = req.body;
  const item = await db.get('SELECT * FROM items WHERE id = ? AND is_active = 1', [item_id]);
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });
  const payRow = await db.get("SELECT value FROM server_settings WHERE key = 'store_payment_url'");
  if (!payRow?.value || payRow.value === '#')
    return res.status(400).json({ error: 'URL de pago no configurada. Contacta al administrador.' });
  const buyOrder = `FURI-${Date.now()}-${req.session.userId}`;
  await db.run(
    'INSERT INTO purchases (user_id, item_id, item_name, item_price, buy_order, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.userId, item.id, item.name, item.price, buyOrder, 'pending']
  );
  const returnUrl = `${req.protocol}://${req.get('host')}/tienda/confirmacion?buy_order=${encodeURIComponent(buyOrder)}`;
  const sep = payRow.value.includes('?') ? '&' : '?';
  const redirectUrl = `${payRow.value}${sep}amount=${item.price}&buy_order=${encodeURIComponent(buyOrder)}&item=${encodeURIComponent(item.name)}&return_url=${encodeURIComponent(returnUrl)}`;
  res.json({ success: true, data: { redirect_url: redirectUrl, buy_order: buyOrder } });
});

// ── CART CHECKOUT ─────────────────────────────────────────────────────────────
router.post('/store/cart-buy', requireUser, async (req, res) => {
  const { items } = req.body; // [{item_id, quantity}]
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'El carrito está vacío' });

  const payRow = await db.get("SELECT value FROM server_settings WHERE key = 'store_payment_url'");
  if (!payRow?.value || payRow.value === '#')
    return res.status(400).json({ error: 'URL de pago no configurada. Contacta al administrador.' });

  const cartItems = [];
  for (const { item_id, quantity = 1 } of items) {
    const item = await db.get('SELECT * FROM items WHERE id = ? AND is_active = 1', [item_id]);
    if (!item) return res.status(404).json({ error: `Artículo no encontrado` });
    cartItems.push({ ...item, quantity: Math.max(1, parseInt(quantity) || 1) });
  }

  const total = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const buyOrder = `CART-${Date.now()}-${req.session.userId}`;
  const itemSummary = cartItems.map(i => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');

  for (const item of cartItems) {
    await db.run(
      'INSERT INTO purchases (user_id, item_id, item_name, item_price, buy_order, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.userId, item.id, `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`, item.price * item.quantity, buyOrder, 'pending']
    );
  }

  const returnUrl = `${req.protocol}://${req.get('host')}/tienda/confirmacion?buy_order=${encodeURIComponent(buyOrder)}`;
  const sep = payRow.value.includes('?') ? '&' : '?';
  const redirectUrl = `${payRow.value}${sep}amount=${Math.round(total)}&buy_order=${encodeURIComponent(buyOrder)}&item=${encodeURIComponent(itemSummary)}&return_url=${encodeURIComponent(returnUrl)}`;
  res.json({ success: true, data: { redirect_url: redirectUrl, buy_order: buyOrder, total } });
});

router.get('/store/confirm', async (req, res) => {
  const { buy_order, status } = req.query;
  if (!buy_order) return res.status(400).json({ error: 'buy_order requerido' });
  const purchase = await db.get('SELECT * FROM purchases WHERE buy_order = ?', [buy_order]);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
  if (purchase.status === 'pending') {
    const resolved = (status === 'success' || status === 'AUTHORIZED') ? 'completed' : 'failed';
    await db.run('UPDATE purchases SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE buy_order = ?', [resolved, buy_order]);
    purchase.status = resolved;
  }
  res.json({ success: true, data: purchase });
});

router.post('/store/confirm', async (req, res) => {
  const { buy_order, token_ws, TBK_TOKEN } = req.body;
  if (!buy_order && !token_ws && !TBK_TOKEN) return res.status(400).json({ error: 'Parámetros requeridos' });
  const bo = buy_order || '';
  const purchase = await db.get('SELECT * FROM purchases WHERE buy_order = ?', [bo]);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada' });
  const resolved = TBK_TOKEN ? 'failed' : 'completed';
  if (purchase.status === 'pending') {
    await db.run(
      'UPDATE purchases SET status = ?, webpay_token = ?, completed_at = CURRENT_TIMESTAMP WHERE buy_order = ?',
      [resolved, token_ws || TBK_TOKEN || null, bo]
    );
    if (resolved === 'completed') {
      try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [purchase.user_id]);
        if (user) {
          const existing = await db.get('SELECT * FROM donors WHERE user_id = ?', [purchase.user_id]);
          if (existing) {
            await db.run('UPDATE donors SET amount = amount + ?, avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?',
              [purchase.item_price, user.avatar_url || null, purchase.user_id]);
          } else {
            await db.run('INSERT INTO donors (username, amount, avatar_url, discord, user_id) VALUES (?, ?, ?, ?, ?)',
              [user.full_name, purchase.item_price, user.avatar_url || null, user.discord_username || null, user.id]);
          }
        }
      } catch (_) {}
    }
  }
  res.json({ success: true, data: { ...purchase, status: resolved } });
});

module.exports = router;
