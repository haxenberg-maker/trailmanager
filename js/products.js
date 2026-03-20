// products.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function searchProducts() {
  const cod     = document.getElementById('search-prod-cod').value.trim();
  const factura = document.getElementById('search-prod-factura').value.trim();
  const sku     = document.getElementById('search-prod-sku').value.trim();
  const desc    = document.getElementById('search-prod-desc').value.trim();
  if(!cod&&!factura&&!sku&&!desc){ toast('Introdu cel puțin un termen de căutare.','warn'); return; }

  const filters=[];
  if(cod)     filters.push(`cod_aftermarket=ilike.*${encodeURIComponent(cod)}*`);
  if(factura) filters.push(`cod_factura_furnizor=ilike.*${encodeURIComponent(factura)}*`);
  if(sku)     filters.push(`sku=ilike.*${encodeURIComponent(sku)}*`);
  if(desc)    filters.push(`descriere=ilike.*${encodeURIComponent(desc)}*`);

  let extraQuery = '';
  if(filters.length===1) extraQuery=`&${filters[0]}`;
  else if(filters.length>1) extraQuery=`&or=(${filters.join(',')})`;

  await fetchAndRenderProducts(extraQuery);
}

async function loadAllProducts() {
  await fetchAndRenderProducts('&order=data_comanda.desc&limit=200');
}

async function fetchAndRenderProducts(extraQuery='') {
  document.getElementById('search-loading').style.display='block';
  document.getElementById('search-body').innerHTML='';

  try {
    // Fetch products
    const prods = await api(`produse_comandate?select=*&limit=200&order=data_comanda.desc${extraQuery}`);
    document.getElementById('search-loading').style.display='none';
    const tbody=document.getElementById('search-body');
    tbody.innerHTML='';

    if(!prods.length){
      tbody.innerHTML='<tr><td colspan="13" class="empty-state">Niciun produs găsit.</td></tr>';
      return;
    }

    // Fetch orders for context (already in memory mostly)
    const orderIds=[...new Set(prods.map(p=>p.comanda_id).filter(Boolean))];
    const ordersMap={};
    allOrders.forEach(o=>{ ordersMap[o.id]=o; });
    // For any missing orders, fetch
    const missing=orderIds.filter(id=>!ordersMap[id]);
    if(missing.length){
      const extra=await api(`dashboard_comenzi?id=in.(${missing.join(',')})&select=*`);
      extra.forEach(o=>{ ordersMap[o.id]=o; });
    }

    prods.forEach(p=>{
      const ord = ordersMap[p.comanda_id]||{};
      const adaos = (p.adaos_procent!=null)?p.adaos_procent:(ord.adaos_procent||0);
      const codUnicCmd = ord.cod_comanda_unic || fmtNr(ord.nr_comanda) || '—';
      const tr=document.createElement('tr');
      tr.dataset.prodId=p.id;
      tr.innerHTML=`
        <td><span class="font-mono fw-bold" style="font-size:11px;color:var(--yellow);white-space:nowrap">${escHtml(codUnicCmd)}</span></td>
        <td class="text-yellow fw-bold font-mono" style="white-space:nowrap">${escHtml(p.cod_aftermarket)}</td>
        <td class="ie-cell" data-field="descriere" data-id="${p.id}" data-val="${escHtml(p.descriere||'')}">${escHtml(p.descriere||'—')}</td>
        <td class="ie-cell ${!p.sku?'sku-empty-cell':''}" data-field="sku" data-id="${p.id}" data-val="${escHtml(p.sku||'')}">${p.sku ? escHtml(p.sku) : '<span style="color:var(--red);font-size:11px">⚠ SKU lipsă</span>'}</td>
        <td class="ie-cell" data-field="cod_factura_furnizor" data-id="${p.id}" data-val="${escHtml(p.cod_factura_furnizor||'')}">${escHtml(p.cod_factura_furnizor||'—')}</td>
        <td class="ie-cell" data-field="pret_achizitie" data-id="${p.id}" data-val="${p.pret_achizitie||0}" data-type="number">${fmtRON(p.pret_achizitie)}</td>
        <td class="ie-cell" data-field="adaos_calc" data-id="${p.id}" data-val="${adaos}" data-type="number">${adaos}%</td>
        <td class="ie-cell" data-field="pret_vanzare" data-id="${p.id}" data-val="${p.pret_vanzare||0}" data-type="number">${fmtRON(p.pret_vanzare)}</td>
        <td style="text-align:center">${p.cantitate||1}</td>
        <td><span class="badge b-${p.status_produs}">${p.status_produs}</span></td>
        <td><span class="nr-cmd" style="cursor:pointer" onclick="jumpToOrder('${ord.id||''}','')">${fmtNr(ord.nr_comanda)}</span></td>
        <td style="font-size:12px;font-weight:600">${escHtml(ord.client_nume||'—')}</td>

      `;
      tbody.appendChild(tr);
    });
    attachAutosave(tbody, 'search');
    highlightEmptySku(tbody);
    initInlineEditing(tbody);
  } catch(e){
    document.getElementById('search-loading').style.display='none';
    toast('Eroare: '+e.message,'error');
    console.error(e);
  }
}

function highlightEmptySku(container) {
  container.querySelectorAll('.sku-input, [data-f="sku"]').forEach(el => {
    el.addEventListener('input', () => {
      el.classList.toggle('sku-empty', !el.value.trim());
    });
    el.classList.toggle('sku-empty', !el.value.trim());
  });
}

function recalcSearchRow(input) {
  const row = input.closest('tr');
  const acq   = parseFloat(row.querySelector('[data-sf="pret_achizitie"]').value)||0;
  const adaos = parseFloat(row.querySelector('.adaos-calc').value)||0;
  row.querySelector('[data-sf="pret_vanzare"]').value = (acq*(1+adaos/100)).toFixed(2);
}

async function saveSearchProduct(prodId, row) {
  const patch={};
  row.querySelectorAll('[data-sf]').forEach(el=>{
    patch[el.dataset.sf] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
  });
  try {
    await api(`produse_comandate?id=eq.${prodId}`,{method:'PATCH',body:JSON.stringify(patch)});
    toast('Produs salvat ✓','success');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function jumpToOrder(id, nr) {
  if(!id) return;
  navigate('comenzi');
  const o=allOrders.find(x=>x.id===id);
  if(o){ setTimeout(()=>loadDetail(id,o),200); }
  else {
    await loadOrders();
    const o2=allOrders.find(x=>x.id===id);
    if(o2) setTimeout(()=>loadDetail(id,o2),300);
  }
}

function attachAutosave(container, saveMode) {
  // saveMode: 'product' uses data-f, 'search' uses data-sf
  const attr = saveMode==='search' ? '[data-sf]' : '[data-f]';
  container.querySelectorAll(`input${attr}, select${attr}`).forEach(el=>{
    el.addEventListener('change', ()=>{
      const row = el.closest('tr');
      if(!row) return;
      const id = row.dataset.id || row.dataset.prodId;
      if(!id) return;
      clearTimeout(autosaveTimers[id]);
      autosaveTimers[id] = setTimeout(()=>{
        if(saveMode==='search') {
          saveSearchProductSilent(id, row);
        } else {
          saveProductSilent(id, row);
        }
      }, 800);
    });
  });
}

async function saveProductSilent(prodId, row) {
  const patch={};
  row.querySelectorAll('[data-f]').forEach(el=>{
    const f=el.dataset.f;
    if(f==='status_produs') return;
    patch[f] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
  });
  // Salvează și adaosul din .adaos-calc
  const adaosEl = row.querySelector('.adaos-calc');
  if(adaosEl) patch.adaos_procent = parseFloat(adaosEl.value)||0;
  try {
    await api(`produse_comandate?id=eq.${prodId}`,{method:'PATCH',body:JSON.stringify(patch)});
    logAction('UPDATE', 'produs', prodId, patch);
    row.classList.add('saved-flash');
    setTimeout(()=>row.classList.remove('saved-flash'),600);
    showAutosaveStatus('Salvat automat ✓');
  } catch(e){ toast('Autosave eroare: '+e.message,'error'); }
}

async function saveSearchProductSilent(prodId, row) {
  const patch={};
  row.querySelectorAll('[data-sf]').forEach(el=>{
    patch[el.dataset.sf] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
  });
  try {
    await api(`produse_comandate?id=eq.${prodId}`,{method:'PATCH',body:JSON.stringify(patch)});
    logAction('UPDATE', 'produs', prodId, patch);
    row.classList.add('saved-flash');
    setTimeout(()=>row.classList.remove('saved-flash'),600);
    showAutosaveStatus('Salvat automat ✓');
  } catch(e){ toast('Autosave eroare: '+e.message,'error'); }
}

async function openAddProduct() {
  // Populează comenzi
  const sel = document.getElementById('ap-comanda');
  sel.innerHTML = '<option value="">— selectează comanda —</option>';
  allOrders
    .filter(o=>o.status_general==='in_lucru')
    .forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.dataset.nr = o.nr_comanda;
      opt.dataset.furnizor = o.furnizor||'';
      opt.textContent = `${fmtNr(o.nr_comanda)} — ${o.client_nume}`;
      sel.appendChild(opt);
    });

  // Reset fields
  ['ap-cod','ap-desc','ap-sku'].forEach(id => document.getElementById(id).value='');
  document.getElementById('ap-pret').value  = '0';
  document.getElementById('ap-adaos').value = '0';
  document.getElementById('ap-vanz').value  = '0';
  document.getElementById('ap-cant').value  = '1';
  document.getElementById('ap-status').value = 'comandat';

  sel.addEventListener('change', previewApSku);
  document.getElementById('ap-cod').addEventListener('input', previewApSku);

  openModal('modal-add-product');
}

function previewApSku() {
  const selEl   = document.getElementById('ap-comanda');
  const selOpt  = selEl.options[selEl.selectedIndex];
  const furnizor = selOpt?.dataset?.furnizor || '';
  const nr       = selOpt?.dataset?.nr || '0';
  const prefix   = furnizor.substring(0,3).toUpperCase() || 'GEN';
  const nrPad    = String(nr).padStart(4,'0');
  // Count existing products for this order
  const orderId  = selEl.value;
  const existing = allOrders.find(o=>o.id===orderId);
  const nextIdx  = (existing?.nr_produse||0)+1;
  if(orderId) {
    document.getElementById('ap-sku').value = `${prefix}-${nrPad}-${nextIdx}`;
  }
}

function apRecalc() {
  const pret  = parseFloat(document.getElementById('ap-pret').value)||0;
  const adaos = parseFloat(document.getElementById('ap-adaos').value)||0;
  document.getElementById('ap-vanz').value = (pret*(1+adaos/100)).toFixed(2);
}

async function saveAddProduct() {
  const comandaId = document.getElementById('ap-comanda').value;
  const cod       = document.getElementById('ap-cod').value.trim();
  if(!comandaId) { toast('Selectează o comandă!','warn'); return; }
  if(!cod)       { toast('Codul aftermarket este obligatoriu!','warn'); return; }

  const body = {
    comanda_id:      comandaId,
    cod_aftermarket: cod,
    descriere:       document.getElementById('ap-desc').value,
    pret_achizitie:  parseFloat(document.getElementById('ap-pret').value)||0,
    pret_vanzare:    parseFloat(document.getElementById('ap-vanz').value)||0,
    cantitate:       parseInt(document.getElementById('ap-cant').value)||1,
    status_produs:   document.getElementById('ap-status').value,
    // SKU se generează automat prin trigger SQL
  };

  try {
    await api('produse_comandate', { method:'POST', body:JSON.stringify(body) });
    toast('✅ Produs adăugat! SKU generat automat.','success');
    closeModal('modal-add-product');
    await loadOrders();
    loadAllProducts();
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

