// delivery.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadPredare() {
  document.getElementById('predare-loading').style.display = 'block';
  document.getElementById('predare-groups').innerHTML = '';
  document.getElementById('predare-empty').style.display = 'none';

  try {
    // Toate produsele cu status ajuns
    const prods = await api(
      'produse_comandate?status_produs=eq.ajuns&select=*,comenzi(id,nr_comanda,cod_comanda_unic,total_plata,avans_achitat,rest_de_plata,tip_plata,clienti(id,nume,telefon))'
    );

    document.getElementById('predare-loading').style.display = 'none';

    if(!prods.length) {
      document.getElementById('predare-empty').style.display = 'block';
      document.getElementById('predare-count').textContent = '';
      updateBadgePredare(0);
      return;
    }

    document.getElementById('predare-count').textContent = `(${prods.length} produse)`;
    updateBadgePredare(prods.length);

    // Grupează după client
    const byClient = {};
    prods.forEach(p => {
      const c = p.comenzi?.clienti;
      if(!c) return;
      const key = c.id;
      if(!byClient[key]) byClient[key] = { client: c, comenzi: {} };
      const cmdId = p.comenzi?.id;
      if(!byClient[key].comenzi[cmdId]) {
        byClient[key].comenzi[cmdId] = {
          comanda: p.comenzi,
          produse: []
        };
      }
      byClient[key].comenzi[cmdId].produse.push(p);
    });

    const groups = document.getElementById('predare-groups');
    groups.innerHTML = '';

    Object.values(byClient).forEach(({ client, comenzi }) => {
      try {
      const totalProduse = Object.values(comenzi).reduce((s,c)=>s+c.produse.length,0);
      const div = document.createElement('div');
      div.style.cssText = 'background:var(--s1);border:1px solid var(--border);border-radius:var(--r-xl);margin-bottom:16px;overflow:hidden';

      // Header client
      const restTotal = Object.values(comenzi).reduce((s,c) => {
        const o = c.comanda;
        return s + (o.tip_plata==='achitat_integral' ? 0 : Math.max(0,(+o.total_plata||0)-(+o.avans_achitat||0)));
      }, 0);

      div.style.cssText = 'border:1px solid var(--border);border-radius:var(--r-xl);margin-bottom:16px;overflow:hidden;box-shadow:var(--shadow-sm)';
      div.innerHTML = `
        <div style="padding:14px 20px;background:var(--s2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:38px;height:38px;background:var(--accent-bg);border:1px solid rgba(13,148,136,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--text)">${escHtml(client.nume)}</div>
              <div style="font-size:12px;color:var(--muted)">${escHtml(client.telefon||'—')} · ${totalProduse} produs(e) de predat</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            ${restTotal > 0 ? `<span style="color:var(--red);font-weight:700;font-size:13px">⚠️ Rest: ${fmtRON(restTotal)} RON</span>` : '<span style="color:var(--green);font-weight:700;font-size:13px">✅ Achitat</span>'}
            <button class="btn btn-primary btn-sm" onclick="predareTotiClientul('${client.id}',this)">
              🚗 Predă tot
            </button>
            <button class="btn btn-secondary btn-sm" onclick="copyPredareWhatsApp('${client.id}')">
              📋 WhatsApp
            </button>
          </div>
        </div>
        <div style="padding:12px 20px;background:var(--bg)">
          ${Object.values(comenzi).map(({ comanda: cmd, produse }) => `
            <div style="margin-bottom:10px">
              <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-family:monospace">
                ${fmtNr(cmd.nr_comanda)} · ${escHtml(cmd.cod_comanda_unic||'')}
              </div>
              <div style="display:flex;flex-direction:column;gap:4px">
                ${produse.map(p => `
                  <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--s1);border:1px solid var(--border);border-radius:var(--r-md);transition:background var(--t-fast)" class="predare-row" data-prod-id="${p.id}">
                    <input type="checkbox" class="predare-check" data-prod-id="${p.id}" style="width:16px;height:16px;cursor:pointer"/>
                    <div style="flex:1;min-width:0">
                      <span style="color:var(--accent);font-family:monospace;font-weight:700;font-size:13px">${escHtml(p.cod_aftermarket)}</span>
                      ${p.sku ? `<span class="chip" style="margin-left:6px;font-size:10px">${escHtml(p.sku)}</span>` : ''}
                      <span style="font-size:12px;color:var(--muted);margin-left:8px">${escHtml(p.descriere||'')}</span>
                    </div>
                    <div style="text-align:right;white-space:nowrap">
                      <div style="font-weight:700;color:var(--text)">${fmtRON(p.pret_vanzare||p.pret_achizitie)} RON</div>
                      <div style="font-size:10px;color:var(--muted)">cant. ${p.cantitate||1}</div>
                    </div>
                    <button class="btn btn-danger btn-xs" onclick="openRetur('${p.id}','${escHtml(p.cod_aftermarket)}','${escHtml(p.descriere||'')}')">
                      ↩️
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      groups.appendChild(div);
      } catch(renderErr) {
        console.error('Render client error:', renderErr);
      }
    });

    // Filter search
    document.getElementById('f-predare-client').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      groups.querySelectorAll('[data-client-group]').forEach(g => {
        g.style.display = g.dataset.clientName?.toLowerCase().includes(q) ? '' : 'none';
      });
    });

  } catch(e) {
    document.getElementById('predare-loading').innerHTML = `<span class="text-red">❌ ${e.message}</span>`;
  }
}

function updateBadgePredare(count) {
  const badge = document.getElementById('badge-predare');
  if(!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

async function predareTotiClientul(clientId, btn) {
  // Găsește toate checkbox-urile bifate din grupul clientului
  const groups = document.getElementById('predare-groups');
  const checks = [...groups.querySelectorAll('.predare-check:checked')];

  if(!checks.length) { toast('Niciun produs selectat!','warn'); return; }

  btn.disabled = true; btn.textContent = '⏳...';
  try {
    await Promise.all(checks.map(cb =>
      api(`produse_comandate?id=eq.${cb.dataset.prodId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status_produs: 'predat', data_predare: new Date().toISOString() })
      })
    ));
    toast(`✅ ${checks.length} produs(e) marcate ca predate!`,'success');
    await loadPredare();
    await loadOrders();
  } catch(e) { toast('Eroare: '+e.message,'error'); }
  btn.disabled = false; btn.textContent = '🚗 Predă tot';
}

async function copyPredareWhatsApp(clientId) {
  const groups = document.getElementById('predare-groups');
  const checks = [...groups.querySelectorAll('.predare-check:checked')];
  if(!checks.length) { toast('Niciun produs selectat!','warn'); return; }

  const client = allClients.find(c=>c.id===clientId);
  const lines = [];
  lines.push(`*${escHtml(client?.nume||'Client')}* — ridicare piese`);
  lines.push('');

  checks.forEach((cb, i) => {
    const row = cb.closest('.predare-row');
    const cod  = row.querySelector('[style*="monospace"]')?.textContent?.trim() || '—';
    const desc = row.querySelectorAll('span')[2]?.textContent?.trim() || '';
    const pret = row.querySelector('[style*="font-weight:700"]')?.textContent?.trim() || '';
    lines.push(`${i+1}. ${cod} — ${desc} — *${pret}*`);
  });

  lines.push('');
  lines.push(`_Data predare: ${new Date().toLocaleDateString('ro-RO')}_`);

  await navigator.clipboard.writeText(lines.join(String.fromCharCode(10)));
  toast('✅ Copiat pentru WhatsApp!','success');
}

async function loadRetururi() {
  document.getElementById('retururi-loading').style.display = 'block';
  document.getElementById('retururi-table').style.display   = 'none';
  try {
    const prods = await api(
      'produse_comandate?status_produs=eq.returnat&select=*,comenzi(nr_comanda,cod_comanda_unic,clienti(nume))&order=data_comanda.desc'
    );
    document.getElementById('retururi-loading').style.display = 'none';
    document.getElementById('retururi-table').style.display   = 'table';
    document.getElementById('retururi-count').textContent     = `(${prods.length})`;
    updateBadgeRetururi(prods.length);

    const motivLabel = { nu_se_potriveste: '🔧 Nu se potrivește', client_renunta: '❌ Client renunță' };
    const tbody = document.getElementById('retururi-body');
    tbody.innerHTML = '';

    if(!prods.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Niciun retur înregistrat.</td></tr>';
      return;
    }

    prods.forEach(p => {
      const cmd = p.comenzi||{};
      const tr  = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="nr-cmd">${fmtNr(cmd.nr_comanda)}</span>
          <div style="font-size:10px;color:var(--muted);font-family:monospace">${escHtml(cmd.cod_comanda_unic||'')}</div>
        </td>
        <td class="fw-bold" style="color:var(--accent);font-family:monospace">${escHtml(p.cod_aftermarket)}</td>
        <td style="font-size:12px">${escHtml(p.descriere||'—')}</td>
        <td style="font-size:11px;color:var(--blue);font-family:monospace">${escHtml(p.sku||'—')}</td>
        <td style="font-size:12px">${escHtml(cmd.clienti?.nume||'—')}</td>
        <td><span class="badge b-returnat">${motivLabel[p.motiv_retur]||p.motiv_retur||'—'}</span></td>
        <td style="font-size:12px;color:var(--muted)">${p.data_predare?fmtDate(p.data_predare):'—'}</td>
        <td class="text-red fw-bold">${fmtRON(p.pret_vanzare||p.pret_achizitie)} RON</td>
      `;
      tbody.appendChild(tr);
    });

    applyRetururiFilters();
  } catch(e) {
    document.getElementById('retururi-loading').innerHTML = `<span class="text-red">❌ ${e.message}</span>`;
  }
}

function applyRetururiFilters() {
  const motiv = document.getElementById('f-retur-motiv')?.value || '';
  const q     = document.getElementById('f-retur-search')?.value?.toLowerCase() || '';
  document.querySelectorAll('#retururi-body tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    const show = (!motiv || text.includes(motivLabel?.[motiv]?.toLowerCase()||motiv))
              && (!q || text.includes(q));
    tr.style.display = show ? '' : 'none';
  });
}

function updateBadgeRetururi(count) {
  if(count === undefined) {
    api('produse_comandate?status_produs=eq.returnat&select=id').then(r => updateBadgeRetururi(r.length)).catch(()=>{});
    return;
  }
  const badge = document.getElementById('badge-retururi');
  if(!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

