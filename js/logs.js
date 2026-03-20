// logs.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadLogs() {
  document.getElementById('logs-loading').style.display = 'block';
  document.getElementById('logs-table').style.display   = 'none';
  try {
    const data = await api('audit_log?select=*&order=creat_la.desc&limit=500');
    allLogs = data;
    renderLogs(applyLogFilters(data));
    document.getElementById('logs-count').textContent = `(${data.length})`;
  } catch(e) {
    document.getElementById('logs-loading').innerHTML = `<span class="text-red">❌ ${e.message}</span>`;
  }
}

function applyLogFilters(logs) {
  const actiune  = document.getElementById('log-filter-actiune').value;
  const entitate = document.getElementById('log-filter-entitate').value;
  const user     = document.getElementById('log-filter-user').value.toLowerCase();
  return logs.filter(l =>
    (!actiune  || l.actiune  === actiune) &&
    (!entitate || l.entitate === entitate) &&
    (!user     || (l.user_email||'').toLowerCase().includes(user))
  );
}

function renderLogs(logs) {
  document.getElementById('logs-loading').style.display = 'none';
  document.getElementById('logs-table').style.display   = 'table';
  const tbody = document.getElementById('logs-body');
  tbody.innerHTML = '';

  if(!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Niciun log găsit.</td></tr>';
    return;
  }

  const actiuneIcon = { CREATE:'➕', UPDATE:'✏️', DELETE:'🗑', LOGIN:'🔑' };

  logs.forEach(l => {
    const det    = l.detalii || {};
    const detStr = JSON.stringify(det, null, 0).replace(/[{}"]/g,'').substring(0,120);
    const dt     = new Date(l.creat_la);
    const dtStr  = dt.toLocaleDateString('ro-RO') + ' ' + dt.toLocaleTimeString('ro-RO');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;font-size:12px">${dtStr}</td>
      <td style="font-size:12px">${escHtml(l.user_email||'sistem')}</td>
      <td><span class="role-${l.user_rol||'user'}">${(l.user_rol||'').toUpperCase()}</span></td>
      <td class="log-${l.actiune}"><strong>${actiuneIcon[l.actiune]||'•'} ${l.actiune}</strong></td>
      <td style="font-size:12px;color:var(--muted)">${l.entitate}</td>
      <td class="log-details" title="${escHtml(JSON.stringify(det))}">${escHtml(detStr)}</td>
    `;
    tbody.appendChild(tr);
  });
}

