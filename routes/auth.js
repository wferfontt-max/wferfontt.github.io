const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND is_active = 1').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  db.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
  db.prepare('INSERT INTO activity_log (admin_id, admin_username, action, details) VALUES (?, ?, ?, ?)').run(admin.id, admin.username, 'LOGIN', 'Inicio de sesión exitoso');

  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  req.session.adminRole = admin.role;

  res.json({ success: true, data: { id: admin.id, username: admin.username, email: admin.email, role: admin.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'No autenticado' });
  const db = getDb();
  const admin = db.prepare('SELECT id, username, email, role, created_at, last_login FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin) { req.session.destroy(); return res.status(401).json({ error: 'Sesión inválida' }); }
  res.json({ success: true, data: admin });
});

module.exports = router;
