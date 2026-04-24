function requireAuth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'No autenticado. Por favor inicia sesión.' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.adminRole !== 'superadmin') return res.status(403).json({ error: 'Se requiere rol de superadmin.' });
  next();
}

module.exports = { requireAuth, requireSuperAdmin };
