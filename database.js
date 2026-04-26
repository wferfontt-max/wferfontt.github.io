const bcrypt = require('bcryptjs');
const db = require('./db');

// Schema helpers: generate compatible SQL for both PG and SQLite
const ID   = db.isPg ? 'id SERIAL PRIMARY KEY'      : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
const TS   = (col, withDef = true) =>
  db.isPg
    ? `${col} TIMESTAMP${withDef ? ' DEFAULT NOW()' : ''}`
    : `${col} DATETIME${withDef ? ' DEFAULT CURRENT_TIMESTAMP' : ''}`;

function insertOrIgnore(table, cols) {
  return db.isPg
    ? `INSERT INTO ${table} (${cols}) VALUES (${cols.split(',').map(() => '?').join(',')}) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${cols.split(',').map(() => '?').join(',')})`;
}

async function initDatabase() {
  // ── Tables ────────────────────────────────────────────────────────────────
  const tables = `
    CREATE TABLE IF NOT EXISTS admins (
      ${ID},
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'moderator',
      ${TS('created_at')},
      ${TS('last_login', false)},
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS news (
      ${ID},
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      author TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      is_published INTEGER DEFAULT 1,
      views INTEGER DEFAULT 0,
      ${TS('created_at')},
      ${TS('updated_at')}
    );

    CREATE TABLE IF NOT EXISTS rules (
      ${ID},
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      rule_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      file_url TEXT,
      file_type TEXT,
      file_name TEXT,
      ${TS('created_at')},
      ${TS('updated_at')}
    );

    CREATE TABLE IF NOT EXISTS players (
      ${ID},
      steam_id TEXT UNIQUE,
      discord_id TEXT,
      username TEXT NOT NULL,
      email TEXT,
      status TEXT DEFAULT 'active',
      ban_reason TEXT,
      whitelist_status TEXT DEFAULT 'pending',
      total_hours REAL DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      ${TS('joined_at')},
      ${TS('last_seen', false)}
    );

    CREATE TABLE IF NOT EXISTS factions (
      ${ID},
      name TEXT NOT NULL,
      short_name TEXT,
      description TEXT,
      color TEXT DEFAULT '#ff4500',
      type TEXT DEFAULT 'civilian',
      leader TEXT,
      member_count INTEGER DEFAULT 0,
      is_recruiting INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS characters (
      ${ID},
      player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      age INTEGER,
      nationality TEXT,
      faction_id INTEGER REFERENCES factions(id),
      occupation TEXT,
      backstory TEXT,
      status TEXT DEFAULT 'active',
      ${TS('created_at')},
      ${TS('updated_at')}
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      ${TS('updated_at')}
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      ${ID},
      admin_id INTEGER REFERENCES admins(id),
      admin_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS team_members (
      ${ID},
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      title TEXT NOT NULL,
      bio TEXT,
      photo_url TEXT,
      discord TEXT,
      member_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      joined_date TEXT,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS donors (
      ${ID},
      username TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      avatar_url TEXT,
      discord TEXT,
      message TEXT,
      user_id INTEGER,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS forum_posts (
      ${ID},
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      title TEXT NOT NULL,
      content TEXT,
      image_url TEXT,
      category TEXT DEFAULT 'general',
      likes INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS items (
      ${ID},
      name TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      image_url TEXT,
      price REAL DEFAULT 0,
      weight REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS users (
      ${ID},
      full_name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      discord_username TEXT,
      discord_id TEXT,
      avatar_url TEXT,
      is_active INTEGER DEFAULT 1,
      email_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      ${TS('last_login', false)},
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS purchases (
      ${ID},
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      item_price REAL NOT NULL,
      buy_order TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      webpay_token TEXT,
      transaction_id TEXT,
      ${TS('created_at')},
      ${TS('completed_at', false)}
    );

    CREATE TABLE IF NOT EXISTS reviews (
      ${ID},
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      comment TEXT DEFAULT '',
      rating INTEGER NOT NULL,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS forum_comments (
      ${ID},
      post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      content TEXT NOT NULL,
      ${TS('created_at')}
    );

    CREATE TABLE IF NOT EXISTS forum_reactions (
      ${ID},
      post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      ${TS('created_at')}
    );
  `;

  // Execute each CREATE TABLE individually for pg compatibility
  for (const stmt of tables.split(';').map(s => s.trim()).filter(s => s.length > 10)) {
    try {
      await db.exec(stmt);
    } catch (err) {
      const preview = stmt.trim().split('\n')[0].substring(0, 80);
      console.error(`❌ Schema error near: "${preview}"`);
      console.error('   Detail:', err.message);
      throw err;
    }
  }

  // ── Unique indexes for Discord fields (partial: multiple NULLs allowed) ────
  for (const [name, col] of [
    ['users_discord_id_uq',       'discord_id'],
    ['users_discord_username_uq', 'discord_username'],
  ]) {
    // Nullify empty strings and duplicate values — keep only the first per value
    try {
      await db.exec(`UPDATE users SET ${col} = NULL WHERE ${col} = ''`);
      await db.exec(
        `UPDATE users SET ${col} = NULL WHERE ${col} IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM users WHERE ${col} IS NOT NULL GROUP BY ${col})`
      );
    } catch (_) {}
    // Create index; if it still fails (e.g. race condition), warn and continue
    try {
      await db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON users(${col}) WHERE ${col} IS NOT NULL`
      );
    } catch (e) {
      console.warn(`⚠️  Índice ${name} no creado: ${e.message}`);
    }
  }

  // ── Default superadmin ────────────────────────────────────────────────────
  const adminExists = await db.get('SELECT id FROM admins WHERE username = ?', ['admin']);
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 12);
    await db.run(
      'INSERT INTO admins (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['admin', 'admin@furiousin.com', hash, 'superadmin']
    );
  }

  // ── Default settings ──────────────────────────────────────────────────────
  const defaults = [
    ['server_name', 'Furious Industries RP', 'Nombre del servidor'],
    ['server_ip', 'play.furiousin.com', 'IP del servidor'],
    ['server_port', '30120', 'Puerto del servidor'],
    ['discord_url', 'https://discord.gg/furiousind', 'Enlace de Discord'],
    ['max_players', '64', 'Máximo de jugadores'],
    ['whitelist_enabled', 'true', 'Whitelist activo'],
    ['maintenance_mode', 'false', 'Modo mantenimiento'],
    ['players_online', '0', 'Jugadores online ahora'],
    ['store_payment_url', '#', 'URL de pago WebPay'],
    ['store_enabled', 'true', 'Tienda habilitada'],
    ['forum_enabled', 'true', 'Foro habilitado'],
    ['webpay_return_path', '/tienda/confirmacion', 'Ruta retorno WebPay'],
    ['site_url', 'http://localhost:3000', 'URL pública del sitio'],
    ['smtp_host', '', 'SMTP Host'],
    ['smtp_port', '587', 'SMTP Puerto'],
    ['smtp_user', '', 'SMTP Usuario'],
    ['smtp_pass', '', 'SMTP Contraseña'],
    ['smtp_from', '', 'Email remitente'],
    ['story_act1_title', 'EL ORIGEN', 'Historia Act I: Título'],
    ['story_act1_body', 'En los rincones olvidados de internet, donde nacen los proyectos más improbables, surgió en 2024 una idea que nadie tomó demasiado en serio al principio: Furious Roleplay. Todo comenzó como una simple comunidad entre amigos, un pequeño servidor donde unos pocos jugadores querían escapar de la rutina y construir historias propias, sin límites ni reglas rígidas.\n\nAl principio, Furious era caótico. No había estructura clara, los roles se mezclaban, las historias se cruzaban de forma absurda, y los errores eran parte del día a día. Pero había algo especial: la gente no se quería ir. Cada usuario aportaba un pedazo de imaginación, y poco a poco, lo que parecía un proyecto improvisado empezó a tomar forma.\n\nDurante meses, la comunidad creció. Nuevas ciudades, personajes más complejos, tramas que se extendían por semanas. Furious Roleplay dejó de ser solo un pasatiempo para convertirse en un pequeño universo vivo. Pero como muchas historias intensas, el desgaste llegó.', 'Historia Act I: Texto (párrafos separados por línea en blanco)'],
    ['story_act2_title', 'EL SILENCIO', 'Historia Act II: Título'],
    ['story_act2_p1', 'A finales de ese mismo ciclo, los administradores comenzaron a desaparecer. Algunos por estudios, otros por trabajo, otros simplemente porque la vida fuera de la pantalla exigía atención. El servidor empezó a quedarse en silencio. Las calles virtuales que antes estaban llenas de historias quedaron vacías.', 'Historia Act II: Párrafo 1'],
    ['story_act2_quote', 'Y entonces pasó lo inevitable: Furious cerró.', 'Historia Act II: Cita destacada'],
    ['story_act2_p2', 'Durante un año completo, no hubo señales. Solo recuerdos. Algunos antiguos miembros hablaban del servidor como una leyenda perdida, algo que fue especial mientras duró. Otros intentaron recrearlo, pero nada se sentía igual.', 'Historia Act II: Párrafo 2'],
    ['story_act3_title', 'EL REGRESO', 'Historia Act III: Título'],
    ['story_act3_p1', 'Hasta que, sin previo aviso, algo cambió.\n\nUn mensaje apareció en antiguos canales, en contactos olvidados, en rincones donde aún quedaban huellas:', 'Historia Act III: Párrafos antes del anuncio (separados por línea en blanco)'],
    ['story_announce_msg', '"Furious vuelve."', 'Historia: Mensaje del anuncio'],
    ['story_act3_post', 'Pero esta vez no era improvisado. El regreso será distinto. Habrá aprendido de sus errores. Tendrá nuevos sistemas, una administración más sólida y reglas claras, pero sin perder la esencia creativa que lo hará especial. Los antiguos jugadores regresarán, y con ellos llegarán nuevos curiosos que querrán formar parte de algo que ya tendrá historia.\n\nFurious Roleplay dejará de ser solo un servidor: se convertirá en una segunda oportunidad.\n\nLas calles volverán a llenarse, las historias crecerán con más fuerza, y la comunidad entenderá algo importante: no se tratará solo del juego, sino de las personas que lo construirán.\n\nY esta vez, no habrá planes de desaparecer.', 'Historia Act III: Texto después del anuncio (párrafos separados por línea en blanco)'],
    ['story_closer_quote', 'Porque Furious ya no será un experimento.<br>Será un mundo que, contra todo pronóstico, ha decidido quedarse.', 'Historia: Cita de cierre'],
    ['story_image1', '/img/historia.jpg', 'Historia: URL de imagen (entre Acto I y Acto II)'],
    ['stats_online', '0', 'Estadísticas: Jugadores en línea (manual)'],
    ['stats_rating', '5.0', 'Estadísticas: Valoración del servidor (ej: 4.9)'],
    ['stats_discord_members', '0', 'Estadísticas: Miembros Discord (se actualiza automático)'],
    ['discord_guild_id', '', 'Discord: ID del servidor (para contar miembros)'],
    ['discord_bot_token', '', 'Discord: Token del bot (para contar miembros)'],
    ['features_section_tag', '¿Por qué elegirnos?', 'Características: Etiqueta de sección'],
    ['features_section_title', 'Una Experiencia Única', 'Características: Título de sección'],
    ['features_section_subtitle', 'Furious Industries ofrece el mejor roleplay con sistemas únicos y una comunidad increíble', 'Características: Subtítulo de sección'],
    ['feature_1_icon', '🚗', 'Característica 1: Ícono (emoji)'],
    ['feature_1_title', 'Vehículos Custom', 'Característica 1: Título'],
    ['feature_1_desc', 'Más de 500 vehículos únicos con modificaciones personalizadas y sistemas de tunning avanzados exclusivos.', 'Característica 1: Descripción'],
    ['feature_2_icon', '💼', 'Característica 2: Ícono (emoji)'],
    ['feature_2_title', 'Empleos Únicos', 'Característica 2: Título'],
    ['feature_2_desc', 'Decenas de trabajos legales e ilegales con progresión real, jerarquías y recompensas exclusivas.', 'Característica 2: Descripción'],
    ['feature_3_icon', '🏠', 'Característica 3: Ícono (emoji)'],
    ['feature_3_title', 'Sistema Inmobiliario', 'Característica 3: Título'],
    ['feature_3_desc', 'Compra, vende y alquila propiedades en la ciudad. Desde apartamentos hasta mansiones y negocios.', 'Característica 3: Descripción'],
    ['feature_4_icon', '💰', 'Característica 4: Ícono (emoji)'],
    ['feature_4_title', 'Economía Real', 'Característica 4: Título'],
    ['feature_4_desc', 'Sistema económico balanceado con bancos, inversiones, mercado negro y sistema de impuestos.', 'Característica 4: Descripción'],
    ['feature_5_icon', '⚔️', 'Característica 5: Ícono (emoji)'],
    ['feature_5_title', 'Territorios y Guerras', 'Característica 5: Título'],
    ['feature_5_desc', 'Controla territorios estratégicos, establece alianzas y domina la ciudad con tu organización.', 'Característica 5: Descripción'],
    ['feature_6_icon', '🎭', 'Característica 6: Ícono (emoji)'],
    ['feature_6_title', 'Eventos Especiales', 'Característica 6: Título'],
    ['feature_6_desc', 'Eventos temáticos regulares con recompensas exclusivas y experiencias únicas creadas por el staff.', 'Característica 6: Descripción'],
  ];
  const insSettingSQL = db.isPg
    ? 'INSERT INTO server_settings (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    : 'INSERT OR IGNORE INTO server_settings (key, value, description) VALUES (?, ?, ?)';
  for (const s of defaults) await db.run(insSettingSQL, s);

  // ── Default factions ──────────────────────────────────────────────────────
  const fcCount = await db.get('SELECT COUNT(*) as c FROM factions');
  if (parseInt(fcCount.c) === 0) {
    const fcs = [
      ['Los Santos Police Department','LSPD','Mantiene el orden y la ley en Los Santos.','#1e40af','police','Capitán Rodríguez',12],
      ['Furious Medical Services','FMS','El equipo médico de emergencias.','#16a34a','emergency','Dra. Martínez',8],
      ['Cartel del Norte','CDN','La organización criminal más poderosa del norte.','#dc2626','criminal','El Jefe',15],
      ['Yakuza de Los Santos','YLS','Antigua familia criminal japonesa.','#7c3aed','criminal','Oyabun Tanaka',10],
      ['Mechanics Unidos','MU','El mejor taller mecánico de la ciudad.','#d97706','civilian','Big Mike',6],
      ['Abogados & Asociados','A&A','El bufete más influyente de Los Santos.','#0891b2','civilian','Lic. Pérez',5],
    ];
    for (const f of fcs) {
      await db.run('INSERT INTO factions (name,short_name,description,color,type,leader,member_count) VALUES (?,?,?,?,?,?,?)', f);
    }
  }

  // ── Default rules ─────────────────────────────────────────────────────────
  const ruCount = await db.get('SELECT COUNT(*) as c FROM rules');
  if (parseInt(ruCount.c) === 0) {
    const rules = [
      ['Reglas Generales','No al Metagaming','Está prohibido usar información OOC para beneficiar a tu personaje IC.',1],
      ['Reglas Generales','No al Powergaming','No puedes forzar acciones sobre otros jugadores sin darles oportunidad de responder.',2],
      ['Reglas Generales','Fear RP','Tu personaje debe actuar con miedo realista ante peligro de muerte.',3],
      ['Reglas Generales','Respeto Mutuo','Se requiere respeto entre todos los jugadores IC y OOC.',4],
      ['Reglas de Combate','Random Deathmatch (RDM)','Atacar a otro jugador sin motivo de RP válido está estrictamente prohibido.',5],
      ['Reglas de Combate','Vehicle Deathmatch (VDM)','Usar vehículos como armas sin contexto de RP está prohibido.',6],
      ['Reglas de Combate','Combat Logging','Salir del servidor durante una situación de RP activa está prohibido.',7],
      ['Reglas de Vehículos','Conducción Realista','Los vehículos deben conducirse de manera semi-realista.',8],
      ['Reglas de Vehículos','Zonas Seguras','Hospitales y comisarías son zonas seguras.',9],
      ['Reglas de Economía','No a las Trampas','Explotar bugs o duplicar dinero resulta en ban permanente.',10],
    ];
    for (const r of rules) {
      await db.run('INSERT INTO rules (category,title,content,rule_order) VALUES (?,?,?,?)', r);
    }
  }

  // ── Default news ──────────────────────────────────────────────────────────
  const nwCount = await db.get('SELECT COUNT(*) as c FROM news');
  if (parseInt(nwCount.c) === 0) {
    const news = [
      ['Bienvenidos a Furious Industries RP v2.0','Gran actualización con nuevos sistemas de economía, empleos y mejoras de rendimiento.','Admin','update'],
      ['Evento Especial: Noche de Crimen','Evento de crimen organizado con recompensas x3, vehículos exclusivos y batalla de facciones.','Admin','event'],
      ['Actualización de Reglas - Lectura Obligatoria','Actualización importante del reglamento. Lectura obligatoria para todos los jugadores.','Admin','urgent'],
    ];
    for (const n of news) {
      await db.run('INSERT INTO news (title,content,excerpt,author,category) VALUES (?,?,?,?,?)',
        [n[0], n[1], n[1], n[2], n[3]]);
    }
  }

  // ── Default team ──────────────────────────────────────────────────────────
  const tmCount = await db.get('SELECT COUNT(*) as c FROM team_members');
  if (parseInt(tmCount.c) === 0) {
    const team = [
      ['Fundador','founder','Fundador & CEO','El visionario detrás de Furious Industries RP.',null,null,1,'2022'],
      ['Co-Fundador','cofounder','Co-Fundador & Director','Pieza clave desde el primer día.',null,null,2,'2022'],
      ['Programador','developer','Desarrollador Principal','El cerebro técnico de Furious Industries.',null,null,3,'2022'],
      ['Staff Manager','staff','Jefe de Staff','Lidera el equipo de moderación.',null,null,4,'2023'],
    ];
    for (const t of team) {
      await db.run('INSERT INTO team_members (name,role,title,bio,photo_url,discord,member_order,joined_date) VALUES (?,?,?,?,?,?,?,?)', t);
    }
  }

  console.log(`✅ Base de datos inicializada (${db.isPg ? 'PostgreSQL' : 'SQLite'})`);
}

module.exports = { initDatabase };
