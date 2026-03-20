// orders.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadOrders() {
  _produseCacheByOrder = null; // Reset cache la reload
  document.getElementById('orders-loading').style.display='block';
  document.getElementById('orders-table').style.display='none';
  try {
    const data = await api('dashboard_comenzi?select=*&order=data_creare.desc&limit=400');
    allOrders = data;
    renderStats(data);
    populateFilter('f-furnizor', [...new Set(data.map(o=>o.furnizor).filter(Boolean))]);
    renderOrdersTable(applyOrderFilters(data));
    document.getElementById('orders-count').textContent = `(${data.length})`;
  } catch(e) {
    document.getElementById('orders-loading').innerHTML=`<span class="text-red">❌ ${e.message}</span>`;
  }
}

function applyOrderFilters(orders) {
  const q = document.getElementById('f-client').value.toLowerCase();
  const qProd = document.getElementById('f-produs')?.value?.toLowerCase()||'';
  const s = document.getElementById('f-status').value;
  const f = document.getElementById('f-furnizor').value;
  const p = document.getElementById('f-plata').value;

  let filtered = orders.filter(o=>
    (!q || o.client_nume?.toLowerCase().includes(q) || o.client_telefon?.toLowerCase().includes(q))&&
    (!s || o.status_general===s)&&
    (!f || o.furnizor===f)&&
    (!p || o.tip_plata===p)
  );

  // Filtrare după produs — async din DB dacă există termen
  if(qProd) {
    // Marchează comenzile care au produse matching (din cache local dacă există)
    // Fallback: caută în _produseCacheByOrder
    const matchingOrderIds = _produseCacheByOrder
      ? Object.entries(_produseCacheByOrder)
          .filter(([,prods]) => prods.some(p =>
            p.cod_aftermarket?.toLowerCase().includes(qProd) ||
            p.sku?.toLowerCase().includes(qProd) ||
            p.descriere?.toLowerCase().includes(qProd)
          ))
          .map(([id]) => id)
      : [];

    if(matchingOrderIds.length) {
      filtered = filtered.filter(o => matchingOrderIds.includes(o.id));
    } else if(!_produseFetchedForSearch) {
      // Fetch din DB prima dată
      fetchProduseForSearch(qProd);
    }
  }
  return filtered;
}

async function fetchProduseForSearch(q) {
  _produseFetchedForSearch = true;
  try {
    const prods = await api(
      `produse_comandate?select=comanda_id,cod_aftermarket,sku,descriere` +
      `&or=(cod_aftermarket.ilike.*${encodeURIComponent(q)}*,sku.ilike.*${encodeURIComponent(q)}*,descriere.ilike.*${encodeURIComponent(q)}*)`
    );
    _produseCacheByOrder = {};
    prods.forEach(p => {
      if(!_produseCacheByOrder[p.comanda_id]) _produseCacheByOrder[p.comanda_id] = [];
      _produseCacheByOrder[p.comanda_id].push(p);
    });
    renderOrdersTable(applyOrderFilters(allOrders));
  } catch(e) { console.warn('fetchProduseForSearch:', e.message); }
  _produseFetchedForSearch = false;
}

function populateFilter(selectId, values) {
  const sel = document.getElementById(selectId);
  const first = sel.options[0];
  sel.innerHTML='';
  sel.appendChild(first);
  values.forEach(v=>{ const o=document.createElement('option'); o.value=o.textContent=v; sel.appendChild(o); });
}

function renderStats(orders) {
  document.getElementById('s-total').textContent   = orders.length;
  document.getElementById('s-lucru').textContent   = orders.filter(o=>o.status_general==='in_lucru').length;
  document.getElementById('s-final').textContent   = orders.filter(o=>o.status_general==='finalizata').length;
  const totalRest = orders.reduce((s,o)=>s+calcRest(o),0);
  document.getElementById('s-rest').textContent    = fmtRON(totalRest);
  const totalVanz = orders.reduce((s,o)=>s+(+o.total_plata||0),0);
  document.getElementById('s-vanzari').textContent = fmtRON(totalVanz);
  computeProfit(orders);
  // Badges sidebar
  const ajunseTotal = orders.reduce((s,o)=>s+(+o.produse_ajunse||0),0);
  updateBadgePredare(ajunseTotal);
  // Update topbar
  const active = orders.filter(o=>o.status_general==='in_lucru').length;
  const tb_active  = document.getElementById('tb-active');
  const tb_rest    = document.getElementById('tb-rest');
  const tb_vanzari = document.getElementById('tb-vanzari');
  if(tb_active)  tb_active.textContent  = active;
  if(tb_rest)    tb_rest.textContent    = fmtRON(totalRest) + ' RON';
  if(tb_vanzari) tb_vanzari.textContent = fmtRON(totalVanz) + ' RON';
  // Produse ajunse azi
  const today = new Date().toISOString().slice(0,10);
  // Will be updated by computeProfit
}

async function computeProfit(orders) {
  try {
    const ids = orders.map(o=>o.id).slice(0,100); // max 100
    if(!ids.length) return;
    const prods = await api(`produse_comandate?comanda_id=in.(${ids.join(',')})&select=pret_achizitie,pret_vanzare,cantitate`);
    const totalAcq  = prods.reduce((s,p)=>s+(+p.pret_achizitie||0)*(+p.cantitate||1),0);
    const totalVanz = prods.reduce((s,p)=>s+(+p.pret_vanzare||0)*(+p.cantitate||1),0);
    const profit = totalVanz - totalAcq;
    const el = document.getElementById('s-profit');
    if(el) { el.textContent=fmtRON(profit); el.style.color=profit>=0?'var(--green)':'var(--red)'; }
    // Update total vânzări cu suma reală din produse
    const sv = document.getElementById('s-vanzari');
    if(sv) sv.textContent = fmtRON(totalVanz);
  } catch(e){ console.warn('computeProfit error:', e.message); }
}

function renderOrdersTable(orders) {
  document.getElementById('orders-loading').style.display='none';
  document.getElementById('orders-table').style.display='table';
  const tbody = document.getElementById('orders-body');
  tbody.innerHTML='';
  if(!orders.length) {
    tbody.innerHTML='<tr><td colspan="12" class="empty-state">Nicio comandă.</td></tr>';
    return;
  }
  orders.forEach(o=>{
    const ajunse  = +o.produse_ajunse||0;
    const predate = +o.produse_predate||0;
    const total   = +o.nr_produse||0;
    const arrived = ajunse+predate;
    const arrivedColor = arrived===total&&total>0 ? 'var(--green)' : arrived>0 ? 'var(--yellow)' : 'var(--muted)';

    const rest = calcRest(o);
    const toatePredate = (+o.produse_predate||0) === (+o.nr_produse||0) && (+o.nr_produse||0) > 0;
    const isDebt = toatePredate && rest > 0;
    const tr = document.createElement('tr');
    tr.className = 'clickable' + (isDebt ? ' row-debt' : '');
    tr.innerHTML = `
      <td><span class="nr-cmd">${fmtNr(o.nr_comanda)}</span></td>
      <td><span class="font-mono" style="font-size:11px;color:var(--yellow)">${escHtml(o.cod_comanda_unic||'—')}</span></td>
      <td style="white-space:nowrap">${fmtDate(o.data_creare)}</td>
      <td>
        <div class="fw-bold">${escHtml(o.client_nume)}</div>
        <div class="text-muted" style="font-size:11px">${escHtml(o.client_telefon||'')}</div>
      </td>
      <td class="text-muted" style="font-size:12px">${escHtml(o.furnizor||'—')}</td>
      <td>
        <span class="arrived-badge" style="color:${arrivedColor}">${arrived}/${total} ajunse</span>
      </td>
      <td class="fw-bold">${fmtRON(o.total_plata)}</td>
      <td>${fmtRON(o.avans_achitat)}</td>
      <td class="fw-bold" style="color:${calcRest(o)>0?'var(--yellow)':'var(--green)'}">${fmtRON(calcRest(o))}</td>
      <td style="font-size:12px">${plataBadge(o)}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        ${statusBadge(o)}
        <br>
        <select class="status-sel" data-id="${o.id}" onchange="updateOrderStatus(this)" onclick="event.stopPropagation()" style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;background:var(--s2);cursor:pointer;margin-top:4px;padding:2px 6px">
          <option value="in_lucru"   ${o.status_general==='in_lucru'  ?'selected':''}>✏️ În lucru</option>
          <option value="finalizata" ${o.status_general==='finalizata'?'selected':''}>✏️ Finalizată</option>
          <option value="anulata"    ${o.status_general==='anulata'   ?'selected':''}>❌ Anulată</option>
        </select>
      </td>
      <td style="font-size:11px;color:var(--muted)">${escHtml(o.agent_vanzari||'—')}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        <button class="icon-btn" onclick="openAddPlata('${o.id}',event)" title="Adaugă plată" style="color:var(--green)">💳</button>
        <button class="icon-btn" onclick="openEditOrder('${o.id}')" title="Editează">✏️</button>
        <button class="icon-btn btn-delete-order-row" onclick="confirmDeleteOrder('${o.id}','${escHtml(o.client_nume)}')" title="Șterge" style="color:var(--red)">🗑</button>
      </td>
    `;
    tr.addEventListener('click', ()=>loadDetail(o.id, o));
    tbody.appendChild(tr);
  });
}

async function updateOrderStatus(sel) {
  try {
    await api(`comenzi?id=eq.${sel.dataset.id}`,{method:'PATCH',body:JSON.stringify({status_general:sel.value})});
    const o = allOrders.find(x=>x.id===sel.dataset.id);
    if(o){ o.status_general=sel.value; renderStats(allOrders); }
    toast('Status actualizat.','success');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function confirmDeleteOrder(id, clientNume) {
  if(!confirm(`Ștergi comanda lui ${clientNume}?\nAceastă acțiune este ireversibilă și va șterge și toate produsele asociate.`)) return;
  try {
    // produse se șterg automat prin CASCADE
    await api(`comenzi?id=eq.${id}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
    await logAction('DELETE', 'comanda', id, { client: clientNume });
    allOrders = allOrders.filter(o=>o.id!==id);
    renderStats(allOrders);
    renderOrdersTable(applyOrderFilters(allOrders));
    if(currentOrderId===id) closeDetail();
    toast('Comanda a fost ștearsă.','info');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function loadDetail(id, o) {
  currentOrderId = id;

  // Show fullscreen modal
  const overlay = document.getElementById('detail-modal-overlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const nr      = fmtNr(o.nr_comanda);
  const codUnic = o.cod_comanda_unic || nr;
  document.getElementById('detail-title').textContent = `${nr} — ${o.client_nume}`;
  document.getElementById('detail-subtitle').textContent =
    `${codUnic} · ${fmtDate(o.data_creare)} · ${o.furnizor||''}`;

  // Summary bar
  const rest = calcRest(o);
  document.getElementById('dsb-total').textContent    = fmtRON(o.total_plata) + ' RON';
  document.getElementById('dsb-achitat').textContent  = fmtRON(o.avans_achitat) + ' RON';
  document.getElementById('dsb-rest').textContent     = fmtRON(rest) + ' RON';
  document.getElementById('dsb-rest').style.color     = rest > 0 ? 'var(--red)' : 'var(--green)';
  document.getElementById('dsb-produse').textContent  = `${+o.produse_ajunse+o.produse_predate}/${o.nr_produse} ajunse`;
  document.getElementById('dsb-furnizor').textContent = o.furnizor||'—';
  document.getElementById('dsb-agent').textContent    = o.agent_vanzari||'—';

  // Buttons
  document.getElementById('btn-edit-order').onclick         = ()=>openEditOrder(id);
  document.getElementById('btn-delete-order').onclick       = ()=>confirmDeleteOrder(id, o.client_nume);
  const statusSel = document.getElementById('detail-status-sel');
  if(statusSel) statusSel.value = o.status_general || 'in_lucru';
  document.getElementById('btn-add-prod-to-order').onclick  = ()=>openAddProductToOrder(id, o.cod_comanda_unic||nr);
  document.getElementById('btn-copy-order').onclick         = ()=>copyOrderWhatsApp(id, o);
  document.getElementById('btn-add-plata-detail').onclick   = ()=>openAddPlata(id);
  document.getElementById('dsb-add-plata').onclick          = ()=>openAddPlata(id);

  // Reset tabs
  document.querySelectorAll('#detail-panel .tab').forEach((t,i)=>{
    t.classList.toggle('active',i===0);
  });
  document.getElementById('tab-produse').classList.add('active');
  document.getElementById('tab-factura').classList.remove('active');

  await loadDetailProducts(id);
  refreshPdfSection(o);
  // Modal fullscreen - no scroll needed
}

function openDetailTab(id, o, tabId) {
  loadDetail(id, o);
  setTimeout(()=>{
    const tabs = document.querySelectorAll('#detail-panel .tab');
    if(tabId==='tab-factura') { tabs[0].classList.remove('active'); tabs[1].classList.add('active'); }
    document.getElementById('tab-produse').classList.toggle('active',tabId==='tab-produse');
    document.getElementById('tab-factura').classList.toggle('active',tabId==='tab-factura');
  },150);
}

async function loadDetailProducts(id) {
  const tbody = document.getElementById('detail-products-body');
  tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><span class="spinner"></span></td></tr>';
  try {
    const prods = await api(`produse_comandate?comanda_id=eq.${id}&select=*&order=data_comanda.asc`);
    tbody.innerHTML='';
    // Set adaos from first product or order
    const order = allOrders.find(o=>o.id===id);
    const adaosEl = document.getElementById('detail-adaos');
    if(adaosEl && order) adaosEl.value = order.adaos_procent||0;

    prods.forEach(p=>{
      const adaos = (p.adaos_procent!=null && p.adaos_procent!==0) ? p.adaos_procent : (order?.adaos_procent||0);
      const tr = document.createElement('tr');
      tr.dataset.id = p.id;
      tr.innerHTML = `
        <td class="text-yellow fw-bold font-mono" style="white-space:nowrap">${escHtml(p.cod_aftermarket)}</td>
        <td><input value="${escHtml(p.descriere||'')}" data-f="descriere" style="min-width:130px"/></td>
        <td><input type="number" value="${p.pret_achizitie||0}" data-f="pret_achizitie" style="width:72px" oninput="recalcDetailRow(this)"/></td>
        <td><input type="number" value="${adaos}" class="adaos-calc" style="width:58px;background:var(--s3);border:1px solid var(--border2);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px;outline:none" oninput="recalcDetailRow(this)"/></td>
        <td class="dp-vanz-cell"><input type="number" value="${p.pret_vanzare||0}" data-f="pret_vanzare" style="width:72px"/></td>
        <td><input type="number" value="${p.cantitate||1}" data-f="cantitate" style="width:48px" oninput="updateDetailTotals()"/></td>
        <td><input value="${escHtml(p.sku||'')}" data-f="sku" style="width:85px" placeholder="SKU"/></td>
        <td><input value="${escHtml(p.cod_factura_furnizor||'')}" data-f="cod_factura_furnizor" style="width:95px" placeholder="INV-001"/></td>
        <td>
          <select data-f="status_produs" onchange="updateProductStatus(this,'${p.id}')">
            <option value="comandat"  ${p.status_produs==='comandat' ?'selected':''}>📦 Comandat</option>
            <option value="ajuns"     ${p.status_produs==='ajuns'   ?'selected':''}>🏠 Ajuns</option>
            <option value="predat"    ${p.status_produs==='predat'  ?'selected':''}>✅ Predat</option>
            <option value="returnat"  ${p.status_produs==='returnat'?'selected':''}>↩️ Returnat</option>
          </select>
        </td>

      `;
      tbody.appendChild(tr);
    });
    updateDetailTotals();
    attachAutosave(tbody, 'product');
    highlightEmptySku(tbody);
  } catch(e) {
    tbody.innerHTML=`<tr><td colspan="10" class="text-red" style="padding:12px">Eroare: ${e.message}</td></tr>`;
  }
}

function recalcDetailRow(input) {
  const row = input.closest('tr');
  const acq   = parseFloat(row.querySelector('[data-f="pret_achizitie"]').value)||0;
  const adaos = parseFloat(row.querySelector('.adaos-calc').value)||0;
  const vanz  = acq*(1+adaos/100);
  row.querySelector('[data-f="pret_vanzare"]').value = vanz.toFixed(2);
  updateDetailTotals();
}

function updateDetailTotals() {
  const rows = document.querySelectorAll('#detail-products-body tr');
  let totalAcq=0, totalVanz=0;
  rows.forEach(row=>{
    const acq  = parseFloat(row.querySelector('[data-f="pret_achizitie"]')?.value)||0;
    const vanz = parseFloat(row.querySelector('[data-f="pret_vanzare"]')?.value)||0;
    const cant = parseFloat(row.querySelector('[data-f="cantitate"]')?.value)||1;
    totalAcq  += acq*cant;
    totalVanz += vanz*cant;
  });
  const tv = document.getElementById('detail-total-vanz');
  const tp = document.getElementById('detail-profit');
  if(tv) tv.textContent = totalVanz.toFixed(2);
  if(tp) tp.textContent = (totalVanz-totalAcq).toFixed(2);
}

async function applyDetailAdaos() {
  const adaos = parseFloat(document.getElementById('detail-adaos').value)||0;
  const rows  = document.querySelectorAll('#detail-products-body tr[data-id]');

  // 1. Actualizează UI
  rows.forEach(row => {
    const adaosInput = row.querySelector('.adaos-calc');
    const acqInput   = row.querySelector('[data-f="pret_achizitie"]');
    const vanzInput  = row.querySelector('[data-f="pret_vanzare"]');
    if(!adaosInput||!acqInput||!vanzInput) return;
    adaosInput.value = adaos;
    vanzInput.value  = ((parseFloat(acqInput.value)||0)*(1+adaos/100)).toFixed(2);
  });
  updateDetailTotals();

  // 2. Salvează toate produsele în paralel (fără refreshOrderTotal intermediar)
  const btn = document.getElementById('detail-adaos')?.nextElementSibling;
  const saves = [...rows].map(row => {
    const id = row.dataset.id;
    if(!id) return Promise.resolve();
    const patch = {};
    row.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      if(f==='status_produs') return;
      patch[f] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
    });
    const adaosEl = row.querySelector('.adaos-calc');
    if(adaosEl) patch.adaos_procent = parseFloat(adaosEl.value)||0;
    return api(`produse_comandate?id=eq.${id}`, {method:'PATCH', body:JSON.stringify(patch)});
  });

  try {
    await Promise.all(saves);
    // 3. Un singur refresh la final
    if(currentOrderId) await refreshOrderTotal(currentOrderId);
    showAutosaveStatus('Adaos aplicat și salvat ✓');
    toast('Adaos aplicat la toate produsele.','success');
  } catch(e) {
    toast('Eroare salvare adaos: '+e.message,'error');
  }
}

async function updateProductStatus(sel, prodId) {
  try {
    const patch={status_produs:sel.value};
    if(sel.value==='ajuns')  patch.data_sosire =new Date().toISOString();
    if(sel.value==='predat') patch.data_predare=new Date().toISOString();
    await api(`produse_comandate?id=eq.${prodId}`,{method:'PATCH',body:JSON.stringify(patch)});
    toast('Status produs salvat.','success');
    // Actualizează doar contorul din tabel fără reload complet
    if(currentOrderId) refreshOrderRowCount(currentOrderId);
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function saveProduct(prodId, row) {
  const patch={};
  row.querySelectorAll('[data-f]').forEach(el=>{
    const f=el.dataset.f;
    if(f==='status_produs') return;
    patch[f] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
  });
  try {
    await api(`produse_comandate?id=eq.${prodId}`,{method:'PATCH',body:JSON.stringify(patch)});
    toast('Produs salvat. ✓','success');
    if(currentOrderId) await refreshOrderTotal(currentOrderId);
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

function closeDetail() {
  document.getElementById('detail-modal-overlay').style.display='none';
  document.getElementById('pdf-preview-wrap').style.display='none';
  document.body.style.overflow='';
  currentOrderId=null;
}

async function openEditOrder(id) {
  const o = allOrders.find(x=>x.id===id);
  if(!o) return;
  editOrderId = id;
  const clients = await api('clienti?select=id,nume&order=nume.asc&limit=200');
  document.getElementById('modal-order-title').textContent = `Editează ${fmtNr(o.nr_comanda)}`;
  document.getElementById('modal-order-body').innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Client</label>
        <select id="eo-client">
          ${clients.map(c=>`<option value="${c.id}" ${c.id===o.client_id?'selected':''}>${escHtml(c.nume)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Furnizor</label>
        <input id="eo-furnizor" value="${escHtml(o.furnizor||'')}"/>
      </div>
    </div>
    <div class="grid3">
      <div class="field">
        <label>Tip plată</label>
        <select id="eo-tip-plata">
          <option value="avans"            ${o.tip_plata==='avans'?'selected':''}>Avans</option>
          <option value="achitat_integral" ${o.tip_plata==='achitat_integral'?'selected':''}>Achitat integral</option>
        </select>
      </div>
      <div class="field">
        <label>Avans achitat (RON)</label>
        <input type="number" id="eo-avans" value="${fmtRON(o.avans_achitat)}" min="0" step="0.01"/>
      </div>
      <div class="field">
        <label>Total plată (RON)</label>
        <input type="number" id="eo-total" value="${fmtRON(o.total_plata)}" min="0" step="0.01"/>
      </div>
    </div>
    <div class="grid2">
      <div class="field">
        <label>Status</label>
        <select id="eo-status">
          <option value="in_lucru"   ${o.status_general==='in_lucru'?'selected':''}>🔄 În Lucru</option>
          <option value="finalizata" ${o.status_general==='finalizata'?'selected':''}>✅ Finalizată</option>
          <option value="anulata"    ${o.status_general==='anulata'?'selected':''}>❌ Anulată</option>
        </select>
      </div>
      <div class="field">
        <label>Adaos (%)</label>
        <input type="number" id="eo-adaos" value="${o.adaos_procent||0}" min="0" step="0.5"/>
      </div>
    </div>
    <div class="field">
      <label>Note</label>
      <textarea id="eo-note">${escHtml(o.note_comanda||'')}</textarea>
    </div>
  `;
  // Override save button to use editOrder
  document.querySelector('#modal-order .modal-foot .btn-primary').onclick = editOrder;
  openModal('modal-order');
}

function addEditOrderProduct() {
  const tbody = document.getElementById('eo-products-body');
  const tr = document.createElement('tr');
  tr.dataset.id = 'new-' + Date.now();
  tr.innerHTML = `
    <td><input value="" data-f="cod_aftermarket" placeholder="Cod" class="prod-tbl input"/></td>
    <td><input value="" data-f="descriere" placeholder="Descriere" class="prod-tbl input" style="min-width:100px"/></td>
    <td><input type="number" value="0" data-f="pret_vanzare" class="prod-tbl input" style="width:75px"/></td>
    <td><input type="number" value="1" data-f="cantitate" class="prod-tbl input" style="width:48px"/></td>
    <td>
      <select data-f="status_produs" class="prod-tbl input">
        <option value="comandat">📦</option>
        <option value="ajuns">🏠</option>
        <option value="predat">✅</option>
      </select>
    </td>
    <td><button class="icon-btn" style="color:var(--red)" onclick="this.closest('tr').remove()">✕</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('input').focus();
}

async function removeEditOrderProduct(prodId, row) {
  if(!confirm('Ștergi acest produs din comandă?')) return;
  try {
    await api(`produse_comandate?id=eq.${prodId}`, { method:'DELETE', headers:{'Prefer':'return=minimal'} });
    await logAction('DELETE','produs',prodId,{comanda:editOrderId});
    row.remove();
    toast('Produs șters.','info');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function editOrder() {
  const patch = {
    client_id:     document.getElementById('eo-client').value,
    furnizor:      document.getElementById('eo-furnizor').value,
    tip_plata:     document.getElementById('eo-tip-plata').value,
    avans_achitat: parseFloat(document.getElementById('eo-avans').value)||0,
    total_plata:   parseFloat(document.getElementById('eo-total').value)||0,
    status_general:document.getElementById('eo-status').value,
    adaos_procent: parseFloat(document.getElementById('eo-adaos').value)||0,
    note_comanda:  document.getElementById('eo-note').value,
  };
  try {
    await api(`comenzi?id=eq.${editOrderId}`,{method:'PATCH',body:JSON.stringify(patch)});
    toast('Comanda salvată!','success');
    await logAction('UPDATE', 'comanda', editOrderId, patch);
    closeModal('modal-order');
    await loadOrders();
    if(currentOrderId===editOrderId) {
      const updated = allOrders.find(x=>x.id===editOrderId);
      if(updated) document.getElementById('detail-title').textContent=`${fmtNr(updated.nr_comanda)} — ${updated.client_nume} · ${fmtDate(updated.data_creare)}`;
    }
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function openNewOrder() {
  editOrderId = null;
  newOrderProducts = [{ cod_aftermarket:'', descriere:'', pret_achizitie:0, pret_vanzare:0, cantitate:1 }];
  const clients = await api('clienti?select=id,nume&order=nume.asc&limit=200');

  document.getElementById('modal-order-title').textContent = 'Comandă nouă';
  document.getElementById('modal-order-body').innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Client *</label>
        <div style="display:flex;gap:8px">
          <select id="no-client" style="flex:1">
            <option value="">— selectează —</option>
            ${clients.map(c=>`<option value="${c.id}">${escHtml(c.nume)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="openQuickAddClient()" type="button" title="Adaugă client nou">＋</button>
        </div>
      </div>
      <div class="field">
        <label>Furnizor</label>
        <input id="no-furnizor" placeholder="Ex: Intercars"/>
      </div>
    </div>
    <div class="grid3">
      <div class="field">
        <label>Tip plată</label>
        <select id="no-tip-plata">
          <option value="avans">Avans</option>
          <option value="achitat_integral">Achitat integral</option>
        </select>
      </div>
      <div class="field">
        <label>Avans achitat (RON)</label>
        <input type="number" id="no-avans" value="0" min="0" step="0.01"/>
      </div>
      <div class="field">
        <label>Adaos global (%)</label>
        <input type="number" id="no-adaos" value="0" min="0" step="0.5"/>
      </div>
    </div>
    <div class="divider"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:13px">Produse</strong>
      <button class="btn btn-secondary btn-sm" onclick="addNewOrderProduct()">＋ Adaugă produs</button>
    </div>
    <div class="tbl-wrap">
      <table class="prod-tbl">
        <thead><tr><th>Cod aftermarket</th><th>Descriere</th><th>Preț acq.</th><th>Adaos %</th><th>Preț vânz.</th><th>Cant.</th><th></th></tr></thead>
        <tbody id="no-products-body"></tbody>
      </table>
    </div>
    <div style="margin-top:10px;text-align:right;font-size:13px;color:var(--blue)">
      Total vânzare: <strong id="no-total">0.00</strong> RON
    </div>
    <div class="field" style="margin-top:10px">
      <label>Note</label>
      <textarea id="no-note" placeholder="Note opționale..."></textarea>
    </div>
  `;
  renderNewOrderProducts();
  document.querySelector('#modal-order .modal-foot .btn-primary').onclick = saveOrder;
  openModal('modal-order');
}

function addNewOrderProduct() {
  newOrderProducts.push({ cod_aftermarket:'', descriere:'', pret_achizitie:0, pret_vanzare:0, cantitate:1 });
  renderNewOrderProducts();
}

function renderNewOrderProducts() {
  const tbody = document.getElementById('no-products-body');
  if(!tbody) return;
  tbody.innerHTML='';
  const adaosGlobal = parseFloat(document.getElementById('no-adaos')?.value)||0;

  newOrderProducts.forEach((p,i)=>{
    const adaos = p.adaos!=null?p.adaos:adaosGlobal;
    const vanz  = p.pret_achizitie*(1+adaos/100);
    const tr    = document.createElement('tr');
    tr.innerHTML=`
      <td><input value="${escHtml(p.cod_aftermarket)}" placeholder="Cod" data-idx="${i}" data-f="cod_aftermarket" style="width:100px"/></td>
      <td><input value="${escHtml(p.descriere)}"      placeholder="Descriere" data-idx="${i}" data-f="descriere" style="min-width:130px"/></td>
      <td><input type="number" value="${p.pret_achizitie}" data-idx="${i}" data-f="pret_achizitie" style="width:75px"/></td>
      <td><input type="number" value="${adaos}" data-idx="${i}" data-f="adaos" style="width:60px"/></td>
      <td class="no-vanz-${i}" style="color:var(--blue);font-weight:600;white-space:nowrap">${vanz.toFixed(2)}</td>
      <td><input type="number" value="${p.cantitate||1}" data-idx="${i}" data-f="cantitate" min="1" style="width:50px"/></td>
      <td><button class="icon-btn" style="color:var(--red)" onclick="removeNewOrderProduct(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input[data-f]').forEach(el=>{
    el.addEventListener('input', e=>{
      const idx=+e.target.dataset.idx, f=e.target.dataset.f;
      const val = e.target.type==='number' ? parseFloat(e.target.value)||0 : e.target.value;
      if(f==='adaos') newOrderProducts[idx].adaos=val;
      else newOrderProducts[idx][f]=val;
      // recalc vanzare display
      const p2=newOrderProducts[idx];
      const a2=p2.adaos??0;
      const vanz2=p2.pret_achizitie*(1+a2/100);
      tbody.querySelector(`.no-vanz-${idx}`).textContent=vanz2.toFixed(2);
      updateNewOrderTotal();
    });
  });
  updateNewOrderTotal();
}

function removeNewOrderProduct(idx) {
  newOrderProducts.splice(idx,1);
  renderNewOrderProducts();
}

function updateNewOrderTotal() {
  const total = newOrderProducts.reduce((s,p)=>{
    const a=(p.adaos!=null?p.adaos:parseFloat(document.getElementById('no-adaos')?.value)||0);
    return s+p.pret_achizitie*(1+a/100)*p.cantitate;
  },0);
  const el=document.getElementById('no-total');
  if(el) el.textContent=total.toFixed(2);
}

async function saveOrder() {
  if(editOrderId) { await editOrder(); return; }
  const clientId = document.getElementById('no-client')?.value;
  if(!clientId) { toast('Selectează un client!','warn'); return; }
  if(!newOrderProducts.length||!newOrderProducts[0].cod_aftermarket) { toast('Adaugă cel puțin un produs!','warn'); return; }

  const adaosGlobal = parseFloat(document.getElementById('no-adaos').value)||0;
  const totalVanz   = newOrderProducts.reduce((s,p)=>{
    const a=(p.adaos!=null?p.adaos:adaosGlobal);
    return s+p.pret_achizitie*(1+a/100)*p.cantitate;
  },0);
  const avans = parseFloat(document.getElementById('no-avans').value)||0;

  try {
    // Agent = prenumele userului curent din dashboard
    const agentName = window._currentAgentFirstName || currentUserEmail?.split('@')[0] || null;

    const [comanda] = await api('comenzi', { method:'POST', body:JSON.stringify({
      client_id:     clientId,
      tip_plata:     document.getElementById('no-tip-plata').value,
      total_plata:   parseFloat(totalVanz.toFixed(2)),
      avans_achitat: avans,
      adaos_procent: adaosGlobal,
      furnizor:      document.getElementById('no-furnizor').value||null,
      note_comanda:  document.getElementById('no-note').value||null,
      agent_vanzari: agentName,
    })});

    const produse = newOrderProducts.filter(p=>p.cod_aftermarket).map(p=>{
      const a=(p.adaos!=null?p.adaos:adaosGlobal);
      return {
        comanda_id:      comanda.id,
        cod_aftermarket: p.cod_aftermarket,
        descriere:       p.descriere,
        pret_achizitie:  p.pret_achizitie,
        pret_vanzare:    parseFloat((p.pret_achizitie*(1+a/100)).toFixed(2)),
        cantitate:       p.cantitate||1,
      };
    });
    await api('produse_comandate',{method:'POST',body:JSON.stringify(produse)});

    toast(`✅ Comanda ${fmtNr(comanda.nr_comanda)} creată!`,'success');
    closeModal('modal-order');
    await loadOrders();
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function refreshOrderTotal(orderId) {
  try {
    // Fetch total recalculat din DB (după ce triggerul sync_total a rulat)
    const rows = await api(`comenzi?id=eq.${orderId}&select=total_plata,avans_achitat,rest_de_plata,tip_plata`);
    if(!rows?.length) return;
    const fresh = rows[0];

    // Actualizează în allOrders
    const o = allOrders.find(x=>x.id===orderId);
    if(o) {
      o.total_plata   = fresh.total_plata;
      o.avans_achitat = fresh.avans_achitat;
      o.rest_de_plata = fresh.rest_de_plata;
      o.tip_plata     = fresh.tip_plata;
    }

    // Actualizează celulele din rândul tabelului
    // Nr=0, CodUnic=1, Data=2, Client=3, Furnizor=4, Produse=5, Total=6, Avans=7, Rest=8
    const row = document.querySelector(`select.status-sel[data-id="${orderId}"]`)?.closest('tr');
    if(row && o) {
      const cells = row.querySelectorAll('td');
      if(cells[6]) cells[6].textContent = fmtRON(o.total_plata);
      if(cells[7]) cells[7].textContent = fmtRON(o.avans_achitat);
      if(cells[8]) {
        const rest = calcRest(o);
        cells[8].textContent = fmtRON(rest);
        cells[8].style.color = rest > 0 ? 'var(--yellow)' : 'var(--green)';
        cells[8].style.fontWeight = '700';
      }
      // Actualizează indicatorul
      const indicatorCell = row.querySelector('.order-indicator-cell');
      if(indicatorCell) indicatorCell.innerHTML = orderIndicator(o);
    }

    // Actualizează și totalul din detail panel dacă e deschis
    updateDetailTotals();
    renderStats(allOrders);
  } catch(e) { console.warn('refreshOrderTotal:', e.message); }
}

async function refreshOrderRowCount(orderId) {
  try {
    // Fetch doar produsele acestei comenzi pentru a recalcula contoarele
    const prods = await api(`produse_comandate?comanda_id=eq.${orderId}&select=status_produs`);
    const total    = prods.length;
    const ajunse   = prods.filter(p=>p.status_produs==='ajuns').length;
    const predate  = prods.filter(p=>p.status_produs==='predat').length;
    const arrived  = ajunse + predate;

    // Actualizează local în allOrders
    const o = allOrders.find(x=>x.id===orderId);
    if(o) {
      o.produse_ajunse   = ajunse;
      o.produse_predate  = predate;
      o.produse_in_asteptare = prods.filter(p=>p.status_produs==='comandat').length;
    }

    // Actualizează celula din tabel fără re-render
    const row = document.querySelector(`#orders-body tr [data-id="${orderId}"]`)?.closest('tr');
    if(row && o) {
      const arrivedColor = arrived===total&&total>0 ? 'var(--green)' : arrived>0 ? 'var(--yellow)' : 'var(--muted)';
      const arrivedCell  = row.querySelector('.arrived-badge');
      if(arrivedCell) {
        arrivedCell.textContent  = `${arrived}/${total} ajunse`;
        arrivedCell.style.color  = arrivedColor;
      }
      // Actualizează și indicatorul
      const indicatorCell = row.querySelector('.order-indicator-cell');
      if(indicatorCell) indicatorCell.innerHTML = orderIndicator(o);
    }
  } catch(e) { console.warn('refreshOrderRowCount:', e.message); }
}

function refreshPdfSection(o) {
  const has = !!o?.factura_url;
  document.getElementById('pdf-no-file').style.display = has?'none':'block';
  document.getElementById('pdf-has-file').style.display = has?'block':'none';
  if(has) document.getElementById('pdf-filename').textContent = o.factura_nume||'factură.pdf';
}

async function handlePdfUpload(event) {
  const file = event.target.files[0];
  if(!file||!currentOrderId) return;
  if(file.type!=='application/pdf') { toast('Selectează un fișier PDF!','warn'); return; }
  toast('⏳ Se încarcă...','info');
  try {
    let url;
    try { url = await storageUpload('facturi',`${currentOrderId}/${Date.now()}_${file.name}`,file); }
    catch { url = URL.createObjectURL(file); }
    await api(`comenzi?id=eq.${currentOrderId}`,{method:'PATCH',body:JSON.stringify({factura_url:url,factura_nume:file.name})});
    const o=allOrders.find(x=>x.id===currentOrderId);
    if(o){ o.factura_url=url; o.factura_nume=file.name; refreshPdfSection(o); renderOrdersTable(applyOrderFilters(allOrders)); }
    toast('✅ Factură încărcată! Apasă Preview pentru a o vedea.','success');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

function togglePdfPreview() {
  const w=document.getElementById('pdf-preview-wrap');
  const fr=document.getElementById('pdf-iframe');
  if(w.style.display==='none'){
    const o=allOrders.find(x=>x.id===currentOrderId);
    if(o?.factura_url){
      // file:// URLs can't load in iframe - open in new tab instead
      if(o.factura_url.startsWith('file://') || o.factura_url.startsWith('blob:')) {
        window.open(o.factura_url, '_blank');
        toast('PDF deschis în tab nou (fișier local).','info');
      } else {
        fr.src=o.factura_url;
        w.style.display='block';
      }
    }
  } else { w.style.display='none'; fr.src=''; }
}

async function removePdf() {
  if(!currentOrderId||!confirm('Elimini factura?')) return;
  try {
    await api(`comenzi?id=eq.${currentOrderId}`,{method:'PATCH',body:JSON.stringify({factura_url:null,factura_nume:null})});
    const o=allOrders.find(x=>x.id===currentOrderId);
    if(o){ o.factura_url=null; o.factura_nume=null; refreshPdfSection(o); renderOrdersTable(applyOrderFilters(allOrders)); }
    document.getElementById('pdf-preview-wrap').style.display='none';
    toast('Factură eliminată.','info');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function copyOrderWhatsApp(comandaId, order) {
  try {
    const prods = await api(`produse_comandate?comanda_id=eq.${comandaId}&select=*&order=data_comanda.asc`);

    const client   = order.client_nume || '—';
    const codUnic  = order.cod_comanda_unic || fmtNr(order.nr_comanda);
    const data     = new Date(order.data_creare).toLocaleDateString('ro-RO');
    const total    = prods.reduce((s,p)=>(+p.pret_vanzare||0)*(+p.cantitate||1)+s, 0);
    const rest     = calcRest(order);

    let lines = [];
    lines.push(`*${client}*`);
    lines.push(`📦 Comandă: *${codUnic}* · ${data}`);
    lines.push('');

    prods.forEach((p, i) => {
      const sku   = p.sku ? `[${p.sku}] ` : '';
      const cant  = p.cantitate > 1 ? `x${p.cantitate} ` : '';
      const pret  = (+p.pret_vanzare||0) * (+p.cantitate||1);
      const status = p.status_produs === 'predat' ? '✅' : p.status_produs === 'ajuns' ? '🏠' : '📦';
      lines.push(`${i+1}. ${status} ${sku}${p.cod_aftermarket} — ${cant}*${pret.toFixed(2)} RON*`);
    });

    lines.push('');
    lines.push(`💰 *Total: ${total.toFixed(2)} RON*`);

    if(rest > 0) {
      lines.push(`⏳ Avans achitat: ${fmtRON(order.avans_achitat)} RON`);
      lines.push(`🔴 *Rest de plată: ${fmtRON(rest)} RON*`);
    } else {
      lines.push(`✅ *Achitat integral*`);
    }

    const text = lines.join('\n');
    await navigator.clipboard.writeText(text);
    toast('✅ Copiat pentru WhatsApp!', 'success');
  } catch(e) {
    toast('Eroare copiere: ' + e.message, 'error');
  }
}

async function checkAndMarkAchitat(orderId) {
  const freshRows = await api(`comenzi?id=eq.${orderId}&select=total_plata,avans_achitat,tip_plata`);
  if(!freshRows?.length) return;
  const o = freshRows[0];
  const rest = Math.max(0, (+o.total_plata||0) - (+o.avans_achitat||0));
  if(rest <= 0 && o.tip_plata !== 'achitat_integral') {
    await api(`comenzi?id=eq.${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ tip_plata: 'achitat_integral' })
    });
    // Update local
    const local = allOrders.find(x=>x.id===orderId);
    if(local) local.tip_plata = 'achitat_integral';
    toast('✅ Comandă marcată automat ca achitată integral!','success');
  }
}

function openAddProductToOrder(comandaId, codUnic) {
  _atoComandaId = comandaId;
  _atoCodUnic   = codUnic;

  const order = allOrders.find(o=>o.id===comandaId);
  _atoNrProduse = +(order?.nr_produse||0);

  // Reset fields
  ['ato-cod','ato-desc','ato-ref-manual'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('ato-pret').value  = '0';
  document.getElementById('ato-adaos').value = order?.adaos_procent||'0';
  document.getElementById('ato-vanz').value  = '0';
  document.getElementById('ato-cant').value  = '1';
  document.getElementById('ato-status').value = 'comandat';

  // Afișează codul comenzii
  document.getElementById('ato-comanda-label').textContent =
    `Comandă: ${codUnic} — ${order?.client_nume||''}`;

  // Preview REF Intern
  atoUpdateRefIntern();
  openModal('modal-add-to-order');
}

function atoUpdateRefIntern() {
  const nextPos = _atoNrProduse + 1;
  const preview = `${_atoCodUnic||'CMD'}-${nextPos}`;
  document.getElementById('ato-ref').value = preview;
}

function atoRecalc() {
  const pret  = parseFloat(document.getElementById('ato-pret').value)||0;
  const adaos = parseFloat(document.getElementById('ato-adaos').value)||0;
  document.getElementById('ato-vanz').value = (pret*(1+adaos/100)).toFixed(2);
}

async function saveAddToOrder() {
  const cod = document.getElementById('ato-cod').value.trim();
  if(!cod) { toast('Codul aftermarket este obligatoriu!','warn'); return; }
  if(!_atoComandaId) { toast('Eroare: nicio comandă selectată!','error'); return; }

  const refManual = document.getElementById('ato-ref-manual').value.trim();

  const body = {
    comanda_id:      _atoComandaId,
    cod_aftermarket: cod,
    descriere:       document.getElementById('ato-desc').value,
    pret_achizitie:  parseFloat(document.getElementById('ato-pret').value)||0,
    pret_vanzare:    parseFloat(document.getElementById('ato-vanz').value)||0,
    cantitate:       parseInt(document.getElementById('ato-cant').value)||1,
    status_produs:   document.getElementById('ato-status').value,
    // ref_intern se generează automat prin trigger SQL
    // dacă e introdus manual, îl setăm explicit
    ...(refManual ? { ref_intern: refManual } : {}),
  };

  try {
    await api('produse_comandate', { method:'POST', body:JSON.stringify(body) });
    await logAction('CREATE','produs',_atoComandaId,{cod,comanda:_atoCodUnic});
    toast(`✅ Produs ${cod} adăugat la ${_atoCodUnic}!`,'success');
    closeModal('modal-add-to-order');
    // Reîncarcă produsele din detail panel
    await loadDetailProducts(_atoComandaId);
    await loadOrders();
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

function openAddPlata(orderId, event) {
  if(event) event.stopPropagation();
  _plataComandaId = orderId;
  const o = allOrders.find(x=>x.id===orderId);
  if(!o) return;

  const rest = calcRest(o);
  document.getElementById('plata-comanda-label').textContent =
    `${fmtNr(o.nr_comanda)} — ${o.client_nume}`;
  document.getElementById('plata-total').textContent   = fmtRON(o.total_plata) + ' RON';
  document.getElementById('plata-achitat').textContent = fmtRON(o.avans_achitat) + ' RON';
  document.getElementById('plata-rest').textContent    = fmtRON(rest) + ' RON';
  document.getElementById('plata-suma').value  = '';
  document.getElementById('plata-nota').value  = '';
  document.getElementById('plata-metoda').value = 'cash';
  openModal('modal-plata');
}

function setPlataRest() {
  const o = allOrders.find(x=>x.id===_plataComandaId);
  if(o) document.getElementById('plata-suma').value = fmtRON(calcRest(o));
}

function setPlataTota() {
  const o = allOrders.find(x=>x.id===_plataComandaId);
  if(o) document.getElementById('plata-suma').value = fmtRON(o.total_plata);
}

async function saveNewPlata() {
  const suma = parseFloat(document.getElementById('plata-suma').value)||0;
  if(!suma || suma <= 0) { toast('Introdu o sumă validă!','warn'); return; }

  const body = {
    comanda_id: _plataComandaId,
    suma,
    metoda:    document.getElementById('plata-metoda').value,
    nota:      document.getElementById('plata-nota').value || null,
    user_email: currentUserEmail || null,
  };

  try {
    await api('plati', { method:'POST', body:JSON.stringify(body) });
    await logAction('CREATE','plata',_plataComandaId,{ suma, metoda: body.metoda });
    toast(`✅ Plată de ${fmtRON(suma)} RON înregistrată!`,'success');
    closeModal('modal-plata');
    // Refresh order row
    await refreshOrderTotal(_plataComandaId);
    if(currentOrderId === _plataComandaId) await loadPlati(_plataComandaId);
    // Auto-update tip_plata if fully paid
    await checkAndMarkAchitat(_plataComandaId);
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function loadPlati(orderId) {
  const tbody  = document.getElementById('plati-body');
  const sumDiv = document.getElementById('plati-summary');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><span class="spinner"></span></td></tr>';

  try {
    const plati = await api(`plati?comanda_id=eq.${orderId}&select=*&order=creat_la.asc`);
    tbody.innerHTML = '';

    if(!plati.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nicio plată înregistrată.</td></tr>';
    } else {
      plati.forEach((p,i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-size:12px;white-space:nowrap">${new Date(p.creat_la).toLocaleString('ro-RO')}</td>
          <td class="fw-bold text-green">${fmtRON(p.suma)} RON</td>
          <td><span class="badge ${p.metoda==='cash'?'b-ajuns':'b-in_lucru'}">${p.metoda==='cash'?'💵 Cash':'💳 Card'}</span></td>
          <td style="font-size:12px;color:var(--muted)">${p.nota||'—'}</td>
          <td style="font-size:11px;color:var(--muted)">${p.user_email||'—'}</td>
          <td><button class="icon-btn" style="color:var(--red)" onclick="deletePlata('${p.id}','${orderId}')">🗑</button></td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Summary
    const totalPlati = plati.reduce((s,p)=>s+(+p.suma||0),0);
    const o = allOrders.find(x=>x.id===orderId);
    const rest = o ? calcRest(o) : 0;
    const pct  = o && +o.total_plata > 0 ? Math.min(100, (totalPlati / +o.total_plata)*100) : 0;

    if(sumDiv) sumDiv.innerHTML = `
      <div style="flex:1;min-width:200px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px">
          <span style="color:var(--muted)">Achitat: <strong style="color:var(--green)">${fmtRON(totalPlati)} RON</strong></span>
          <span style="color:var(--muted)">Rest: <strong style="color:${rest>0?'var(--red)':'var(--green)'}">${fmtRON(rest)} RON</strong></span>
          <span style="color:var(--accent);font-weight:700">${pct.toFixed(0)}%</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${pct}%;background:${pct>=100?'var(--green)':'linear-gradient(90deg,var(--accent),var(--green))'}"></div>
        </div>
      </div>
    `;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:12px">Eroare: ${e.message}</td></tr>`;
  }
}

async function deletePlata(plataId, orderId) {
  if(!confirm('Ștergi această plată?')) return;
  try {
    await api(`plati?id=eq.${plataId}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
    await logAction('DELETE','plata',plataId,{comanda:orderId});
    toast('Plată ștearsă.','info');
    await loadPlati(orderId);
    await refreshOrderTotal(orderId);
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

function renderPctBar(pct) {
  const color = pct >= 100 ? 'var(--green)' : pct > 0 ? 'var(--accent)' : 'var(--red)';
  return `<div style="display:flex;align-items:center;gap:8px">
    <div class="progress-bar-wrap" style="flex:1">
      <div class="progress-bar-fill" style="width:${pct.toFixed(0)}%;background:${color}"></div>
    </div>
    <span style="font-size:11px;font-weight:700;color:${color};white-space:nowrap">${pct.toFixed(0)}%</span>
  </div>`;
}

function calcFacturaAchitatPct(factura) {
  // Găsim comenzile asociate acestei facturi din allOrders
  const comenziIds = [...factura.comenzi]; // Array de cod_comanda_unic
  const comenziMatch = allOrders.filter(o =>
    comenziIds.includes(o.cod_comanda_unic) || comenziIds.includes(o.id)
  );
  if(!comenziMatch.length) return 0;
  const totalVanz  = comenziMatch.reduce((s,o)=>s+(+o.total_plata||0),0);
  const totalAchitat = comenziMatch.reduce((s,o)=>s+(+o.avans_achitat||0),0);
  return totalVanz > 0 ? Math.min(100, (totalAchitat/totalVanz)*100) : 0;
}

function openRetur(prodId, cod, descriere) {
  _returProdId = prodId;
  document.getElementById('retur-produs-info').textContent = `${cod} — ${descriere}`;
  document.getElementById('retur-nota').value = '';
  document.getElementById('retur-motiv').value = 'nu_se_potriveste';
  openModal('modal-retur');
}

async function saveRetur() {
  if(!_returProdId) return;
  const motiv = document.getElementById('retur-motiv').value;
  const nota  = document.getElementById('retur-nota').value;

  try {
    await api(`produse_comandate?id=eq.${_returProdId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status_produs: 'returnat',
        motiv_retur:   motiv,
        note_produs:   nota || null,
      })
    });
    await logAction('UPDATE','produs',_returProdId,{ status:'returnat', motiv });
    toast('↩️ Produs marcat ca returnat.','info');
    closeModal('modal-retur');
    await loadPredare();
    await loadOrders();
    updateBadgeRetururi();
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}



async function updateOrderStatusFromDetail(sel) {
  const status = sel.value;
  if(!currentOrderId) return;
  await setOrderStatus(currentOrderId, status);
  const o = allOrders.find(x=>x.id===currentOrderId);
  if(o) o.status_general = status;
  renderOrdersTable(applyOrderFilters(allOrders));
  renderStats(allOrders);
}

async function setOrderStatus(id, status) {
  try {
    await api(`comenzi?id=eq.${id}`, { method:'PATCH', body:JSON.stringify({ status_general: status }) });
    if(status === 'finalizata') {
      await api(`produse_comandate?comanda_id=eq.${id}&status_produs=in.(comandat,ajuns)`, {
        method: 'PATCH',
        body: JSON.stringify({ status_produs: 'predat', data_predare: new Date().toISOString() })
      });
      toast('Comandă finalizată — produsele marcate predate.', 'success');
    }
    const o = allOrders.find(x=>x.id===id);
    if(o) o.status_general = status;
    renderOrdersTable(applyOrderFilters(allOrders));
    renderStats(allOrders);
    logAction('UPDATE', 'comenzi', id, { status_general: status });
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

