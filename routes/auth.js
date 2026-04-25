const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const admin = await db.get('SELECT * FROM admins WHERE username = ? AND is_active = 1', [username]);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Credenciales inválidas' });

  await db.run('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
  await db.run(
    'INSERT INTO activity_log (admin_id, admin_username, action, details) VALUES (?, ?, ?, ?)',
    [admin.id, admin.username, 'LOGIN', 'Inicio de sesión exitoso']
  );

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  req.session.adminRole = admin.role;

  res.json({ success: true, data: { id: admin.id, username: admin.username, email: admin.email, role: admin.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/me', async (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'No autenticado' });
  const admin = await db.get(
    'SELECT id, username, email, role, created_at, last_login FROM admins WHERE id = ?',
    [req.session.adminId]
  );
  if (!admin) { req.session.destroy(); return res.status(401).json({ error: 'Sesión inválida' }); }
  res.json({ success: true, data: admin });
});

module.exports = router;
