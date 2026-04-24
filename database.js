const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'furious.db');
let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'moderator',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      author TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      is_published INTEGER DEFAULT 1,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      rule_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id TEXT UNIQUE,
      discord_id TEXT,
      username TEXT NOT NULL,
      email TEXT,
      status TEXT DEFAULT 'active',
      ban_reason TEXT,
      whitelist_status TEXT DEFAULT 'pending',
      total_hours REAL DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      age INTEGER,
      nationality TEXT,
      faction_id INTEGER REFERENCES factions(id),
      occupation TEXT,
      backstory TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS factions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      description TEXT,
      color TEXT DEFAULT '#ff4500',
      type TEXT DEFAULT 'civilian',
      leader TEXT,
      member_count INTEGER DEFAULT 0,
      is_recruiting INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER REFERENCES admins(id),
      admin_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      title TEXT NOT NULL,
      bio TEXT,
      photo_url TEXT,
      discord TEXT,
      member_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      joined_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      avatar_url TEXT,
      discord TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      title TEXT NOT NULL,
      content TEXT,
      image_url TEXT,
      category TEXT DEFAULT 'general',
      likes INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      image_url TEXT,
      price REAL DEFAULT 0,
      weight REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      discord_username TEXT,
      discord_id TEXT,
      avatar_url TEXT,
      last_login DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      item_price REAL NOT NULL,
      buy_order TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      webpay_token TEXT,
      transaction_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
  `);

  // Default superadmin
  const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 12);
    db.prepare('INSERT INTO admins (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@furiousin.com', hash, 'superadmin');
  }

  // Default settings
  const defaultSettings = [
    ['server_name', 'Furious Industries RP', 'Nombre del servidor'],
    ['server_ip', 'play.furiousin.com', 'IP del servidor'],
    ['server_port', '30120', 'Puerto del servidor'],
    ['discord_url', 'https://discord.gg/furiousind', 'Enlace de Discord'],
    ['max_players', '64', 'Máximo de jugadores'],
    ['whitelist_enabled', 'true', 'Whitelist activo'],
    ['maintenance_mode', 'false', 'Modo mantenimiento'],
    ['players_online', '0', 'Jugadores online ahora'],
    ['store_payment_url', '#', 'URL de pago WebPay (link de checkout)'],
    ['store_enabled', 'true', 'Tienda habilitada'],
    ['forum_enabled', 'true', 'Foro habilitado'],
    ['webpay_return_path', '/tienda/confirmacion', 'Ruta de retorno tras pago WebPay'],
    ['site_url', 'http://localhost:3000', 'URL pública del sitio (para links en emails)'],
    ['smtp_host', '', 'SMTP Host (ej: smtp.gmail.com)'],
    ['smtp_port', '587', 'SMTP Puerto (587 TLS / 465 SSL)'],
    ['smtp_user', '', 'SMTP Usuario / Email remitente'],
    ['smtp_pass', '', 'SMTP Contraseña o App Password'],
    ['smtp_from', '', 'Email que aparece como remitente'],
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO server_settings (key, value, description) VALUES (?, ?, ?)');
  for (const s of defaultSettings) insertSetting.run(...s);

  // Default factions
  if (db.prepare('SELECT COUNT(*) as c FROM factions').get().c === 0) {
    const factions = [
      ['Los Santos Police Department', 'LSPD', 'Mantiene el orden y la ley en Los Santos. Protege a los ciudadanos con valor e integridad.', '#1e40af', 'police', 'Capitán Rodríguez', 12],
      ['Furious Medical Services', 'FMS', 'El equipo médico de emergencias que salva vidas en las calles de Los Santos cada día.', '#16a34a', 'emergency', 'Dra. Martínez', 8],
      ['Cartel del Norte', 'CDN', 'La organización criminal más poderosa del norte. Controlan el tráfico y los negocios oscuros.', '#dc2626', 'criminal', 'El Jefe', 15],
      ['Yakuza de Los Santos', 'YLS', 'Antigua familia criminal japonesa que domina los casinos y negocios del este de la ciudad.', '#7c3aed', 'criminal', 'Oyabun Tanaka', 10],
      ['Mechanics Unidos', 'MU', 'El mejor taller mecánico de la ciudad. Reparan todo tipo de vehículos, incluyendo los especiales.', '#d97706', 'civilian', 'Big Mike', 6],
      ['Abogados & Asociados', 'A&A', 'El bufete más influyente de Los Santos. Defienden a los poderosos ante la ley.', '#0891b2', 'civilian', 'Lic. Pérez', 5],
    ];
    const ins = db.prepare('INSERT INTO factions (name, short_name, description, color, type, leader, member_count) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const f of factions) ins.run(...f);
  }

  // Default rules
  if (db.prepare('SELECT COUNT(*) as c FROM rules').get().c === 0) {
    const rules = [
      ['Reglas Generales', 'No al Metagaming', 'Está prohibido usar información OOC para beneficiar a tu personaje IC. Esto incluye info de streams, Discord o conversaciones privadas.', 1],
      ['Reglas Generales', 'No al Powergaming', 'No puedes forzar acciones sobre otros jugadores sin darles oportunidad de responder. El RP debe ser mutuo.', 2],
      ['Reglas Generales', 'Fear RP', 'Tu personaje debe actuar con miedo realista ante peligro de muerte. No puedes ignorar amenazas directas a tu vida.', 3],
      ['Reglas Generales', 'Respeto Mutuo', 'Se requiere respeto entre todos los jugadores IC y OOC. El acoso y la discriminación están prohibidos.', 4],
      ['Reglas de Combate', 'Random Deathmatch (RDM)', 'Atacar a otro jugador sin motivo de RP válido está estrictamente prohibido. Siempre debe existir razón IC.', 5],
      ['Reglas de Combate', 'Vehicle Deathmatch (VDM)', 'Usar vehículos como armas sin contexto de RP está prohibido. Accidentes intencionales también.', 6],
      ['Reglas de Combate', 'Combat Logging', 'Salir del servidor durante una situación de RP activa (combate, arresto) está prohibido.', 7],
      ['Reglas de Vehículos', 'Conducción Realista', 'Los vehículos deben conducirse de manera semi-realista. Reckless driving extremo sin contexto está prohibido.', 8],
      ['Reglas de Vehículos', 'Zonas Seguras', 'Hospitales y comisarías son zonas seguras. Ningún conflicto puede iniciarse en estas áreas.', 9],
      ['Reglas de Economía', 'No a las Trampas', 'Explotar bugs, duplicar dinero o cualquier forma de trampa económica resulta en ban permanente.', 10],
    ];
    const ins = db.prepare('INSERT INTO rules (category, title, content, rule_order) VALUES (?, ?, ?, ?)');
    for (const r of rules) ins.run(...r);
  }

  // Default news
  if (db.prepare('SELECT COUNT(*) as c FROM news').get().c === 0) {
    const newsItems = [
      ['Bienvenidos a Furious Industries RP v2.0', 'Estamos emocionados de anunciar el lanzamiento de la versión 2.0 de nuestro servidor. Esta actualización incluye nuevos sistemas de economía, trabajos, y grandes mejoras en el rendimiento.\n\nNuevos sistemas:\n- Sistema bancario completamente renovado\n- Nuevos empleos legales e ilegales\n- Mapa personalizado con nuevas zonas\n- Sistema de propiedad inmobiliaria\n\n¡Únete y descubre todo lo nuevo!', 'Gran actualización con nuevos sistemas de economía, empleos y mejoras de rendimiento.', 'Admin', 'update'],
      ['Evento Especial: Noche de Crimen', 'Este fin de semana organizamos un evento especial de crimen organizado con misiones únicas, recompensas exclusivas y la posibilidad de ganar vehículos raros.\n\nEl evento incluye:\n- Misiones de alto riesgo con recompensas x3\n- Vehículos exclusivos para los ganadores\n- Torneo entre facciones con territorios en juego\n\nFecha: Este sábado\nHora: 21:00 - 02:00', 'Evento de crimen organizado con recompensas x3, vehículos exclusivos y batalla de facciones.', 'Admin', 'event'],
      ['Actualización de Reglas - Lectura Obligatoria', 'Hemos actualizado el reglamento del servidor con nuevas normas importantes. Es obligatorio leer los cambios antes de continuar jugando.\n\nCambios principales:\n- Actualización de reglas de combate vehicular\n- Nuevas directrices para roleplay criminal\n- Sistema de advertencias renovado\n- Reglas específicas para zonas seguras\n\nTodos los jugadores deben confirmar que leyeron las nuevas normas en Discord.', 'Actualización importante del reglamento. Lectura obligatoria para todos los jugadores.', 'Admin', 'urgent'],
    ];
    const ins = db.prepare('INSERT INTO news (title, content, excerpt, author, category) VALUES (?, ?, ?, ?, ?)');
    for (const n of newsItems) ins.run(...n);
  }

  // Default team members
  if (db.prepare('SELECT COUNT(*) as c FROM team_members').get().c === 0) {
    const team = [
      ['Fundador', 'founder', 'Fundador & CEO', 'El visionario detrás de Furious Industries RP. Fundó el servidor con la misión de crear la comunidad de roleplay más inmersiva y comprometida de habla hispana. Su dedicación y pasión por el roleplay de calidad son el motor que impulsa todo el proyecto.', null, null, 1, '2022'],
      ['Co-Fundador', 'cofounder', 'Co-Fundador & Director', 'Pieza clave desde el primer día. Se unió al proyecto para convertir la visión en realidad, gestionando la comunidad y asegurando que cada jugador tenga la mejor experiencia posible dentro del servidor.', null, null, 2, '2022'],
      ['Programador', 'developer', 'Desarrollador Principal', 'El cerebro técnico de Furious Industries. Responsable de todos los sistemas del servidor: economía, trabajos, vehículos, propiedades y la infraestructura web. Sin él, nada de esto existiría.', null, null, 3, '2022'],
      ['Staff Manager', 'staff', 'Jefe de Staff', 'Lidera el equipo de moderación y administración del servidor. Garantiza que las reglas se cumplan y que la comunidad mantenga el ambiente sano y divertido que nos caracteriza.', null, null, 4, '2023'],
    ];
    const ins = db.prepare('INSERT INTO team_members (name, role, title, bio, photo_url, discord, member_order, joined_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of team) ins.run(...t);
  }

  // Migrations
  for (const col of ['file_url TEXT', 'file_type TEXT', 'file_name TEXT']) {
    try { db.exec(`ALTER TABLE rules ADD COLUMN ${col}`); } catch (_) {}
  }
  try { db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE users ADD COLUMN last_login DATETIME'); } catch (_) {}
  try { db.exec('ALTER TABLE donors ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch (_) {}
  try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch (_) {}
  try { db.exec('ALTER TABLE users ADD COLUMN verification_token TEXT'); } catch (_) {}

  console.log('✅ Base de datos inicializada correctamente');
  return db;
}

module.exports = { getDb, initDatabase };
