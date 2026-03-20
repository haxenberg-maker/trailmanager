// invoices.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadFacturi() {
  document.getElementById('facturi-loading').style.display = 'block';
  document.getElementById('facturi-table').style.display   = 'none';
  try {
    const prods = await api(
      'produse_comandate?select=cod_factura_furnizor,pret_achizitie,cantitate,data_sosire,comanda_id,comenzi(furnizor,nr_comanda,cod_comanda_unic)' +
      '&cod_factura_furnizor=not.is.null&order=data_sosire.desc&limit=500'
    );
    renderFacturi(prods);
  } catch(e) {
    document.getElementById('facturi-loading').innerHTML = `<span class="text-red">❌ ${e.message}</span>`;
  }
}

function renderFacturi(prods) {
  document.getElementById('facturi-loading').style.display = 'none';
  document.getElementById('facturi-table').style.display   = 'table';

  // Grupează după cod_factura_furnizor
  const grouped = {};
  prods.forEach(p => {
    const nr = p.cod_factura_furnizor;
    if(!grouped[nr]) grouped[nr] = {
      nr, furnizor: p.comenzi?.furnizor||'—', produse: [], total: 0,
      dataPrimire: p.data_sosire, comenzi: new Set()
    };
    grouped[nr].produse.push(p);
    grouped[nr].total += (+p.pret_achizitie||0) * (+p.cantitate||1);
    if(p.comanda_id) grouped[nr].comenzi.add(p.comenzi?.cod_comanda_unic || p.comanda_id);
    // Cea mai recentă dată
    if(p.data_sosire && p.data_sosire > (grouped[nr].dataPrimire||'')) {
      grouped[nr].dataPrimire = p.data_sosire;
    }
  });

  const facturi = Object.values(grouped).sort((a,b) =>
    (b.dataPrimire||'') > (a.dataPrimire||'') ? 1 : -1
  );

  document.getElementById('facturi-count').textContent = `(${facturi.length})`;

  // Populează filter furnizori
  const sel = document.getElementById('f-factura-furnizor');
  const existingFurnizori = [...sel.options].map(o=>o.value);
  [...new Set(facturi.map(f=>f.furnizor).filter(Boolean))].forEach(f => {
    if(!existingFurnizori.includes(f)) {
      const o = document.createElement('option'); o.value=o.textContent=f; sel.appendChild(o);
    }
  });

  const tbody = document.getElementById('facturi-body');
  tbody.innerHTML = '';

  if(!facturi.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nicio factură procesată încă.</td></tr>';
    return;
  }

  facturi.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="fw-bold font-mono" style="color:var(--blue);cursor:pointer;text-decoration:underline;text-decoration-style:dotted"
          onclick="event.stopPropagation();openFacturaDetail('${escHtml(f.nr)}')">
          ${escHtml(f.nr)}
        </span>
      </td>
      <td style="font-size:12px;color:var(--muted)">${escHtml(f.furnizor)}</td>
      <td style="text-align:center;font-weight:600">${f.produse.length}</td>
      <td class="fw-bold text-green">${fmtRON(f.total)} RON</td>
      <td style="min-width:120px">
        ${renderPctBar(calcFacturaAchitatPct(f))}
      </td>
      <td style="font-size:12px;color:var(--muted)">${f.dataPrimire ? fmtDate(f.dataPrimire) : '—'}</td>
      <td style="font-size:12px">
        ${[...f.comenzi].map(c=>`<span class="nr-cmd" style="font-size:10px;margin-right:4px">${escHtml(c)}</span>`).join('')}
      </td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        ${getFacturaPdfUrl(f.nr)
          ? `<button class="btn btn-primary btn-xs" onclick="previewFacturaPdf('${escHtml(f.nr)}')">👁 Preview</button>
             <button class="btn btn-secondary btn-xs" onclick="startUploadFactura('${escHtml(f.nr)}')">🔄</button>
             <button class="icon-btn" style="color:var(--red);font-size:12px" onclick="removeFacturaPdf('${escHtml(f.nr)}')">✕</button>`
          : `<button class="btn btn-secondary btn-xs" onclick="startUploadFactura('${escHtml(f.nr)}')">📤 Upload PDF</button>`
        }
      </td>
    `;
    // Filter search
    tr.dataset.nr       = f.nr.toLowerCase();
    tr.dataset.furnizor = f.furnizor.toLowerCase();
    tbody.appendChild(tr);
  });

  // Apply filters
  applyFacturiFilters();
}

function applyFacturiFilters() {
  const q = document.getElementById('f-factura-nr')?.value?.toLowerCase()||'';
  const f = document.getElementById('f-factura-furnizor')?.value?.toLowerCase()||'';
  document.querySelectorAll('#facturi-body tr[data-nr]').forEach(tr => {
    const show = (!q || tr.dataset.nr.includes(q)) && (!f || tr.dataset.furnizor === f);
    tr.style.display = show ? '' : 'none';
  });
}

async function openInvoiceWizard() {
  // Populează dropdown furnizori din comenzi existente
  const sel = document.getElementById('inv-furnizor');
  sel.innerHTML = '<option value="">— toți furnizorii —</option>';
  const furnizori = [...new Set(allOrders.map(o=>o.furnizor).filter(Boolean))].sort();
  furnizori.forEach(f => {
    const o = document.createElement('option');
    o.value = o.textContent = f;
    sel.appendChild(o);
  });

  // Reset state
  document.getElementById('inv-nr').value = '';
  document.getElementById('invoice-step1').style.display = 'block';
  document.getElementById('invoice-step2').style.display = 'none';
  document.getElementById('invoice-foot').style.display  = 'flex';
  document.getElementById('invoice-foot2').style.display = 'none';
  document.getElementById('inv-next-btn').disabled = true;
  document.getElementById('inv-existing-warning').style.display = 'none';
  document.getElementById('invoice-subtitle').textContent = 'Pas 1 din 2 — Identificare factură';

  sel.addEventListener('change', debounceInvoiceSearch);
  openModal('modal-invoice');
}

function debounceInvoiceSearch() {
  clearTimeout(_invSearchTimer);
  const nr = document.getElementById('inv-nr').value.trim();
  document.getElementById('inv-next-btn').disabled = nr.length < 2;
  if(nr.length < 2) return;
  _invSearchTimer = setTimeout(checkExistingInvoice, 400);
}

function debounceInvoiceCodUnic() {
  clearTimeout(_invCodUnicTimer);
  _invCodUnicTimer = setTimeout(showCodUnicSuggestions, 300);
}

async function showCodUnicSuggestions() {
  const q  = document.getElementById('inv-cod-unic')?.value?.trim().toLowerCase();
  const ul = document.getElementById('inv-cod-unic-suggestions');
  if(!ul) return;

  const matches = allOrders
    .filter(o => o.cod_comanda_unic && (!q || o.cod_comanda_unic.toLowerCase().includes(q)))
    .slice(0, 10);

  if(!matches.length) { ul.style.display='none'; document.getElementById('inv-quick-products').style.display='none'; return; }

  ul.innerHTML = '';
  ul.style.display = 'block';
  matches.forEach(o => {
    const li = document.createElement('li');
    li.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between';
    li.innerHTML = `
      <div>
        <span style="color:var(--yellow);font-family:monospace;font-weight:700">${escHtml(o.cod_comanda_unic)}</span>
        <span style="color:var(--muted);font-size:11px;margin-left:8px">${escHtml(o.client_nume)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted)">${escHtml(o.furnizor||'')} · ${o.nr_produse} prod.</div>`;
    li.addEventListener('mouseenter', () => li.style.background='rgba(59,130,246,.1)');
    li.addEventListener('mouseleave', () => li.style.background='');
    li.addEventListener('click', () => {
      document.getElementById('inv-cod-unic').value = o.cod_comanda_unic;
      ul.style.display = 'none';
      if(o.furnizor) {
        const sel = document.getElementById('inv-furnizor');
        [...sel.options].forEach(opt => { if(opt.value===o.furnizor) opt.selected=true; });
      }
      // Încarcă produsele acestei comenzi
      loadInvQuickProducts(o.id, o.cod_comanda_unic);
    });
    ul.appendChild(li);
  });
}

async function loadInvQuickProducts(orderId, codUnic) {
  const panel = document.getElementById('inv-quick-products');
  const tbody = document.getElementById('inv-quick-body');
  const codEl = document.getElementById('inv-quick-cod');

  panel.style.display = 'block';
  codEl.textContent   = codUnic;
  tbody.innerHTML     = '<tr><td colspan="6" class="empty-state"><span class="spinner"></span></td></tr>';

  try {
    const prods = await api(`produse_comandate?comanda_id=eq.${orderId}&select=*&order=data_comanda.asc`);
    tbody.innerHTML = '';

    if(!prods.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nu există produse.</td></tr>';
      return;
    }

    const nrFactura = document.getElementById('inv-nr').value.trim();

    // Adaugă și produsele care au deja acest număr de factură (din alte comenzi)
    let allFacturaProds = [...prods];
    if(nrFactura) {
      try {
        const existente = await api(
          `produse_comandate?cod_factura_furnizor=eq.${encodeURIComponent(nrFactura)}&comanda_id=neq.${orderId}&select=*`
        );
        existente.forEach(p => { p._din_alta_comanda = true; });
        allFacturaProds = [...allFacturaProds, ...existente];
      } catch(e) { /* silent */ }
    }

    prods.forEach(p => {
      const eInFactura = p.cod_factura_furnizor === nrFactura && nrFactura;
      const tr = document.createElement('tr');
      tr.dataset.prodId = p.id;
      tr.innerHTML = `
        <td class="text-yellow fw-bold font-mono" style="font-size:12px;white-space:nowrap">${escHtml(p.cod_aftermarket)}</td>
        <td style="font-size:12px;max-width:150px">${escHtml(p.descriere||'—')}</td>
        <td><span class="badge b-${p.status_produs}">${p.status_produs}</span></td>
        <td>
          <input class="sf-input inv-sku-input" value="${escHtml(p.sku||'')}"
            placeholder="Introdu SKU" style="width:100px"
            data-prod-id="${p.id}"/>
        </td>
        <td style="text-align:center">
          ${eInFactura
            ? '<span style="color:var(--green);font-size:13px" title="Deja în factură">✅</span>'
            : '<span style="color:var(--muted);font-size:12px">—</span>'}
        </td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="preiaUnulInFactura('${p.id}', this)">
            Preia
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Autosave SKU la blur
    tbody.querySelectorAll('.inv-sku-input').forEach(input => {
      input.addEventListener('blur', async () => {
        const pid = input.dataset.prodId;
        const val = input.value.trim();
        if(!val) return;
        try {
          await api(`produse_comandate?id=eq.${pid}`, { method:'PATCH', body:JSON.stringify({ sku: val }) });
          showAutosaveStatus('SKU salvat ✓');
          input.style.borderColor = 'var(--green)';
          setTimeout(() => input.style.borderColor = '', 1500);
        } catch(e) { toast('Eroare SKU: '+e.message,'error'); }
      });
    });

  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-red" style="padding:10px">Eroare: ${e.message}</td></tr>`;
  }
}

async function _fixedGet(path) {
  return api(path.replace('produse_comenzi', 'produse_comandate'));
}

async function preiaUnulInFactura(prodId, btn) {
  const nrFactura = document.getElementById('inv-nr').value.trim();
  if(!nrFactura) { toast('Introdu mai întâi numărul facturii!','warn'); return; }

  // Salvează și SKU-ul dacă e completat
  const row    = btn.closest('tr');
  const skuVal = row.querySelector('.inv-sku-input')?.value?.trim();
  const patch  = {
    cod_factura_furnizor: nrFactura,
    status_produs: 'ajuns',
    data_sosire: new Date().toISOString()
  };
  if(skuVal) patch.sku = skuVal;
  // status_produs=ajuns se setează indiferent dacă are sau nu SKU

  try {
    await api(`produse_comandate?id=eq.${prodId}`, { method:'PATCH', body:JSON.stringify(patch) });
    // Update visual
    const inFactCol = row.querySelectorAll('td')[4];
    if(inFactCol) inFactCol.innerHTML = '<span style="color:var(--green);font-size:13px">✅</span>';
    btn.textContent = '✓';
    btn.disabled = true;
    btn.style.background = 'var(--green)';
    toast('Produs preluat în factură!','success');
    if(currentOrderId) refreshOrderRowCount(currentOrderId);
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function preiaToateInFactura() {
  const nrFactura = document.getElementById('inv-nr').value.trim();
  if(!nrFactura) { toast('Introdu mai întâi numărul facturii!','warn'); return; }

  const btns = document.querySelectorAll('#inv-quick-body button.btn-primary:not([disabled])');
  if(!btns.length) { toast('Toate produsele sunt deja în factură.','info'); return; }

  for(const btn of btns) {
    const row   = btn.closest('tr');
    const prodId = row?.dataset?.prodId;
    if(prodId) await preiaUnulInFactura(prodId, btn);
  }
  toast(`✅ ${btns.length} produs(e) preluate în factura ${nrFactura}!`,'success');
  await loadOrders();
}

function showExistingFacturaProducts() {
  const prods = window._existingFacturaProds || [];
  if(!prods.length) return;

  const panel = document.getElementById('inv-quick-products');
  const tbody  = document.getElementById('inv-quick-body');
  const codEl  = document.getElementById('inv-quick-cod');
  const nrFact = document.getElementById('inv-nr').value.trim();

  panel.style.display = 'block';
  codEl.textContent   = nrFact + ' (existente)';
  tbody.innerHTML     = '';

  prods.forEach(p => {
    const cmd = p.comenzi || {};
    const tr  = document.createElement('tr');
    tr.dataset.prodId = p.id;
    tr.innerHTML = `
      <td class="text-yellow fw-bold font-mono" style="font-size:12px">${escHtml(p.cod_aftermarket)}</td>
      <td style="font-size:12px">${escHtml(p.descriere||'—')}</td>
      <td><span class="badge b-${p.status_produs}">${p.status_produs}</span></td>
      <td>
        <input class="sf-input inv-sku-input" value="${escHtml(p.sku||'')}"
          placeholder="SKU" style="width:100px" data-prod-id="${p.id}"/>
      </td>
      <td><span style="color:var(--green);font-size:13px">✅ În factură</span></td>
      <td>
        <button class="btn btn-secondary btn-xs" onclick="saveSkuOnly('${p.id}',this.closest('tr'))">
          💾 SKU
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Autosave SKU
  tbody.querySelectorAll('.inv-sku-input').forEach(input => {
    input.addEventListener('blur', async () => {
      const pid = input.dataset.prodId;
      const val = input.value.trim();
      if(!val) return;
      try {
        await api(`produse_comandate?id=eq.${pid}`, { method:'PATCH', body:JSON.stringify({ sku: val }) });
        showAutosaveStatus('SKU salvat ✓');
        input.style.borderColor = 'var(--green)';
        setTimeout(() => input.style.borderColor = '', 1500);
      } catch(e) { toast('Eroare SKU: '+e.message,'error'); }
    });
  });
}

async function saveSkuOnly(prodId, row) {
  const skuVal = row.querySelector('.inv-sku-input')?.value?.trim();
  if(!skuVal) { toast('Introdu un SKU!','warn'); return; }
  try {
    await api(`produse_comandate?id=eq.${prodId}`, { method:'PATCH', body:JSON.stringify({ sku: skuVal }) });
    toast('SKU salvat!','success');
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function checkExistingInvoice() {
  const nr = document.getElementById('inv-nr').value.trim();
  if(!nr) return;
  try {
    const existing = await api(
      `produse_comandate?cod_factura_furnizor=eq.${encodeURIComponent(nr)}&select=*,comenzi(nr_comanda,cod_comanda_unic,clienti(nume))&limit=20`
    );
    const warn = document.getElementById('inv-existing-warning');
    if(existing.length) {
      warn.style.display = 'block';
      warn.innerHTML = `⚠️ Există deja ${existing.length} produs(e) cu această factură. <strong style="cursor:pointer;text-decoration:underline" onclick="showExistingFacturaProducts()">Vezi produsele →</strong>`;
      window._existingFacturaProds = existing;
    } else {
      warn.style.display = 'none';
      window._existingFacturaProds = [];
    }
  } catch(e) { /* silent */ }
}

async function invoiceNext() {
  const nr       = document.getElementById('inv-nr').value.trim();
  const furnizor = document.getElementById('inv-furnizor').value;
  const codUnic  = document.getElementById('inv-cod-unic')?.value?.trim();
  if(!nr) { toast('Introduceți numărul facturii!','warn'); return; }

  const btn = document.getElementById('inv-next-btn');
  btn.disabled = true; btn.textContent = '⏳ Se încarcă...';

  try {
    const allProds = [];
    const orderMap = {};
    const seenIds  = new Set();

    // ── Sursa 1: produse care au deja acest număr de factură ──────
    const prodsExistente = await api(
      `produse_comandate?cod_factura_furnizor=eq.${encodeURIComponent(nr)}&select=*,comenzi(id,nr_comanda,cod_comanda_unic,furnizor,clienti(nume))`
    );
    prodsExistente.forEach(p => {
      if(!seenIds.has(p.id)) {
        seenIds.add(p.id);
        if(p.comenzi) orderMap[p.comenzi.id] = p.comenzi;
        allProds.push({ ...p, _sursa: 'factura' });
      }
    });

    // ── Sursa 2: produse din comanda cu cod unic selectat ─────────
    if(codUnic) {
      const comenziMatch = await api(
        `comenzi?cod_comanda_unic=eq.${encodeURIComponent(codUnic)}&select=id,nr_comanda,cod_comanda_unic,furnizor,clienti(nume)`
      );
      comenziMatch.forEach(o => { orderMap[o.id] = o; });
      const cmdIds = comenziMatch.map(o=>o.id);
      if(cmdIds.length > 0) {
        const p2 = await api(
          `produse_comandate?comanda_id=in.(${cmdIds.join(',')})&select=*`
        );
        p2.forEach(p => {
          if(!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allProds.push({ ...p, _sursa: 'comanda' });
          }
        });
      }
    }

    // ── Dacă nu avem nicio sursă și există furnizor → fallback comenzi furnizor
    if(allProds.length === 0 && furnizor) {
      const comenziFurn = await api(
        `comenzi?furnizor=eq.${encodeURIComponent(furnizor)}&status_general=in.(in_lucru,finalizata)&select=id,nr_comanda,cod_comanda_unic,furnizor,clienti(nume)`
      );
      comenziFurn.forEach(o => { orderMap[o.id] = o; });
      const ids = comenziFurn.map(o=>o.id);
      if(ids.length > 0) {
        const chunks = [];
        for(let i=0;i<ids.length;i+=20) chunks.push(ids.slice(i,i+20));
        for(const chunk of chunks) {
          const p = await api(`produse_comandate?comanda_id=in.(${chunk.join(',')})&status_produs=in.(comandat,ajuns)&select=*`);
          p.forEach(x => { if(!seenIds.has(x.id)){ seenIds.add(x.id); allProds.push(x); } });
        }
      }
    }

    // Render tabel pas 2
    renderInvoiceProducts(allProds, orderMap, nr, furnizor);

    document.getElementById('invoice-step1').style.display = 'none';
    document.getElementById('invoice-step2').style.display = 'block';
    document.getElementById('invoice-foot').style.display  = 'none';
    document.getElementById('invoice-foot2').style.display = 'flex';
    document.getElementById('invoice-subtitle').textContent = 'Pas 2 din 2 — Completează detalii';
    document.getElementById('inv-nr-display').textContent   = nr;
    document.getElementById('inv-furn-display').textContent = furnizor || 'toți';
    document.getElementById('inv-count-display').textContent = `${prods.length} produse găsite`;

  } catch(e) {
    toast('Eroare: '+e.message,'error');
  }
  btn.disabled = false; btn.textContent = 'Continuă →';
}

function renderInvoiceProducts(prods, orderMap, nrFactura, furnizor) {
  invoiceProducts = prods;
  const tbody = document.getElementById('invoice-products-body');
  tbody.innerHTML = '';

  if(!prods.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
      Nu există produse cu status <strong>Comandat</strong>${furnizor?' de la '+furnizor:''}.
      <br><span style="font-size:12px;color:var(--muted)">Toate produsele sunt deja procesate sau nu există comenzi.</span>
    </td></tr>`;
    document.getElementById('inv-confirm-btn').disabled = true;
    return;
  }

  prods.forEach((p, i) => {
    // Support both direct comanda_id lookup and embedded comenzi from join
    const ord = orderMap[p.comanda_id] || p.comenzi || {};
    const tr  = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td><input type="checkbox" class="inv-check" checked onchange="updateInvSelectedCount()"/></td>
      <td>
        <span class="font-mono text-blue fw-bold" style="font-size:12px">${escHtml(p.sku||'—')}</span>
      </td>
      <td class="text-yellow fw-bold font-mono" style="white-space:nowrap;font-size:12px">${escHtml(p.cod_aftermarket)}</td>
      <td style="font-size:12px;max-width:160px">${escHtml(p.descriere||'—')}</td>
      <td><span class="nr-cmd" style="font-size:11px">${fmtNr(ord.nr_comanda)}</span></td>
      <td style="font-size:12px">${escHtml(ord.clienti?.nume||'—')}</td>
      <td>
        <input class="inv-cod-furn" value="${escHtml(p.cod_aftermarket)}"
          placeholder="Cod de pe factură"
          style="width:120px;background:var(--s3);border:1px solid var(--accent);border-radius:5px;color:var(--text);padding:4px 8px;font-size:12px;outline:none"/>
      </td>
      <td>
        <input type="number" class="inv-pret" value="${p.pret_achizitie||0}"
          style="width:80px;background:var(--s3);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px;outline:none"/>
      </td>
      <td>
        <input type="number" class="inv-cant" value="${p.cantitate||1}" min="1"
          style="width:50px;background:var(--s3);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px;outline:none"/>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateInvSelectedCount();
}

function updateInvSelectedCount() {
  const total    = document.querySelectorAll('.inv-check').length;
  const selected = document.querySelectorAll('.inv-check:checked').length;
  document.getElementById('inv-selected-count').textContent = `${selected} din ${total} selectate`;
  document.getElementById('inv-confirm-btn').disabled = selected === 0;
  document.getElementById('inv-check-all').checked = selected === total && total > 0;
  document.getElementById('inv-check-all').indeterminate = selected > 0 && selected < total;
}

function invToggleAll(checked) {
  document.querySelectorAll('.inv-check').forEach(c => c.checked = checked);
  updateInvSelectedCount();
}

function invSelectAll()   { invToggleAll(true); }

function invDeselectAll() { invToggleAll(false); }

function invoiceBack() {
  document.getElementById('invoice-step1').style.display = 'block';
  document.getElementById('invoice-step2').style.display = 'none';
  document.getElementById('invoice-foot').style.display  = 'flex';
  document.getElementById('invoice-foot2').style.display = 'none';
  document.getElementById('invoice-subtitle').textContent = 'Pas 1 din 2 — Identificare factură';
}

async function invoiceConfirm() {
  const nrFactura = document.getElementById('inv-nr').value.trim();
  const rows      = document.querySelectorAll('#invoice-products-body tr[data-idx]');
  const toProcess = [];

  rows.forEach(row => {
    const checked = row.querySelector('.inv-check')?.checked;
    if(!checked) return;
    const idx  = +row.dataset.idx;
    const prod = invoiceProducts[idx];
    const cantPrimita = parseInt(row.querySelector('.inv-cant-primita')?.value)||0;
    const cantCmd     = prod.cantitate || 1;
    toProcess.push({
      id:                   prod.id,
      cod_factura_furnizor: nrFactura,
      pret_achizitie:       parseFloat(row.querySelector('.inv-pret')?.value)||0,
      cantitate:            cantPrimita, // actualizează cantitatea cu ce s-a primit
      status_produs:        cantPrimita >= cantCmd ? 'ajuns' : 'comandat', // parțial = rămâne comandat
      data_sosire:          cantPrimita > 0 ? new Date().toISOString() : null,
    });
  });

  if(!toProcess.length) { toast('Niciun produs selectat!','warn'); return; }

  const btn = document.getElementById('inv-confirm-btn');
  btn.disabled = true; btn.textContent = '⏳ Se salvează...';

  try {
    // Patch fiecare produs individual (Supabase nu suportă bulk patch cu valori diferite)
    await Promise.all(toProcess.map(p => {
      const { id, ...patch } = p;
      return api(`produse_comandate?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(patch) });
    }));

    toast(`✅ ${toProcess.length} produs(e) marcate ca Ajunse cu factura ${nrFactura}!`, 'success');
    closeModal('modal-invoice');
    await loadOrders();
    loadAllProducts();
  } catch(e) {
    toast('Eroare: '+e.message, 'error');
    btn.disabled = false; btn.textContent = '✅ Marchează ca Ajunse';
  }
}

function openAddFacturaModal() {
  document.getElementById('af-nr').value = '';
  document.getElementById('af-furnizor').value = '';
  document.getElementById('af-link').value = '';
  setTimeout(()=>document.getElementById('af-nr')?.focus(), 100);
  openModal('modal-add-factura');
  // Pre-fill furnizor din filtrul activ dacă există
  const filt = document.getElementById('f-factura-furnizor')?.value;
  if(filt) document.getElementById('af-furnizor').value = filt;
}

async function saveAddFactura() {
  const nr      = document.getElementById('af-nr').value.trim();
  const furnizor= document.getElementById('af-furnizor').value.trim();
  const link    = document.getElementById('af-link').value.trim();

  if(!nr) { toast('Numărul facturii este obligatoriu!','warn'); return; }

  const pdfUrl = link ? convertDriveUrl(link) : null;

  try {
    await upsertFactura(nr, {
      furnizor:     furnizor || null,
      pdf_url:      pdfUrl,
      pdf_filename: pdfUrl ? 'Link Drive' : null,
      status:       'nou',
    });
    toast(`✅ Factura ${nr} adăugată!`, 'success');
    closeModal('modal-add-factura');
    await renderPdfList();
    // Deschide workspace dacă are PDF
    if(pdfUrl) openFacturaWorkspace(nr);
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function loadFacturiDb() {
  try {
    _facturiDb = await api('facturi?select=*&order=creat_la.desc');
  } catch(e) { console.warn('loadFacturiDb:', e.message); _facturiDb = []; }
}

function getFacturaByNr(nr) {
  return _facturiDb.find(f => f.nr_factura === nr) || null;
}

function getFacturaPdfUrl(nr) {
  return getFacturaByNr(nr)?.pdf_url || null;
}

async function upsertFactura(nr, data) {
  // Creează sau actualizează intrarea în tabelul facturi
  const existing = getFacturaByNr(nr);
  if(existing) {
    const updated = await api(`facturi?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ ...data, actualizat: new Date().toISOString() })
    });
    // Update cache
    const idx = _facturiDb.findIndex(f=>f.id===existing.id);
    if(idx>=0) _facturiDb[idx] = { ...existing, ...data };
    return updated?.[0] || existing;
  } else {
    const [created] = await api('facturi', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ nr_factura: nr, creat_de: currentUserEmail, ...data })
    });
    _facturiDb.unshift(created);
    return created;
  }
}

async function setFacturaPdfUrl(nr, url, filename) {
  await upsertFactura(nr, { pdf_url: url, pdf_filename: filename || null });
}

async function removeFacturaPdf(nr) {
  const f = getFacturaByNr(nr);
  if(!f) return;
  if(!confirm(`Ștergi intrarea pentru factura ${nr}?`)) return;
  await api(`facturi?id=eq.${f.id}`, { method:'DELETE', headers:{'Prefer':'return=minimal'} });
  _facturiDb = _facturiDb.filter(x=>x.id!==f.id);
  toast('Factură eliminată.','info');
  renderPdfList();
  loadFacturi();
}

function convertDriveUrl(url) {
  // Convertește orice format de link Drive în URL de preview iframe
  // https://drive.google.com/file/d/FILE_ID/view?... → .../preview
  // https://drive.google.com/open?id=FILE_ID → .../preview
  const matchFile = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if(matchFile) return `https://drive.google.com/file/d/${matchFile[1]}/preview`;
  const matchOpen = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if(matchOpen) return `https://drive.google.com/file/d/${matchOpen[1]}/preview`;
  // Dacă e deja un URL de preview, returnează ca atare
  if(url.includes('drive.google.com')) return url.replace('/view', '/preview').split('?')[0];
  return url;
}

function promptFacturaPdfUrl(nrFactura) {
  const existing = getFacturaPdfUrl(nrFactura) || '';
  const raw = prompt(
    `Factură: ${nrFactura}

Lipește link-ul de share din Google Drive:
(Click dreapta pe fișier → Share → Anyone with link → Copy link)`,
    existing
  );
  if(raw === null) return; // Anulat
  if(!raw.trim()) { toast('Link invalid!', 'warn'); return; }

  const previewUrl = convertDriveUrl(raw.trim());
  setFacturaPdfUrl(nrFactura, previewUrl);
  toast(`✅ PDF asociat facturii ${nrFactura}!`, 'success');
  // Dacă preview-ul e deschis, actualizează
  if(document.getElementById('modal-pdf-factura').classList.contains('open')) {
    previewFacturaPdf(nrFactura);
  } else {
    loadFacturi();
    previewFacturaPdf(nrFactura);
  }
}

function previewFacturaPdf(nrFactura) {
  const url = getFacturaPdfUrl(nrFactura);
  if(!url) { toast('Niciun PDF asociat acestei facturi.', 'warn'); return; }
  document.getElementById('pdf-fact-nr').textContent = nrFactura;
  document.getElementById('pdf-fact-iframe').src = url;
  openModal('modal-pdf-factura');
}

async function showFacturiTab(tab) {
  // Tab buttons
  document.querySelectorAll('.ftab').forEach(b => {
    const isActive = b.id === `ftab-${tab}`;
    b.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
    b.style.color = isActive ? 'var(--accent)' : 'var(--muted)';
    b.classList.toggle('active', isActive);
  });
  // Content
  const prodEl   = document.getElementById('ftab-content-produse');
  const pdfEl    = document.getElementById('ftab-content-pdf-list');
  if(prodEl) prodEl.style.display   = tab === 'produse'  ? 'block' : 'none';
  if(pdfEl)  pdfEl.style.display    = tab === 'pdf-list' ? 'block' : 'none';
  console.log('Tab switched to:', tab, 'pdf-list display:', pdfEl?.style.display);
  if(tab === 'pdf-list') await renderPdfList();
}

async function renderPdfList() {
  document.getElementById('pdf-list-count').textContent = '⏳ Se încarcă...';
  // Always fetch fresh from Supabase
  try {
    _facturiDb = await api('facturi?select=*&order=creat_la.desc');
  } catch(e) {
    document.getElementById('pdf-list-count').textContent = '❌ Eroare: ' + e.message;
    return;
  }
  const facturi = _facturiDb;
  document.getElementById('pdf-list-count').textContent = `${facturi.length} factur${facturi.length !== 1 ? 'i' : 'ă'}`;

  const tbody = document.getElementById('pdf-list-body');
  tbody.innerHTML = '';

  if(!facturi.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
      Nicio factură în sistem.<br>
      <span style="font-size:12px;color:var(--muted)">Apasă "📤 Upload factură nouă" pentru a adăuga.</span>
    </td></tr>`;
    return;
  }

  const statusLabel = { nou:'🆕 Nouă', in_procesare:'⏳ În procesare', procesat:'✅ Procesat' };
  const statusColor = { nou:'var(--accent)', in_procesare:'var(--yellow)', procesat:'var(--green)' };

  facturi.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="fw-bold font-mono" style="color:var(--accent);cursor:pointer;text-decoration:underline dotted"
          onclick="openFacturaWorkspace('${escHtml(f.nr_factura)}')">${escHtml(f.nr_factura)}</span>
      </td>
      <td style="font-size:12px">${escHtml(f.furnizor||'—')}</td>
      <td style="font-size:12px;color:var(--muted)">
        ${f.pdf_filename ? `📎 ${escHtml(f.pdf_filename)}` : '<span style="color:var(--muted)">Fără PDF</span>'}
      </td>
      <td>
        <span style="color:${statusColor[f.status]||'var(--muted)'};font-size:12px;font-weight:600">
          ${statusLabel[f.status]||f.status}
        </span>
      </td>
      <td style="font-size:11px;color:var(--muted)">${fmtDate(f.creat_la)}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        ${f.pdf_url
          ? `<button class="btn btn-primary btn-xs" onclick="openFacturaWorkspace('${escHtml(f.nr_factura)}')">📋 Deschide</button>`
          : `<button class="btn btn-secondary btn-xs" onclick="startUploadFactura('${escHtml(f.nr_factura)}')">📤 Upload PDF</button>`
        }
        <button class="btn btn-secondary btn-xs" onclick="startUploadFactura('${escHtml(f.nr_factura)}')">🔄</button>
        <button class="icon-btn" style="color:var(--red)" onclick="removeFacturaPdf('${escHtml(f.nr_factura)}')">🗑</button>
      </td>
    `;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openFacturaWorkspace(f.nr_factura));
    tbody.appendChild(tr);
  });
}

async function startUploadNewPdf() {
  // Autentificare Google dacă nu avem token
  if(!_gdriveToken) {
    const ok = confirm('Este nevoie de autentificare Google Drive.\nApasă OK pentru a continua.');
    if(!ok) return;
    try {
      await gdriveGetToken();
    } catch(e) {
      toast('Autentificare eșuată: ' + e.message, 'error');
      return;
    }
  }

  // Deschide file picker direct
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.pdf';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;

    // Extrage numărul facturii din numele fișierului (fără extensie)
    const nrFactura = file.name.replace(/\.pdf$/i, '').trim();

    // Creează intrarea în DB
    const furnizor = document.getElementById('f-factura-furnizor')?.value || null;
    await upsertFactura(nrFactura, { furnizor, status: 'nou' });

    // Upload în Drive
    try {
      toast('⏳ Se urcă în Google Drive...', 'info');
      const previewUrl = await gdriveUpload(nrFactura, file);
      await upsertFactura(nrFactura, {
        pdf_url:      previewUrl,
        pdf_filename: file.name,
        status:       'nou'
      });
      toast(`✅ Factură ${nrFactura} urcată!`, 'success');

      // Analizează cu Claude dacă nu are produse
      await renderPdfList();
      await analyzeFacturaPdf(nrFactura, file);

    } catch(e) {
      toast('Eroare upload: ' + e.message, 'error');
    }
  };
  input.click();
}

async function openFacturaWorkspace(nrFactura) {
  const f = getFacturaByNr(nrFactura);

  // Creează modal dinamic dacă nu există
  let overlay = document.getElementById('modal-factura-workspace');
  if(!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-factura-workspace';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'z-index:600';
    overlay.innerHTML = `
      <div class="modal modal-lg" style="max-width:1200px;height:94vh;display:flex;flex-direction:column">
        <div class="modal-head">
          <div>
            <h3>🧾 <span id="fw-nr" style="color:var(--accent)"></span></h3>
            <div id="fw-subtitle" style="font-size:12px;color:var(--muted);margin-top:2px"></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="fw-status" onchange="updateFacturaStatus()" style="background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:6px 10px;font-size:12px;cursor:pointer">
              <option value="nou">🆕 Nouă</option>
              <option value="in_procesare">⏳ În procesare</option>
              <option value="procesat">✅ Procesat</option>
            </select>
            <button class="icon-btn" onclick="closeModal('modal-factura-workspace')">✕</button>
          </div>
        </div>

        <div style="flex:1;display:flex;gap:0;overflow:hidden;min-height:0">
          <!-- Stânga: PDF preview -->
          <div style="flex:1;border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;background:var(--s2)">
              <span style="font-size:12px;color:var(--muted);font-weight:600">PDF FACTURĂ</span>
              <button class="btn btn-secondary btn-xs" onclick="startUploadFactura(document.getElementById('fw-nr').textContent)">🔄 Re-upload</button>
            </div>
            <div id="fw-pdf-area" style="flex:1;display:flex;align-items:center;justify-content:center;background:var(--s3)">
              <div id="fw-no-pdf" style="text-align:center;color:var(--muted)">
                <div style="font-size:48px;margin-bottom:12px">📄</div>
                <div>Niciun PDF urcat</div>
                <button class="btn btn-primary" style="margin-top:12px" onclick="startUploadFactura(document.getElementById('fw-nr').textContent)">📤 Upload PDF</button>
              </div>
              <iframe id="fw-iframe" src="" style="width:100%;height:100%;border:none;display:none"></iframe>
            </div>
          </div>

          <!-- Dreapta: Produse + SKU -->
          <div style="width:480px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--s2)">
              <span style="font-size:12px;color:var(--muted);font-weight:600">PRODUSE DIN ACEASTĂ FACTURĂ</span>
            </div>
            <div style="flex:1;overflow-y:auto;padding:12px">
              <div id="fw-products-loading"><span class="spinner"></span>Se încarcă...</div>
              <div id="fw-products-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => { if(e.target===overlay) closeModal('modal-factura-workspace'); });
    document.body.appendChild(overlay);
  }

  // Populează datele
  document.getElementById('fw-nr').textContent = nrFactura;
  document.getElementById('fw-subtitle').textContent =
    `${f?.furnizor||''} · Creat: ${f?.creat_la ? fmtDate(f.creat_la) : '—'} · ${f?.creat_de||''}`;

  // Status
  const statusSel = document.getElementById('fw-status');
  statusSel.value = f?.status || 'nou';

  // PDF
  if(f?.pdf_url) {
    document.getElementById('fw-no-pdf').style.display = 'none';
    document.getElementById('fw-iframe').style.display = 'block';
    document.getElementById('fw-iframe').src = f.pdf_url;
  } else {
    document.getElementById('fw-no-pdf').style.display = 'block';
    document.getElementById('fw-iframe').style.display = 'none';
    document.getElementById('fw-iframe').src = '';
  }

  openModal('modal-factura-workspace');
  await loadWorkspaceProducts(nrFactura);
}

async function loadWorkspaceProducts(nrFactura) {
  const listEl = document.getElementById('fw-products-list');
  document.getElementById('fw-products-loading').style.display = 'block';
  listEl.innerHTML = '';

  try {
    const [prodsDb, nealocateStore] = await Promise.all([
      api(`produse_comandate?cod_factura_furnizor=eq.${encodeURIComponent(nrFactura)}&select=*,comenzi(nr_comanda,cod_comanda_unic,clienti(nume))`),
      Promise.resolve(JSON.parse(localStorage.getItem('crm_produse_nealocate') || '{}'))
    ]);
    const prodsLocal = nealocateStore[nrFactura] || [];

    document.getElementById('fw-products-loading').style.display = 'none';

    if(!prodsDb.length && !prodsLocal.length) {
      listEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="font-size:32px;margin-bottom:8px">📦</div>
        <div>Niciun produs legat de această factură.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px"
          onclick="closeModal('modal-factura-workspace');openInvoiceWizard()">＋ Procesează factura</button>
      </div>`;
      return;
    }

    // ── Potrivire automată nealocate ↔ alocate ──────────────────────
    // Indexăm alocatele după cod aftermarket
    const dbByCod = {};
    prodsDb.forEach(p => {
      const key = p.cod_aftermarket?.trim().toUpperCase();
      if(!dbByCod[key]) dbByCod[key] = [];
      dbByCod[key].push(p);
    });

    const matched   = []; // { local, db } perechi potrivite
    const onlyLocal = []; // nealocate fără pereche
    const onlyDb    = new Set(prodsDb.map(p => p.id)); // alocate fără pereche

    prodsLocal.forEach(local => {
      const key = local.cod_aftermarket?.trim().toUpperCase();
      const dbMatches = dbByCod[key] || [];
      if(dbMatches.length) {
        const db = dbMatches.shift(); // ia primul match
        matched.push({ local, db });
        onlyDb.delete(db.id);
      } else {
        onlyLocal.push(local);
      }
    });

    const onlyDbProds = prodsDb.filter(p => onlyDb.has(p.id));

    // ── Render ────────────────────────────────────────────────────────
    listEl.innerHTML = '';

    // Header statistici
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;font-size:12px';
    statsDiv.innerHTML = `
      ${matched.length   ? `<span style="background:rgba(16,185,129,.1);color:var(--green);padding:4px 10px;border-radius:20px;font-weight:600">✅ ${matched.length} potrivite</span>` : ''}
      ${onlyLocal.length ? `<span style="background:rgba(245,158,11,.1);color:var(--yellow);padding:4px 10px;border-radius:20px;font-weight:600">⏳ ${onlyLocal.length} nealocate</span>` : ''}
      ${onlyDbProds.length ? `<span style="background:rgba(99,102,241,.1);color:#818cf8;padding:4px 10px;border-radius:20px;font-weight:600">🔗 ${onlyDbProds.length} doar în sistem</span>` : ''}
    `;
    listEl.appendChild(statsDiv);

    // ── Produse POTRIVITE ─────────────────────────────────────────────
    if(matched.length) {
      const secTitle = document.createElement('div');
      secTitle.style.cssText = 'font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px';
      secTitle.textContent = `✅ Potrivite (${matched.length})`;
      listEl.appendChild(secTitle);

      matched.forEach(({ local, db }) => {
        const cmd = db.comenzi || {};
        const hasSku = !!db.sku;
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--green);border-radius:var(--r-md);margin-bottom:8px;overflow:hidden;background:var(--s1)';
        card.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--border)">
            <!-- Stânga: din factură -->
            <div style="padding:10px 12px;border-right:1px solid var(--border);background:rgba(16,185,129,.03)">
              <div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:4px">DIN FACTURĂ</div>
              <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:12px">${escHtml(local.cod_aftermarket)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(local.descriere||'')}</div>
              <div style="font-size:11px;margin-top:2px">
                Cant: <strong>${local.cantitate}</strong> &nbsp;·&nbsp;
                Preț: <strong>${fmtRON(local.pret_achizitie)} RON</strong>
              </div>
            </div>
            <!-- Dreapta: din sistem -->
            <div style="padding:10px 12px;background:rgba(16,185,129,.03)">
              <div style="font-size:10px;color:var(--muted);font-weight:600;margin-bottom:4px">ÎN SISTEM</div>
              <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:12px">${escHtml(db.cod_aftermarket)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(db.descriere||'')}</div>
              <div style="font-size:10px;color:var(--muted2);margin-top:2px">${escHtml(cmd.cod_comanda_unic||'')} · ${escHtml(cmd.clienti?.nume||'—')}</div>
              <span class="badge b-${db.status_produs}" style="margin-top:4px;display:inline-block">${db.status_produs}</span>
            </div>
          </div>
          <!-- SKU row -->
          <div style="padding:8px 12px;display:flex;align-items:center;gap:8px;background:var(--s2)">
            <span style="font-size:11px;color:var(--muted);flex-shrink:0">SKU:</span>
            <input id="sku-${db.id}" value="${escHtml(db.sku||local.sku||'')}"
              placeholder="${hasSku ? '' : '⚠ SKU lipsă'}"
              style="flex:1;background:var(--bg);border:1px solid ${hasSku?'var(--green)':'var(--accent)'};border-radius:6px;color:var(--text);padding:4px 8px;font-size:12px;font-family:monospace;outline:none"/>
            <button class="btn btn-primary btn-xs" onclick="saveWorkspaceSku('${db.id}','${escHtml(db.cod_aftermarket)}')">💾</button>
            <button class="btn btn-secondary btn-xs" onclick="syncFromFactura('${db.id}','${escHtml(local.pret_achizitie)}','${escHtml(local.cantitate)}')" title="Actualizează prețul din factură">
              🔄 Preț factură
            </button>
          </div>
        `;
        listEl.appendChild(card);
      });
    }

    // ── Produse NEALOCATE ─────────────────────────────────────────────
    if(onlyLocal.length) {
      const secTitle = document.createElement('div');
      secTitle.style.cssText = 'font-size:11px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:.6px;margin:12px 0 8px;display:flex;justify-content:space-between;align-items:center';
      secTitle.innerHTML = `<span>⏳ Nealocate (${onlyLocal.length})</span>
        <button class="btn btn-primary btn-xs" onclick="openAllocateModal('${escHtml(nrFactura)}')">🔗 Alocă la comandă</button>`;
      listEl.appendChild(secTitle);

      onlyLocal.forEach(p => {
        const localIdx = onlyLocal.indexOf(p);
        const card = document.createElement('div');
        card.style.cssText = 'padding:10px 12px;border-radius:var(--r-md);margin-bottom:6px;border:1px solid var(--yellow);background:rgba(245,158,11,.05)';
        card.innerHTML = `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="min-width:0">
              <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:12px">${escHtml(p.cod_aftermarket)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(p.descriere||'')}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">Cant: ${p.cantitate} · Preț: ${fmtRON(p.pret_achizitie)} RON</div>
            </div>
            <span style="font-size:10px;color:var(--yellow);font-weight:600;flex-shrink:0">NEALOCATĂ</span>
          </div>
          ${onlyDbProds.length ? `
          <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--muted)">Fuzionează cu:</span>
            <select id="fuz-sel-${localIdx}"
              style="flex:1;min-width:0;background:var(--s2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;font-size:11px;cursor:pointer">
              <option value="">— selectează produs din sistem —</option>
              ${onlyDbProds.map(dp => `<option value="${dp.id}">${escHtml(dp.cod_aftermarket||'N/A')} · ${escHtml(dp.descriere||'')} · ${escHtml(dp.comenzi?.clienti?.nume||'')}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-xs" onclick="fuzionează('${escHtml(nrFactura)}',${localIdx},'${escHtml(JSON.stringify(p))}')">
              🔗 Fuzionează
            </button>
          </div>` : ''}
        `;
        listEl.appendChild(card);
      });
    }

    // ── Produse DOAR ÎN SISTEM ────────────────────────────────────────
    if(onlyDbProds.length) {
      const secTitle = document.createElement('div');
      secTitle.style.cssText = 'font-size:11px;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 8px';
      secTitle.textContent = `🔗 Doar în sistem (${onlyDbProds.length})`;
      listEl.appendChild(secTitle);

      onlyDbProds.forEach(p => {
        const cmd = p.comenzi || {};
        const hasSku = !!p.sku;
        const card = document.createElement('div');
        card.style.cssText = `padding:10px 12px;border-radius:var(--r-md);margin-bottom:8px;border:1px solid ${hasSku?'var(--green)':'var(--border)'};background:var(--s1)`;
        card.innerHTML = `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="min-width:0">
              <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:12px">${escHtml(p.cod_aftermarket)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(p.descriere||'')}</div>
              <div style="font-size:10px;color:var(--muted2);margin-top:2px">${escHtml(cmd.cod_comanda_unic||'')} · ${escHtml(cmd.clienti?.nume||'—')}</div>
            </div>
            <span class="badge b-${p.status_produs}" style="flex-shrink:0">${p.status_produs}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
            <input id="sku-${p.id}" value="${escHtml(p.sku||'')}"
              placeholder="${hasSku ? '' : '⚠ SKU lipsă'}"
              style="flex:1;background:var(--s2);border:1px solid ${hasSku?'var(--green)':'var(--accent)'};border-radius:6px;color:var(--text);padding:5px 9px;font-size:12px;font-family:monospace;outline:none"/>
            <button class="btn btn-primary btn-xs" onclick="saveWorkspaceSku('${p.id}','${escHtml(p.cod_aftermarket)}')">💾</button>
          </div>`;
        listEl.appendChild(card);
      });
    }

  } catch(e) {
    document.getElementById('fw-products-loading').style.display = 'none';
    listEl.innerHTML = `<div style="color:var(--red);padding:12px">Eroare: ${e.message}</div>`;
  }
}

async function syncFromFactura(prodId, pretAchizitie, cantitate) {
  try {
    await api(`produse_comandate?id=eq.${prodId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        pret_achizitie: parseFloat(pretAchizitie),
        cantitate:      parseInt(cantitate)
      })
    });
    toast('Preț și cantitate actualizate din factură!', 'success');
    const nrFact = document.getElementById('fw-nr').textContent;
    await loadWorkspaceProducts(nrFact);
  } catch(e) { toast('Eroare: '+e.message, 'error'); }
}

async function fuzionează(nrFactura, localIdx, localJson) {
  const local = JSON.parse(localJson);
  const selEl = document.getElementById(`fuz-sel-${localIdx}`);
  const dbProdId = selEl?.value;
  if(!dbProdId) { toast('Selectează un produs din sistem!', 'warn'); return; }

  try {
    // Actualizează produsul din sistem cu datele din factură
    // Păstrează: comanda_id, client, sku existent, status
    // Actualizează: cod_aftermarket (dacă era N/A), pret_achizitie, cantitate, cod_factura_furnizor
    const existing = await api(`produse_comandate?id=eq.${dbProdId}&select=*`);
    const prod = existing?.[0];
    if(!prod) { toast('Produs negăsit!', 'error'); return; }

    const patch = {
      pret_achizitie:       local.pret_achizitie,
      cantitate:            local.cantitate,
      cod_factura_furnizor: nrFactura,
    };
    // Actualizează codul dacă cel din sistem e N/A sau gol
    if(!prod.cod_aftermarket || prod.cod_aftermarket === 'N/A' || prod.cod_aftermarket === '') {
      patch.cod_aftermarket = local.cod_aftermarket;
    }
    // Actualizează descrierea dacă cea din sistem e goală
    if(!prod.descriere && local.descriere) {
      patch.descriere = local.descriere;
    }
    // Adaugă SKU din factură dacă nu are deja
    if(!prod.sku && local.sku) {
      patch.sku = local.sku;
    }

    await api(`produse_comandate?id=eq.${dbProdId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });

    // Elimină produsul din localStorage (nealocate)
    const nealocate = JSON.parse(localStorage.getItem('crm_produse_nealocate') || '{}');
    if(nealocate[nrFactura]) {
      nealocate[nrFactura] = nealocate[nrFactura].filter((_, i) => {
        // Găsim produsul după cod+pret
        return !(nealocate[nrFactura][i]?.cod_aftermarket === local.cod_aftermarket &&
                 nealocate[nrFactura][i]?.pret_achizitie  === local.pret_achizitie);
      });
      if(!nealocate[nrFactura].length) delete nealocate[nrFactura];
      localStorage.setItem('crm_produse_nealocate', JSON.stringify(nealocate));
    }

    toast(`✅ ${local.cod_aftermarket} fuzionat cu produsul din sistem!`, 'success');
    await loadWorkspaceProducts(nrFactura);

  } catch(e) { toast('Eroare: ' + e.message, 'error'); }
}

async function openAllocateModal(nrFactura) {
  // Creează modal dinamic
  let modal = document.getElementById('modal-allocate-prods');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-allocate-prods';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '800';
    modal.innerHTML = `
      <div class="modal" style="max-width:580px">
        <div class="modal-head">
          <h3>🔗 Alocă produse la comandă</h3>
          <button class="icon-btn" onclick="closeModal('modal-allocate-prods')">✕</button>
        </div>
        <div class="modal-body" style="gap:16px">
          <div id="alloc-prods-info" style="background:var(--s2);border-radius:var(--r-md);padding:10px 14px;font-size:13px"></div>

          <div style="display:flex;gap:10px">
            <button class="btn btn-primary" style="flex:1" id="alloc-btn-existing" onclick="allocAction('existing')">
              📋 Comandă existentă
            </button>
            <button class="btn btn-secondary" style="flex:1" id="alloc-btn-new" onclick="allocAction('new')">
              ＋ Comandă nouă
            </button>
          </div>

          <!-- Selectare comandă existentă -->
          <div id="alloc-existing-section" style="display:none">
            <label style="font-size:12px;color:var(--muted);font-weight:600">CAUTĂ COMANDĂ</label>
            <input id="alloc-search" placeholder="Client sau cod unic..." 
              style="width:100%;margin-top:6px"
              oninput="filterAllocOrders(this.value)"/>
            <div id="alloc-orders-list" style="max-height:260px;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
          </div>

          <!-- Comandă nouă -->
          <div id="alloc-new-section" style="display:none">
            <div class="grid2">
              <div class="field">
                <label>Client *</label>
                <div style="display:flex;gap:6px">
                  <select id="alloc-client" style="flex:1"></select>
                  <button class="btn btn-secondary btn-sm" onclick="openQuickAddClientAlloc()" type="button" title="Client nou">＋</button>
                </div>
              </div>
              <div class="field">
                <label>Tip plată</label>
                <select id="alloc-plata">
                  <option value="avans">Avans</option>
                  <option value="achitat_integral">Achitat integral</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Avans (RON)</label>
              <input type="number" id="alloc-avans" value="0" min="0"/>
            </div>
          </div>
        </div>
        <div class="modal-foot" id="alloc-foot" style="display:none">
          <button class="btn btn-ghost" onclick="closeModal('modal-allocate-prods')">Anulează</button>
          <button class="btn btn-primary" id="alloc-confirm-btn" onclick="confirmAllocate()">✅ Confirmă alocarea</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', e => { if(e.target===modal) closeModal('modal-allocate-prods'); });
    document.body.appendChild(modal);
  }

  window._allocNrFactura = nrFactura;
  window._allocSelectedOrderId = null;
  window._allocMode = null;

  const nealocate = JSON.parse(localStorage.getItem('crm_produse_nealocate') || '{}');
  const prods = nealocate[nrFactura] || [];
  document.getElementById('alloc-prods-info').innerHTML =
    `<strong>${prods.length}</strong> produse din factura <strong>${escHtml(nrFactura)}</strong> de alocat`;

  document.getElementById('alloc-existing-section').style.display = 'none';
  document.getElementById('alloc-new-section').style.display = 'none';
  document.getElementById('alloc-foot').style.display = 'none';

  openModal('modal-allocate-prods');
}

async function allocAction(mode) {
  window._allocMode = mode;

  // Deactivate both sections first
  document.getElementById('alloc-existing-section').style.display = 'none';
  document.getElementById('alloc-new-section').style.display      = 'none';
  document.getElementById('alloc-foot').style.display             = 'flex';

  // Highlight active button
  document.querySelectorAll('#modal-allocate-prods .btn').forEach(b => b.style.opacity = '0.6');
  const activeBtn = document.querySelector(`#modal-allocate-prods .btn[onclick="allocAction('${mode}')"]`);
  if(activeBtn) activeBtn.style.opacity = '1';

  if(mode === 'existing') {
    document.getElementById('alloc-existing-section').style.display = 'block';
    // Fetch fresh orders if needed
    if(!allOrders?.length) await loadOrders();
    await renderAllocOrders(allOrders || []);

  } else {
    document.getElementById('alloc-new-section').style.display = 'block';

    // Fetch clienți dacă nu sunt în memorie
    let clients = allClients || [];
    if(!clients.length) {
      try {
        clients = await api('clienti?select=id,nume&order=nume');
        allClients = clients;
      } catch(e) { console.warn('clients fetch:', e.message); }
    }

    const sel = document.getElementById('alloc-client');
    sel.innerHTML = '<option value="">— selectează client —</option>' +
      clients.map(c => `<option value="${c.id}">${escHtml(c.nume)}</option>`).join('');
  }
}

function renderAllocOrders(orders) {
  const listEl = document.getElementById('alloc-orders-list');
  const q = document.getElementById('alloc-search')?.value?.toLowerCase() || '';
  const filtered = orders.filter(o =>
    o.status_general === 'in_lucru' &&
    (!q || o.client_nume?.toLowerCase().includes(q) || o.cod_comanda_unic?.toLowerCase().includes(q))
  ).slice(0, 30);

  listEl.innerHTML = '';
  if(!filtered.length) {
    listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Nicio comandă activă găsită.</div>';
    return;
  }

  filtered.forEach(o => {
    const div = document.createElement('div');
    div.style.cssText = `padding:10px 14px;border-radius:var(--r-md);cursor:pointer;border:2px solid var(--border);
      background:var(--s1);transition:all .15s`;
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-weight:700;color:var(--accent);font-size:13px">${escHtml(o.cod_comanda_unic||fmtNr(o.nr_comanda))}</span>
          <span style="color:var(--muted);font-size:12px;margin-left:8px">${escHtml(o.client_nume||'')}</span>
        </div>
        <span style="font-size:11px;color:var(--muted)">${fmtDate(o.data_creare)}</span>
      </div>`;
    div.addEventListener('click', () => {
      document.querySelectorAll('#alloc-orders-list > div').forEach(d =>
        d.style.borderColor = 'var(--border)');
      div.style.borderColor = 'var(--accent)';
      window._allocSelectedOrderId = o.id;
      window._allocSelectedOrderCod = o.cod_comanda_unic;
    });
    listEl.appendChild(div);
  });
}

function filterAllocOrders(q) {
  renderAllocOrders(allOrders || []);
}

async function confirmAllocate() {
  const nrFactura = window._allocNrFactura;
  const mode      = window._allocMode;
  const nealocate = JSON.parse(localStorage.getItem('crm_produse_nealocate') || '{}');
  const prods     = nealocate[nrFactura] || [];

  if(!prods.length) { toast('Nu sunt produse de alocat!', 'warn'); return; }

  let comandaId = null;

  if(mode === 'existing') {
    comandaId = window._allocSelectedOrderId;
    if(!comandaId) { toast('Selectează o comandă din listă!', 'warn'); return; }
  } else {
    // Creează comandă nouă
    const clientId = document.getElementById('alloc-client').value;
    if(!clientId) { toast('Selectează un client!', 'warn'); return; }
    const tipPlata = document.getElementById('alloc-plata').value;
    const avans    = parseFloat(document.getElementById('alloc-avans').value) || 0;
    const total    = prods.reduce((s, p) => s + (p.pret_achizitie||0) * (p.cantitate||1), 0);

    try {
      const agentName = window._currentAgentFirstName || null;
      const [cmd] = await api('comenzi', {
        method: 'POST',
        body: JSON.stringify({
          client_id:     clientId,
          tip_plata:     tipPlata,
          total_plata:   parseFloat(total.toFixed(2)),
          avans_achitat: avans,
          furnizor:      getFacturaByNr(nrFactura)?.furnizor || null,
          agent_vanzari: agentName,
        })
      });
      comandaId = cmd.id;
    } catch(e) { toast('Eroare creare comandă: ' + e.message, 'error'); return; }
  }

  // Alocă produsele
  let saved = 0;
  for(const p of prods) {
    try {
      await api('produse_comandate', {
        method: 'POST',
        body: JSON.stringify({
          comanda_id:           comandaId,
          cod_aftermarket:      p.cod_aftermarket,
          descriere:            p.descriere,
          cantitate:            p.cantitate,
          pret_achizitie:       p.pret_achizitie,
          cod_factura_furnizor: nrFactura,
          status_produs:        'ajuns',
        })
      });
      saved++;
    } catch(e) { console.warn('Alloc error:', e.message); }
  }

  // Șterge din localStorage
  delete nealocate[nrFactura];
  localStorage.setItem('crm_produse_nealocate', JSON.stringify(nealocate));

  await upsertFactura(nrFactura, { status: 'in_procesare' });
  toast(`✅ ${saved} produse alocate!`, 'success');
  closeModal('modal-allocate-prods');
  await loadWorkspaceProducts(nrFactura);
  loadOrders();
}

async function saveWorkspaceSku(prodId, cod) {
  const sku = document.getElementById(`sku-${prodId}`)?.value?.trim();
  if(!sku) { toast('Introdu un SKU!','warn'); return; }
  try {
    await api(`produse_comandate?id=eq.${prodId}`, {
      method:'PATCH',
      body: JSON.stringify({ sku })
    });
    const nrFact = document.getElementById('fw-nr').textContent;
    await upsertFactura(nrFact, { status: 'in_procesare' });
    toast(`SKU ${sku} salvat pentru ${cod}!`, 'success');
    // Visual feedback
    const input = document.getElementById(`sku-${prodId}`);
    if(input) {
      input.style.borderColor = 'var(--green)';
      input.closest('div[style]').style.borderColor = 'var(--green)';
      input.closest('div[style]').style.background = 'rgba(16,185,129,.04)';
    }
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function updateFacturaStatus() {
  const nr = document.getElementById('fw-nr').textContent;
  const status = document.getElementById('fw-status').value;
  try {
    await upsertFactura(nr, { status });
    toast('Status actualizat.','success');
    renderPdfList();
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function analyzeFacturaPdf(nrFactura, file) {
  showAnalyzeModal(nrFactura);

  try {
    // Setează workerul PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Citește fișierul ca ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extrage tot textul din toate paginile
    let fullText = '';
    for(let i = 1; i <= pdf.numPages; i++) {
      const page  = await pdf.getPage(i);
      const tc    = await page.getTextContent();
      // Reconstruiește liniile după poziție Y
      const items = tc.items.sort((a,b) => {
        const dy = Math.round(b.transform[5]) - Math.round(a.transform[5]);
        return dy !== 0 ? dy : a.transform[4] - b.transform[4];
      });
      let lastY = null;
      for(const item of items) {
        const y = Math.round(item.transform[5]);
        if(lastY !== null && Math.abs(y - lastY) > 3) fullText += '\n';
        fullText += item.str + ' ';
        lastY = y;
      }
      fullText += '\n\n';

    }

    console.log('PDF text extras:', fullText.substring(0, 500));

    // Parsează factura
    const result = parseFacturaText(fullText, nrFactura);
    renderAnalyzeResults(nrFactura, result);

  } catch(e) {
    document.getElementById('analyze-status').innerHTML =
      `<span style="color:var(--red)">❌ Eroare: ${e.message}</span>
       <br><small>Poți adăuga produsele manual din workspace.</small>`;
    console.error('PDF analyze error:', e);
  }
}

function parseRoPrice(str) {
  if(!str) return 0;
  const s = str.trim();
  // Detectează formatul:
  // 1,056.34  → englezesc (virgulă=mii, punct=zecimale) → 1056.34
  // 1.056,34  → românesc (punct=mii, virgulă=zecimale)  → 1056.34
  // 686.62    → punct decimal → 686.62
  // 686,62    → virgulă decimal → 686.62
  if(s.includes(',') && s.includes('.')) {
    const commaPos = s.lastIndexOf(',');
    const dotPos   = s.lastIndexOf('.');
    if(dotPos > commaPos) {
      // 1,056.34 → punct e decimal (englezesc)
      return parseFloat(s.replace(/,/g, ''));
    } else {
      // 1.056,34 → virgulă e decimal (românesc)
      return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    }
  }
  if(s.includes(',')) return parseFloat(s.replace(',', '.'));
  return parseFloat(s);
}

function parseFacturaText(text, nrFactura) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = { nr_factura: nrFactura, furnizor: null, data: null, produse: [] };

  // Furnizor
  for(const line of lines) {
    if(/intercars/i.test(line))  { result.furnizor = 'Intercars'; break; }
    if(/elit/i.test(line))       { result.furnizor = 'Elit'; break; }
    if(/autofore/i.test(line))   { result.furnizor = 'Autofore'; break; }
  }

  // Data
  const dateMatch = text.match(/(\d{2}[.\/\-]\d{2}[.\/\-]\d{2,4})/);
  if(dateMatch) result.data = dateMatch[1];

  // ── Parser Intercars ─────────────────────────────────────────────────
  // Format linie: LINIE  COD_ARTICOL  TARIF_VAMAL  DESCRIERE  CANT  [BUC]  PRET_UNIT  REDUCERE  PRET_DISC  TVA  TOTAL
  // Exemplu: "1 BM80509H 84213200 Convertor catlitic 1 BUC 1,056.34 35.00 686.62 21 686.62"

  // Găsim headerul
  const headerIdx = lines.findIndex(l => /NR.*ARTICOL|Nr\.?\s*Articol/i.test(l));

  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  for(const line of dataLines) {
    // Skip linii goale, totaluri, sumar TVA
    if(/^(total|sumar|tva|baza|valoare|pagina|furnizor|client|swift|iban|capital)/i.test(line)) continue;
    if(/^\d{1,3}$/.test(line)) continue; // doar număr

    // Tokenizăm simplu după spații
    const tokens = line.split(/\s+/).filter(Boolean);
    if(tokens.length < 5) continue;

    let idx = 0;

    // Skip nr. linie dacă primul token e număr mic
    if(/^\d{1,3}$/.test(tokens[idx])) idx++;

    // Găsim indexul tarifului vamal (exact 8 cifre)
    const tarifIdx = tokens.findIndex((t, i) => i >= idx && /^\d{8}$/.test(t));

    let cod = '';
    if(tarifIdx > idx) {
      // COD ARTICOL = toate token-urile între linie și tarif vamal
      // Exemplu: "538 0356 10" sau "BM80509H"
      cod = tokens.slice(idx, tarifIdx).join(' ').trim();
      idx = tarifIdx + 1; // skip tarif vamal
    } else {
      // Fără tarif vamal detectat — primul token e codul
      cod = tokens[idx];
      idx++;
      // Skip dacă pare tarif vamal
      if(tokens[idx] && /^\d{6,10}$/.test(tokens[idx])) idx++;
    }

    if(!cod || cod.length < 2) continue;
    if(/^(BUC|PCS|SET|KIT|ML|LT|KG)$/i.test(cod)) continue;
    if(/linie|articol|descriere|cantitate|pret|vamal/i.test(cod)) continue;

    // DESCRIERE — adunăm token-uri non-numerice
    let descriere = '';
    while(idx < tokens.length) {
      const t = tokens[idx];
      // Ne oprim când găsim cantitatea (număr întreg mic urmat de prețuri)
      if(/^\d{1,4}$/.test(t) && idx < tokens.length - 1) {
        const next = tokens[idx + 1];
        if(/BUC|PCS|SET|KIT/i.test(next) || /[\d,.]+/.test(next)) break;
      }
      if(/^[\d,.]+$/.test(t) && t.length > 3) break; // preț
      descriere += (descriere ? ' ' : '') + t;
      idx++;
    }

    // CANTITATE
    let cantitate = 1;
    if(tokens[idx] && /^\d{1,4}$/.test(tokens[idx])) {
      cantitate = parseInt(tokens[idx]);
      idx++;
    }

    // Skip unitate măsură (BUC, PCS etc)
    if(tokens[idx] && /^(BUC|PCS|SET|KIT|ML|LT|KG|L|M)$/i.test(tokens[idx])) idx++;

    // Parsăm de la DREAPTA spre stânga — structura fixă Intercars:
    // ... PRET_UNIT  REDUCERE  PRET_DISC  TVA%  TOTAL
    // De la dreapta: [0]=TOTAL [1]=TVA% [2]=PRET_DISC [3]=REDUCERE [4]=PRET_UNIT
    const allTokens = tokens;
    const numericFromRight = [];
    for(let j = allTokens.length - 1; j >= 0; j--) {
      if(/^[\d,.]+$/.test(allTokens[j])) {
        numericFromRight.push({ val: parseRoPrice(allTokens[j]), raw: allTokens[j], pos: j });
      } else break; // oprim la primul non-numeric din dreapta
    }

    // TVA% = primul număr mic (5-25) din dreapta
    let tva = 21;
    for(let j = allTokens.length - 1; j >= 0; j--) {
      const v = parseInt(allTokens[j]);
      if(/^\d{1,2}$/.test(allTokens[j]) && v >= 5 && v <= 25) {
        tva = v;
        break;
      }
    }

    // PRET_DISC = al 3-lea numeric de la dreapta (după TOTAL și TVA%)
    // Structura: PRET_UNIT  REDUCERE  PRET_DISC  TVA%  TOTAL
    let pretDisc = 0;
    if(numericFromRight.length >= 3) {
      pretDisc = numericFromRight[2].val; // PRET_DISC
    } else if(numericFromRight.length === 2) {
      pretDisc = numericFromRight[0].val; // TOTAL (=PRET_DISC când nu e reducere)
    } else if(numericFromRight.length === 1) {
      pretDisc = numericFromRight[0].val;
    }

    if(pretDisc <= 0 || !cod || cod.length < 3) continue;

    // PRET ACHIZITIE = PRET UNIT DISC * (1 + TVA/100)
    const pretAchizitie = parseFloat((pretDisc * (1 + tva / 100)).toFixed(2));

    result.produse.push({
      cod_aftermarket: cod,
      descriere:       descriere.trim(),
      cantitate,
      pret_achizitie:  pretAchizitie
    });
  }

  console.log('Produse extrase:', result.produse);
  return result;
}

function showAnalyzeModal(nrFactura) {
  // Creează modal dinamic
  let modal = document.getElementById('modal-analyze-pdf');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-analyze-pdf';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '700';
    modal.innerHTML = `
      <div class="modal" style="max-width:700px">
        <div class="modal-head">
          <h3>🤖 Analiză PDF — <span id="analyze-nr" style="color:var(--accent)"></span></h3>
          <button class="icon-btn" onclick="closeModal('modal-analyze-pdf')">✕</button>
        </div>
        <div class="modal-body">
          <div id="analyze-status" style="text-align:center;padding:20px;color:var(--muted)">
            <span class="spinner"></span> Claude analizează factura...
          </div>
          <div id="analyze-results" style="display:none">
            <div id="analyze-info" style="margin-bottom:12px;font-size:13px;color:var(--muted)"></div>
            <div class="tbl-wrap">
              <table style="width:100%">
                <thead>
                  <tr>
                    <th>Cod aftermarket</th>
                    <th>Descriere</th>
                    <th>Cant.</th>
                    <th>Preț acq. (RON)</th>
                    <th>SKU</th>
                    <th><input type="checkbox" id="analyze-check-all" checked onchange="document.querySelectorAll('.analyze-row-check').forEach(c=>c.checked=this.checked)"/></th>
                  </tr>
                </thead>
                <tbody id="analyze-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="modal-foot" id="analyze-foot" style="display:none">
          <button class="btn btn-ghost" onclick="closeModal('modal-analyze-pdf')">Anulează</button>
          <button class="btn btn-primary" onclick="saveAnalyzeResults()">💾 Salvează produsele selectate</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('analyze-nr').textContent = nrFactura;
  document.getElementById('analyze-status').innerHTML = '<span class="spinner"></span> Claude analizează factura...';
  document.getElementById('analyze-results').style.display = 'none';
  document.getElementById('analyze-foot').style.display = 'none';
  window._analyzeNrFactura = nrFactura;
  openModal('modal-analyze-pdf');
}

function renderAnalyzeResults(nrFactura, result) {
  const statusEl  = document.getElementById('analyze-status');
  const resultsEl = document.getElementById('analyze-results');
  const footEl    = document.getElementById('analyze-foot');
  const tbody     = document.getElementById('analyze-tbody');

  if(!result.produse?.length) {
    statusEl.innerHTML = '⚠️ Nu s-au găsit produse în factură. Poți adăuga manual din workspace.';
    return;
  }

  statusEl.style.display = 'none';
  resultsEl.style.display = 'block';
  footEl.style.display = 'flex';

  document.getElementById('analyze-info').innerHTML =
    `Furnizor: <strong>${result.furnizor||'—'}</strong> &nbsp;·&nbsp;
     Data: <strong>${result.data||'—'}</strong> &nbsp;·&nbsp;
     <strong>${result.produse.length}</strong> produse găsite`;

  // Actualizează furnizorul în DB dacă l-am găsit
  if(result.furnizor) {
    upsertFactura(nrFactura, { furnizor: result.furnizor });
  }

  tbody.innerHTML = '';
  window._analyzeProds = result.produse;

  result.produse.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="sf-input" id="ap-cod-${i}" value="${escHtml(p.cod_aftermarket||'')}" style="width:110px"/></td>
      <td><input class="sf-input" id="ap-desc-${i}" value="${escHtml(p.descriere||'')}" style="width:160px"/></td>
      <td><input class="sf-input" type="number" id="ap-cant-${i}" value="${p.cantitate||1}" style="width:55px"/></td>
      <td><input class="sf-input" type="number" id="ap-pret-${i}" value="${p.pret_achizitie||0}" step="0.01" style="width:80px"/></td>
      <td><input class="sf-input" id="ap-sku-${i}" placeholder="SKU" style="width:90px"/></td>
      <td><input type="checkbox" class="analyze-row-check" data-idx="${i}" checked/></td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveAnalyzeResults() {
  const nrFactura = window._analyzeNrFactura;
  const checked   = document.querySelectorAll('.analyze-row-check:checked');
  if(!checked.length) { toast('Selectează cel puțin un produs!', 'warn'); return; }

  // Salvăm produsele în tabelul facturi_produse (fără comandă obligatorie)
  // Folosim produse_comandate cu comanda_id = null (permis prin schema)
  let saved = 0;
  const produse = [];
  for(const cb of checked) {
    const i = cb.dataset.idx;
    produse.push({
      cod_aftermarket:      document.getElementById(`ap-cod-${i}`)?.value?.trim() || 'N/A',
      descriere:            document.getElementById(`ap-desc-${i}`)?.value?.trim() || '',
      cantitate:            parseFloat(document.getElementById(`ap-cant-${i}`)?.value) || 1,
      pret_achizitie:       parseFloat(document.getElementById(`ap-pret-${i}`)?.value) || 0,
      sku:                  document.getElementById(`ap-sku-${i}`)?.value?.trim() || null,
      cod_factura_furnizor: nrFactura,
    });
    saved++;
  }

  // Salvează în localStorage — ÎNLOCUIEȘTE (nu concat) ca să evităm duplicate
  const existing = JSON.parse(localStorage.getItem('crm_produse_nealocate') || '{}');
  existing[nrFactura] = produse; // înlocuiește complet
  localStorage.setItem('crm_produse_nealocate', JSON.stringify(existing));

  await upsertFactura(nrFactura, { status: 'in_procesare' });
  toast(`✅ ${saved} produse salvate! Alocă-le la o comandă din workspace.`, 'success');
  closeModal('modal-analyze-pdf');

  // Deschide workspace pentru alocare
  await renderPdfList();
  openFacturaWorkspace(nrFactura);
}

async function openFacturaDetail(nrFactura) {
  // Creăm un modal dinamic
  let overlay = document.getElementById('modal-factura-detail');
  if(!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-factura-detail';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-head">
          <div>
            <h3>🧾 Factură <span id="fd-nr" style="color:var(--accent)"></span></h3>
            <div style="font-size:12px;color:var(--muted);margin-top:2px" id="fd-subtitle"></div>
          </div>
          <button class="icon-btn" onclick="document.getElementById('modal-factura-detail').classList.remove('open')">✕</button>
        </div>
        <div class="modal-body" style="padding:0">
          <div class="tbl-wrap" style="border:none;border-radius:0">
            <table class="prod-tbl">
              <thead>
                <tr>
                  <th>Cod Unic Cmd.</th><th>Cod aftermarket</th><th>Descriere</th>
                  <th>SKU</th><th>Cant.</th><th>Preț acq.</th><th>Preț vânz.</th>
                  <th>Status</th><th>Client</th><th>Nr. Cmd.</th>
                </tr>
              </thead>
              <tbody id="fd-body"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-foot">
          <div style="flex:1;font-size:13px;color:var(--muted)" id="fd-totals"></div>
          <button class="btn btn-ghost" onclick="document.getElementById('modal-factura-detail').classList.remove('open')">Închide</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.classList.remove('open'); });
    document.body.appendChild(overlay);
  }

  document.getElementById('fd-nr').textContent = nrFactura;
  document.getElementById('fd-body').innerHTML = '<tr><td colspan="10" class="empty-state"><span class="spinner"></span></td></tr>';
  overlay.classList.add('open');

  try {
    const prods = await api(
      `produse_comandate?cod_factura_furnizor=eq.${encodeURIComponent(nrFactura)}&select=*,comenzi(id,nr_comanda,cod_comanda_unic,clienti(nume))`
    );
    const tbody = document.getElementById('fd-body');
    tbody.innerHTML = '';

    if(!prods.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Niciun produs găsit.</td></tr>';
      return;
    }

    let totalAcq = 0, totalVanz = 0;
    prods.forEach(p => {
      const cmd = p.comenzi||{};
      totalAcq  += (+p.pret_achizitie||0)*(+p.cantitate||1);
      totalVanz += (+p.pret_vanzare||0)*(+p.cantitate||1);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="font-mono" style="color:var(--accent);font-size:11px">${escHtml(cmd.cod_comanda_unic||'—')}</span></td>
        <td class="fw-bold font-mono" style="color:var(--accent)">${escHtml(p.cod_aftermarket)}</td>
        <td style="font-size:12px">${escHtml(p.descriere||'—')}</td>
        <td style="font-size:11px;color:var(--blue);font-family:monospace">${escHtml(p.sku||'—')}</td>
        <td style="text-align:center">${p.cantitate||1}</td>
        <td>${fmtRON(p.pret_achizitie)} RON</td>
        <td class="fw-bold" style="color:var(--green)">${fmtRON(p.pret_vanzare)} RON</td>
        <td><span class="badge b-${p.status_produs}">${p.status_produs}</span></td>
        <td style="font-size:12px">${escHtml(cmd.clienti?.nume||'—')}</td>
        <td>
          <span class="nr-cmd" style="cursor:pointer" onclick="closeAndJump('modal-factura-detail','${cmd.id||''}')">
            ${fmtNr(cmd.nr_comanda)}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('fd-subtitle').textContent = `${prods.length} produse`;
    const pdfUrl = getFacturaPdfUrl(nrFactura);
    document.getElementById('fd-totals').innerHTML =
      `Total acq: <strong>${fmtRON(totalAcq)} RON</strong> &nbsp;|&nbsp; Total vânz: <strong style="color:var(--green)">${fmtRON(totalVanz)} RON</strong>
       &nbsp;|&nbsp;
       ${pdfUrl
         ? `<button class="btn btn-secondary btn-xs" onclick="previewFacturaPdf('${escHtml(nrFactura)}')">🧾 Vezi PDF</button>`
         : `<button class="btn btn-secondary btn-xs" onclick="promptFacturaPdfUrl('${escHtml(nrFactura)}')">📎 Adaugă PDF</button>`
       }`;
  } catch(e) {
    document.getElementById('fd-body').innerHTML = `<tr><td colspan="10" style="color:var(--red);padding:12px">Eroare: ${e.message}</td></tr>`;
  }
}

function closeAndJump(modalId, orderId) {
  document.getElementById(modalId)?.classList.remove('open');
  if(!orderId) return;
  navigate('comenzi');
  const o = allOrders.find(x=>x.id===orderId);
  if(o) setTimeout(()=>loadDetail(orderId,o), 150);
}

