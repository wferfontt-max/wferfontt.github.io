const nodemailer = require('nodemailer');
const db = require('../db');

async function getSmtpConfig() {
  const rows = await db.all(
    "SELECT key, value FROM server_settings WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','site_url')"
  );
  return rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
}

function createTransporter(cfg) {
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) {
    console.warn('[mailer] SMTP no configurado — smtp_host:', cfg.smtp_host || '(vacío)', '/ smtp_user:', cfg.smtp_user || '(vacío)');
    return null;
  }
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port) || 587,
    secure: parseInt(cfg.smtp_port) === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls: { rejectUnauthorized: false },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

const BASE_STYLE = `font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0b0b16;color:#fff;border-radius:12px;padding:32px;border:1px solid #1e1e30;`;
const HEADER = `<div style="text-align:center;margin-bottom:24px;"><span style="font-size:2rem;">⚡</span><h1 style="font-size:1.1rem;color:#ff4500;margin:8px 0 0;font-family:Arial,sans-serif;">FURIOUS INDUSTRIES RP</h1></div>`;
const HR = `<hr style="border:none;border-top:1px solid #1e1e30;margin:24px 0;">`;
const BTN = (link, label) => `<div style="text-align:center;margin:28px 0;"><a href="${link}" style="display:inline-block;padding:14px 32px;background:#ff4500;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:.95rem;">${label}</a></div>`;

function esc(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

async function sendVerificationEmail(user, token) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${siteUrl}/verificar?token=${token}`;
  try {
    await transporter.sendMail({
      from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
      to: user.email,
      subject: '✅ Verifica tu cuenta — Furious Industries RP',
      html: `<div style="${BASE_STYLE}">${HEADER}
        <h2 style="color:#fff;font-size:1.1rem;">Hola, ${esc(user.full_name)}!</h2>
        <p style="color:#8888aa;line-height:1.6;">Por favor verifica tu dirección de correo haciendo clic en el botón de abajo para activar tu cuenta.</p>
        ${BTN(link, 'VERIFICAR MI CUENTA')}
        <p style="color:#5a5a72;font-size:.8rem;">Si el botón no funciona, copia este enlace:<br><a href="${link}" style="color:#ff4500;word-break:break-all;">${link}</a></p>
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Este enlace expira en 48 horas.</p>
      </div>`,
    });
    console.log('[mailer] Verificación enviada a:', user.email);
  } catch (e) {
    console.error('[mailer] Error enviando verificación a', user.email, '—', e.message);
  }
}

async function sendWelcomeEmail(user) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  try {
    await transporter.sendMail({
      from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
      to: user.email,
      subject: '🎮 Bienvenido a Furious Industries RP',
      html: `<div style="${BASE_STYLE}">${HEADER}
        <h2 style="color:#fff;font-size:1.1rem;">¡Bienvenido, ${esc(user.full_name)}!</h2>
        <p style="color:#8888aa;line-height:1.6;">Tu cuenta ha sido creada exitosamente. Estos son tus datos de acceso:</p>
        <div style="background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <p style="margin:0 0 6px;color:#5a5a72;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;">TUS CREDENCIALES</p>
          <p style="margin:4px 0;color:#fff;"><span style="color:#5a5a72;">Correo: </span><strong>${esc(user.email)}</strong></p>
          <p style="margin:4px 0;color:#fff;"><span style="color:#5a5a72;">Contraseña: </span>La que ingresaste al registrarte</p>
        </div>
        <p style="color:#facc15;font-size:.85rem;">⚠️ Recuerda verificar tu correo para activar tu cuenta completamente.</p>
        ${BTN(`${siteUrl}/login`, 'INICIAR SESIÓN')}
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">No compartas tu contraseña con nadie.</p>
      </div>`,
    });
    console.log('[mailer] Bienvenida enviada a:', user.email);
  } catch (e) {
    console.error('[mailer] Error enviando bienvenida a', user.email, '—', e.message);
  }
}

async function sendPurchaseEmail(purchases, user) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  const total = purchases.reduce((s, p) => s + parseFloat(p.item_price || 0), 0);
  const rows = purchases.map(p =>
    `<tr><td style="padding:10px 14px;border-bottom:1px solid #1e1e30;color:#fff;">${esc(p.item_name)}</td>
     <td style="padding:10px 14px;border-bottom:1px solid #1e1e30;color:#00c4cc;text-align:right;font-weight:700;">$${parseFloat(p.item_price).toLocaleString('es-CL')}</td></tr>`
  ).join('');
  const buyOrder = purchases[0]?.buy_order || '—';
  const token    = purchases[0]?.webpay_token || '—';

  const body = `<div style="${BASE_STYLE}">${HEADER}
    <h2 style="color:#4ade80;font-size:1.1rem;">✅ Compra confirmada</h2>
    <p style="color:#8888aa;line-height:1.6;">Hola <strong style="color:#fff;">${esc(user.full_name)}</strong>, tu pago fue procesado exitosamente.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:rgba(0,196,204,.08);">
        <th style="padding:10px 14px;text-align:left;color:#5a5a72;font-size:.75rem;letter-spacing:.08em;">PRODUCTO</th>
        <th style="padding:10px 14px;text-align:right;color:#5a5a72;font-size:.75rem;letter-spacing:.08em;">PRECIO</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td style="padding:12px 14px;color:#5a5a72;font-size:.8rem;">TOTAL</td>
        <td style="padding:12px 14px;text-align:right;color:#00c4cc;font-weight:700;font-size:1rem;">$${total.toLocaleString('es-CL')}</td></tr></tfoot>
    </table>
    <div style="background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;padding:14px 18px;margin:16px 0;font-size:.8rem;">
      <p style="margin:0 0 4px;color:#5a5a72;">Orden de compra: <span style="color:#fff;font-family:monospace;">${esc(buyOrder)}</span></p>
      <p style="margin:0;color:#5a5a72;">Token WebPay: <span style="color:#fff;font-family:monospace;font-size:.72rem;word-break:break-all;">${esc(token)}</span></p>
    </div>
    ${BTN(`${siteUrl}/perfil`, 'VER MIS COMPRAS')}
    ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Los beneficios serán aplicados en el servidor. ¡Gracias por tu apoyo!</p>
  </div>`;

  try {
    await transporter.sendMail({
      from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
      to: user.email,
      subject: `✅ Compra confirmada — $${total.toLocaleString('es-CL')} — Furious Industries RP`,
      html: body,
    });
    console.log('[mailer] Compra enviada a:', user.email);
  } catch (e) {
    console.error('[mailer] Error enviando compra a', user.email, '—', e.message);
  }

  try {
    await transporter.sendMail({
      from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
      to: 'administracion@furiousind.com',
      subject: `🛒 Nueva compra — ${esc(user.full_name)} — $${total.toLocaleString('es-CL')}`,
      html: `<div style="${BASE_STYLE}">${HEADER}
        <h2 style="color:#facc15;font-size:1.1rem;">🛒 Nueva compra recibida</h2>
        <p style="color:#8888aa;">Usuario: <strong style="color:#fff;">${esc(user.full_name)}</strong> (${esc(user.email)})</p>
        ${body.replace(BTN(`${siteUrl}/perfil`, 'VER MIS COMPRAS'), BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN'))}
      </div>`,
    });
    console.log('[mailer] Notif compra enviada a admin');
  } catch (e) {
    console.error('[mailer] Error enviando notif compra a admin —', e.message);
  }
}

async function sendNewUserNotification(user) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  const now = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });
  const rows = [
    ['Nombre completo', esc(user.full_name)],
    ['Correo electrónico', esc(user.email)],
    ['Fecha de nacimiento', esc(user.birth_date) || '—'],
    ['Discord', esc(user.discord_username) || '—'],
    ['Discord ID', esc(user.discord_id) || '—'],
    ['Fecha de registro', now],
  ].map(([k, v]) =>
    `<tr><td style="padding:9px 14px;border-bottom:1px solid #1e1e30;color:#5a5a72;font-size:.8rem;white-space:nowrap;">${k}</td>
     <td style="padding:9px 14px;border-bottom:1px solid #1e1e30;color:#fff;font-weight:600;">${v}</td></tr>`
  ).join('');

  try {
    await transporter.sendMail({
      from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
      to: 'administracion@furiousind.com',
      subject: `👤 Nuevo registro — ${esc(user.full_name)} — Furious Industries RP`,
      html: `<div style="${BASE_STYLE}">${HEADER}
        <h2 style="color:#00c4cc;font-size:1.1rem;">👤 Nuevo usuario registrado</h2>
        <p style="color:#8888aa;line-height:1.6;">Se ha registrado un nuevo usuario en la plataforma web.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;overflow:hidden;">
          <tbody>${rows}</tbody>
        </table>
        ${BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN')}
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Notificación automática — Furious Industries RP</p>
      </div>`,
    });
    console.log('[mailer] Notif nuevo usuario enviada para:', user.email);
  } catch (e) {
    console.error('[mailer] Error enviando notif nuevo usuario —', e.message);
  }
}

async function sendTestEmail(to) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) throw new Error('SMTP no configurado — verifica smtp_host, smtp_user y smtp_pass en Configuración');
  await transporter.verify();
  await transporter.sendMail({
    from: `"Furious Industries RP" <${cfg.smtp_from || cfg.smtp_user}>`,
    to,
    subject: '✅ Correo de prueba — Furious Industries RP',
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2 style="color:#4ade80;font-size:1.1rem;">✅ Configuración SMTP correcta</h2>
      <p style="color:#8888aa;line-height:1.6;">Este es un correo de prueba. Si lo recibes, el sistema de correos está funcionando correctamente.</p>
      ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Furious Industries RP — Sistema automático</p>
    </div>`,
  });
  console.log('[mailer] Correo de prueba enviado a:', to);
}

module.exports = { sendVerificationEmail, sendWelcomeEmail, sendPurchaseEmail, sendNewUserNotification, sendTestEmail };
