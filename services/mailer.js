const nodemailer = require('nodemailer');
const dns = require('dns');
const db = require('../db');

async function getMailConfig() {
  const rows = await db.all(
    "SELECT key, value FROM server_settings WHERE key IN ('resend_api_key','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','site_url')"
  );
  return rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
}

// ── Resend (HTTPS, no SMTP port needed) ───────────────────────
async function sendViaResend(apiKey, { from, to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || data.name || JSON.stringify(data));
  return data;
}

// ── Nodemailer fallback (for local dev) ───────────────────────
function lookupIPv4(hostname, options, callback) {
  dns.lookup(hostname, { ...options, family: 4 }, callback);
}
function createTransporter(cfg) {
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return null;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port) || 587,
    secure: parseInt(cfg.smtp_port) === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls: { rejectUnauthorized: false },
    lookup: lookupIPv4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// ── Unified send ──────────────────────────────────────────────
async function sendMail({ cfg, from, to, subject, html }) {
  if (cfg.resend_api_key) {
    await sendViaResend(cfg.resend_api_key, { from, to, subject, html });
  } else {
    const transporter = createTransporter(cfg);
    if (!transporter) throw new Error('Sin configuración de email — agrega Resend API Key en Configuración');
    await transporter.sendMail({ from, to, subject, html });
  }
}

const BASE_STYLE = `font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0b0b16;color:#fff;border-radius:12px;padding:32px;border:1px solid #1e1e30;`;
const HEADER = (siteUrl) => `<div style="text-align:center;margin-bottom:28px;"><img src="${siteUrl}/img/logo.gif" alt="Furious Industries RP" style="max-width:180px;height:auto;display:inline-block;" /></div>`;
const HR = `<hr style="border:none;border-top:1px solid #1e1e30;margin:24px 0;">`;
const BTN = (link, label) => `<div style="text-align:center;margin:28px 0;"><a href="${link}" style="display:inline-block;padding:14px 32px;background:#ff4500;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:.95rem;">${label}</a></div>`;

function esc(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

function fromAddr(cfg) {
  const addr = cfg.smtp_from || cfg.smtp_user || 'noreply@furiousind.com';
  return `"Furious Industries RP" <${addr}>`;
}

async function sendVerificationEmail(user, token) {
  try {
    const cfg = await getMailConfig();
    const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
    const link = `${siteUrl}/verificar?token=${token}`;
    await sendMail({
      cfg, from: fromAddr(cfg), to: user.email,
      subject: '✅ Verifica tu cuenta — Furious Industries RP',
      html: `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
        <h2 style="color:#fff;font-size:1.1rem;">Hola, ${esc(user.full_name)}!</h2>
        <p style="color:#8888aa;line-height:1.6;">Por favor verifica tu dirección de correo haciendo clic en el botón de abajo para activar tu cuenta.</p>
        ${BTN(link, 'VERIFICAR MI CUENTA')}
        <p style="color:#5a5a72;font-size:.8rem;">Si el botón no funciona, copia este enlace:<br><a href="${link}" style="color:#ff4500;word-break:break-all;">${link}</a></p>
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Este enlace expira en 48 horas.</p>
      </div>`,
    });
    console.log('[mailer] Verificación enviada a:', user.email);
  } catch (e) { console.error('[mailer] Error verificación:', e.message); }
}

async function sendWelcomeEmail(user) {
  try {
    const cfg = await getMailConfig();
    const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
    await sendMail({
      cfg, from: fromAddr(cfg), to: user.email,
      subject: '🎮 Bienvenido a Furious Industries RP',
      html: `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
        <h2 style="color:#fff;font-size:1.1rem;">¡Bienvenido, ${esc(user.full_name)}!</h2>
        <p style="color:#8888aa;line-height:1.6;">Tu cuenta ha sido creada exitosamente.</p>
        <div style="background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <p style="margin:4px 0;color:#fff;"><span style="color:#5a5a72;">Correo: </span><strong>${esc(user.email)}</strong></p>
          <p style="margin:4px 0;color:#fff;"><span style="color:#5a5a72;">Contraseña: </span>La que ingresaste al registrarte</p>
        </div>
        <p style="color:#facc15;font-size:.85rem;">⚠️ Recuerda verificar tu correo para activar tu cuenta.</p>
        ${BTN(`${siteUrl}/login`, 'INICIAR SESIÓN')}
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">No compartas tu contraseña con nadie.</p>
      </div>`,
    });
    console.log('[mailer] Bienvenida enviada a:', user.email);
  } catch (e) { console.error('[mailer] Error bienvenida:', e.message); }
}

async function sendPurchaseEmail(purchases, user) {
  try {
    const cfg = await getMailConfig();
    const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
    const total = purchases.reduce((s, p) => s + parseFloat(p.item_price || 0), 0);
    const rows = purchases.map(p =>
      `<tr><td style="padding:10px 14px;border-bottom:1px solid #1e1e30;color:#fff;">${esc(p.item_name)}</td>
       <td style="padding:10px 14px;border-bottom:1px solid #1e1e30;color:#00c4cc;text-align:right;font-weight:700;">$${parseFloat(p.item_price).toLocaleString('es-CL')}</td></tr>`
    ).join('');
    const buyOrder = purchases[0]?.buy_order || '—';
    const token    = purchases[0]?.webpay_token || '—';
    const body = `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
      <h2 style="color:#4ade80;font-size:1.1rem;">✅ Compra confirmada</h2>
      <p style="color:#8888aa;line-height:1.6;">Hola <strong style="color:#fff;">${esc(user.full_name)}</strong>, tu pago fue procesado exitosamente.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:rgba(0,196,204,.08);">
          <th style="padding:10px 14px;text-align:left;color:#5a5a72;font-size:.75rem;">PRODUCTO</th>
          <th style="padding:10px 14px;text-align:right;color:#5a5a72;font-size:.75rem;">PRECIO</th>
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
      ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">¡Gracias por tu apoyo!</p>
    </div>`;
    await sendMail({ cfg, from: fromAddr(cfg), to: user.email,
      subject: `✅ Compra confirmada — $${total.toLocaleString('es-CL')} — Furious Industries RP`, html: body });
    console.log('[mailer] Compra enviada a:', user.email);
    await sendMail({ cfg, from: fromAddr(cfg), to: 'administracion@furiousind.com',
      subject: `🛒 Nueva compra — ${esc(user.full_name)} — $${total.toLocaleString('es-CL')}`,
      html: body.replace(BTN(`${siteUrl}/perfil`, 'VER MIS COMPRAS'), BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN')) });
    console.log('[mailer] Notif compra enviada a admin');
  } catch (e) { console.error('[mailer] Error compra:', e.message); }
}

async function sendPurchaseFailedEmail(purchases, user) {
  try {
    const cfg = await getMailConfig();
    const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
    const total = purchases.reduce((s, p) => s + parseFloat(p.item_price || 0), 0);
    const itemList = purchases.map(p => `<li style="color:#fff;padding:4px 0;">${esc(p.item_name)} — <span style="color:#f87171;">$${parseFloat(p.item_price).toLocaleString('es-CL')}</span></li>`).join('');
    const buyOrder = purchases[0]?.buy_order || '—';
    const body = `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
      <h2 style="color:#f87171;font-size:1.1rem;">❌ Pago rechazado</h2>
      <p style="color:#8888aa;line-height:1.6;">Hola <strong style="color:#fff;">${esc(user.full_name)}</strong>, lamentablemente tu pago no pudo ser procesado.</p>
      <div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 10px;color:#5a5a72;font-size:.8rem;">PRODUCTOS</p>
        <ul style="margin:0;padding-left:18px;">${itemList}</ul>
        <p style="margin:12px 0 0;color:#5a5a72;font-size:.8rem;">Orden: <span style="color:#fff;font-family:monospace;">${esc(buyOrder)}</span></p>
      </div>
      <p style="color:#8888aa;line-height:1.6;font-size:.9rem;">Puedes intentar nuevamente desde la tienda. Si el problema persiste, verifica los datos de tu tarjeta o contacta a tu banco.</p>
      ${BTN(`${siteUrl}/tienda`, 'IR A LA TIENDA')}
      ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">No se realizó ningún cargo.</p>
    </div>`;
    await sendMail({ cfg, from: fromAddr(cfg), to: user.email,
      subject: `❌ Pago rechazado — $${total.toLocaleString('es-CL')} — Furious Industries RP`, html: body });
    console.log('[mailer] Pago rechazado enviado a:', user.email);
    await sendMail({ cfg, from: fromAddr(cfg), to: 'administracion@furiousind.com',
      subject: `❌ Pago rechazado — ${esc(user.full_name)} — $${total.toLocaleString('es-CL')}`,
      html: body.replace(BTN(`${siteUrl}/tienda`, 'IR A LA TIENDA'), BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN')) });
    console.log('[mailer] Notif rechazo enviada a admin');
  } catch (e) { console.error('[mailer] Error pago rechazado:', e.message); }
}

async function sendPurchaseCancelledEmail(purchases, user) {
  try {
    const cfg = await getMailConfig();
    const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
    const total = purchases.reduce((s, p) => s + parseFloat(p.item_price || 0), 0);
    const itemList = purchases.map(p => `<li style="color:#fff;padding:4px 0;">${esc(p.item_name)} — <span style="color:#facc15;">$${parseFloat(p.item_price).toLocaleString('es-CL')}</span></li>`).join('');
    const buyOrder = purchases[0]?.buy_order || '—';
    const body = `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
      <h2 style="color:#facc15;font-size:1.1rem;">⚠️ Compra cancelada</h2>
      <p style="color:#8888aa;line-height:1.6;">Hola <strong style="color:#fff;">${esc(user.full_name)}</strong>, tu compra fue cancelada.</p>
      <div style="background:rgba(250,204,21,.07);border:1px solid rgba(250,204,21,.25);border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 10px;color:#5a5a72;font-size:.8rem;">PRODUCTOS</p>
        <ul style="margin:0;padding-left:18px;">${itemList}</ul>
        <p style="margin:12px 0 0;color:#5a5a72;font-size:.8rem;">Orden: <span style="color:#fff;font-family:monospace;">${esc(buyOrder)}</span></p>
      </div>
      <p style="color:#8888aa;line-height:1.6;font-size:.9rem;">Si fue un error, puedes volver a intentarlo desde la tienda.</p>
      ${BTN(`${siteUrl}/tienda`, 'IR A LA TIENDA')}
      ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">No se realizó ningún cargo.</p>
    </div>`;
    await sendMail({ cfg, from: fromAddr(cfg), to: user.email,
      subject: `⚠️ Compra cancelada — Furious Industries RP`, html: body });
    console.log('[mailer] Cancelación enviada a:', user.email);
    await sendMail({ cfg, from: fromAddr(cfg), to: 'administracion@furiousind.com',
      subject: `⚠️ Compra cancelada — ${esc(user.full_name)} — $${total.toLocaleString('es-CL')}`,
      html: body.replace(BTN(`${siteUrl}/tienda`, 'IR A LA TIENDA'), BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN')) });
    console.log('[mailer] Notif cancelación enviada a admin');
  } catch (e) { console.error('[mailer] Error cancelación:', e.message); }
}

async function sendNewUserNotification(user) {
  try {
    const cfg = await getMailConfig();
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
    await sendMail({
      cfg, from: fromAddr(cfg), to: 'administracion@furiousind.com',
      subject: `👤 Nuevo registro — ${esc(user.full_name)} — Furious Industries RP`,
      html: `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
        <h2 style="color:#00c4cc;font-size:1.1rem;">👤 Nuevo usuario registrado</h2>
        <p style="color:#8888aa;line-height:1.6;">Se ha registrado un nuevo usuario en la plataforma web.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;background:rgba(5,5,10,.7);border:1px solid #1e1e30;border-radius:8px;overflow:hidden;">
          <tbody>${rows}</tbody>
        </table>
        ${BTN(`${siteUrl}/admin`, 'VER EN PANEL ADMIN')}
        ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Notificación automática</p>
      </div>`,
    });
    console.log('[mailer] Notif nuevo usuario enviada para:', user.email);
  } catch (e) { console.error('[mailer] Error notif registro:', e.message); }
}

async function sendTestEmail(to) {
  const cfg = await getMailConfig();
  if (!cfg.resend_api_key && (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass)) {
    throw new Error('Sin configuración de email — agrega tu Resend API Key en Configuración y guarda');
  }
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  await sendMail({
    cfg, from: fromAddr(cfg), to,
    subject: '✅ Correo de prueba — Furious Industries RP',
    html: `<div style="${BASE_STYLE}">${HEADER(siteUrl)}
      <h2 style="color:#4ade80;font-size:1.1rem;">✅ Configuración correcta</h2>
      <p style="color:#8888aa;line-height:1.6;">El sistema de correos está funcionando correctamente.</p>
      ${HR}<p style="color:#5a5a72;font-size:.75rem;text-align:center;">Furious Industries RP — Sistema automático</p>
    </div>`,
  });
}

module.exports = { sendVerificationEmail, sendWelcomeEmail, sendPurchaseEmail, sendPurchaseFailedEmail, sendPurchaseCancelledEmail, sendNewUserNotification, sendTestEmail };
