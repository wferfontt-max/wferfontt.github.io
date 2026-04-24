/* Injects session-aware links into every page's navbar */
(async function () {
  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  let user = null;
  try {
    const r = await fetch('/api/me');
    if (r.ok) { const j = await r.json(); user = j.data; }
  } catch (_) {}

  document.querySelectorAll('a[href="/registro"]').forEach(regLink => {
    const parent = regLink.parentNode;

    if (user) {
      // Replace "Registro" with "👤 Nombre" → /perfil
      regLink.textContent = '👤 ' + esc(user.full_name.split(' ')[0]);
      regLink.href = '/perfil';
      regLink.title = user.email;

      // Insert "Salir" right after
      const out = document.createElement('a');
      out.href = '#';
      out.textContent = 'Salir';
      out.style.color = '#ff4500';
      out.addEventListener('click', async e => {
        e.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
      });
      parent.insertBefore(out, regLink.nextSibling);
    } else {
      // Insert "Iniciar Sesión" before "Registro"
      const login = document.createElement('a');
      login.href = '/login';
      login.textContent = 'Iniciar Sesión';
      parent.insertBefore(login, regLink);
    }
  });
})();
