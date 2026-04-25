const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./database');

// Ensure uploads directories exist
for (const dir of ['rules', 'forum', 'items', 'avatars']) {
  const p = path.join(__dirname, 'public', 'uploads', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'furious-industries-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/api'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/tienda', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tienda.html')));
app.get('/foro', (req, res) => res.sendFile(path.join(__dirname, 'public', 'foro.html')));
app.get('/items', (req, res) => res.sendFile(path.join(__dirname, 'public', 'items.html')));
app.get('/equipo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'equipo.html')));
app.get('/facciones', (req, res) => res.sendFile(path.join(__dirname, 'public', 'facciones.html')));
app.get('/noticias', (req, res) => res.sendFile(path.join(__dirname, 'public', 'noticias.html')));
app.get('/registro', (req, res) => res.sendFile(path.join(__dirname, 'public', 'registro.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/perfil', (req, res) => res.sendFile(path.join(__dirname, 'public', 'perfil.html')));
app.get('/tienda/confirmacion', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tienda-confirmacion.html')));
app.get('/verificar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'verificar.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🔥 FURIOUS INDUSTRIES RP`);
      console.log(`   Servidor: http://localhost:${PORT}`);
      console.log(`   Admin:    http://localhost:${PORT}/admin/login`);
      console.log(`   Login:    admin / admin123\n`);
    });
  })
  .catch(err => {
    console.error('❌ Error iniciando base de datos:', err.message);
    if (!process.env.DATABASE_URL) {
      console.error('   → Para producción: agrega el plugin PostgreSQL en Railway.');
    }
    process.exit(1);
  });
