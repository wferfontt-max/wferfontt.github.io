const nodemailer = require('nodemailer');
const db = require('../db');

async function getSmtpConfig() {
  const rows = await db.all(
    "SELECT key, value FROM server_settings WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','site_url')"
  );
  return rows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});
}

function createTransporter(cfg) {
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return null;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port) || 587,
    secure: parseInt(cfg.smtp_port) === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls: { rejectUnauthorized: false },
  });
}

const BASE_STYLE = `font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0b0b16;color:#fff;border-radius:12px;padding:32px;border:1px solid #1e1e30;`;
const HEADER = `<div style="text-align:center;margin-bottom:24px;"><span style="font-size:2rem;">⚡</span><h1 style="font-size:1.1rem;color:#ff4500;margin:8px 0 0;font-family:Arial,sans-serif;">FURIOUS INDUSTRIES RP</h1></div>`;
const HR = `<hr style="border:none;border-top:1px solid #1e1e30;margin:24px 0;">`;
const BTN = (link, label) => `<div style="text-align:center;margin:28px 0;"><a href="${link}" style="display:inline-block;padding:14px 32px;background:#ff4500;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:.95rem;">${label}</a></div>`;

async function sendVerificationEmail(user, token) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${siteUrl}/verificar?token=${token}`;
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
}

async function sendWelcomeEmail(user) {
  const cfg = await getSmtpConfig();
  const transporter = createTransporter(cfg);
  if (!transporter) return;
  const siteUrl = (cfg.site_url || 'http://localhost:3000').replace(/\/$/, '');
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
}

function esc(s) {
  return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

module.exports = { sendVerificationEmail, sendWelcomeEmail };
