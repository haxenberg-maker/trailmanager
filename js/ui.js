// ui.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),10);
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),300); },3600);
}

function closeModal(id) { document.getElementById(id).classList.remove('open') }

function openModal(id)  { document.getElementById(id).classList.add('open') }

function switchTab(btn, tabId) {
  if(tabId === 'tab-plati' && currentOrderId) loadPlati(currentOrderId);

  // Deactivate all tabs in same tabs bar
  btn.parentElement.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');

  // Find container — suportă detail-modal, detail-panel, client-detail
  const container = btn.closest('#detail-modal,#detail-panel,#client-detail');
  if(container) {
    container.querySelectorAll('.tab-body').forEach(b=>b.classList.remove('active'));
    const target = container.querySelector(`#${tabId}`);
    if(target) target.classList.add('active');
  }
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');
  if (page==='comenzi' && allOrders.length===0) loadOrders();
  if (page==='clienti') loadClients();
  if (page==='produse') loadAllProducts();
  if (page==='loguri')   loadLogs();
  if (page==='utilizatori') loadUsers();
  if (page==='facturi') { loadFacturi(); showFacturiTab('pdf-list'); }
  if (page==='predare')  loadPredare();
  if (page==='retururi') loadRetururi();
}

function orderIndicator(o) {
  const totalProd   = +o.nr_produse    || 0;
  const predate     = +o.produse_predate || 0;
  const rest        = calcRest(o);
  const achitat     = isAchitat(o);
  const toatePredate = predate === totalProd && totalProd > 0;

  // ✅ Totul predat + achitat = verde complet
  if(toatePredate && achitat)
    return '<span title="Predat & Achitat" style="font-size:15px;margin-right:4px">✅</span>';

  // ⚠️ Predat dar neachitat = datorie
  if(toatePredate && !achitat)
    return `<span title="Predat dar rest ${(+rest).toFixed(2)} RON neachitat!" style="font-size:15px;margin-right:4px;animation:pulse 1.5s infinite">⚠️</span>`;

  // 💰 Achitat dar nu toate predate
  if(achitat && !toatePredate)
    return '<span title="Achitat, produse în curs" style="font-size:15px;margin-right:4px">💰</span>';

  // Default — nimic
  return '';
}

function computeOrderStatus(o) {
  const total    = +o.nr_produse    || 0;
  const cmd      = +o.produse_in_asteptare || 0;
  const ajunse   = +o.produse_ajunse  || 0;
  const predate  = +o.produse_predate  || 0;
  const returnate= +o.produse_returnate|| 0;
  const active   = total - returnate; // excludem returnatele
  const achitat  = isAchitat(o);
  const rest     = calcRest(o);

  if(active === 0) return { label:'—', color:'var(--muted)', icon:'' };

  const toateAjunse  = (ajunse + predate) >= active && active > 0;
  const toatePredate = predate >= active && active > 0;

  if(toatePredate && achitat)
    return { label:'Finalizată', color:'var(--green)',  icon:'✅' };
  if(toatePredate && rest > 0)
    return { label:'Neachitată', color:'var(--red)',    icon:'⚠️' };
  if(toateAjunse)
    return { label:'Ajunse',     color:'var(--accent)', icon:'🏠' };
  if(ajunse > 0 && cmd > 0)
    return { label:`Ajunse ${ajunse}/${active}`, color:'var(--yellow)', icon:'🏠' };
  if(ajunse === 0 && predate === 0)
    return { label:'Comandat',   color:'var(--muted)',  icon:'📦' };
  return { label:'În lucru',    color:'var(--blue)',   icon:'🔄' };
}

function statusBadge(o) {
  const s = computeOrderStatus(o);
  return `<span style="color:${s.color};font-weight:600;font-size:12px;white-space:nowrap">${s.icon} ${s.label}</span>`;
}

function plataBadge(o) {
  const achitat = isAchitat(o);
  const rest    = calcRest(o);
  const avans   = +o.avans_achitat || 0;

  if(achitat)
    return '<span style="color:var(--green);font-weight:600;font-size:12px">✅ Achitat</span>';
  if(avans === 0)
    return '<span style="color:var(--red);font-weight:600;font-size:12px">⛔ Neachitat</span>';
  return `<span style="color:var(--yellow);font-size:12px">⏳ Avans ${fmtRON(avans)} RON</span>`;
}

function showAutosaveStatus(msg='Salvat automat ✓') {
  const el = document.getElementById('autosave-status');
  if(!el) return;
  el.textContent = msg;
  clearTimeout(el._timer);
  el._timer = setTimeout(()=>{ el.textContent=''; }, 2500);
}

function initInlineEditing(tbody) {
  tbody.querySelectorAll('.ie-cell').forEach(cell => {
    cell.addEventListener('click', () => activateInlineCell(cell));
  });
}

function activateInlineCell(cell) {
  if(cell.classList.contains('editing')) return;

  const field   = cell.dataset.field;
  const prodId  = cell.dataset.id;
  const val     = cell.dataset.val || '';
  const isNum   = cell.dataset.type === 'number';
  const origHTML = cell.innerHTML;

  cell.classList.add('editing');
  cell.innerHTML = `<input class="ie-input" type="${isNum?'number':'text'}" value="${escHtml(val)}" step="${isNum?'0.01':''}"/>`;

  const input = cell.querySelector('.ie-input');
  input.focus();
  input.select();

  const save = async () => {
    const newVal = isNum ? parseFloat(input.value)||0 : input.value.trim();
    cell.classList.remove('editing');
    cell.dataset.val = newVal;

    // Display value
    if(field === 'sku') {
      cell.innerHTML = newVal
        ? escHtml(newVal)
        : '<span style="color:var(--red);font-size:11px">⚠ SKU lipsă</span>';
      cell.classList.toggle('sku-empty-cell', !newVal);
    } else if(field === 'adaos_calc') {
      cell.innerHTML = `${newVal}%`;
      // Recalc pret_vanzare in same row
      const row = cell.closest('tr');
      const acqCell  = row.querySelector('[data-field="pret_achizitie"]');
      const vanzCell = row.querySelector('[data-field="pret_vanzare"]');
      if(acqCell && vanzCell) {
        const acq  = parseFloat(acqCell.dataset.val)||0;
        const vanz = acq*(1+newVal/100);
        vanzCell.dataset.val = vanz.toFixed(2);
        vanzCell.textContent = fmtRON(vanz);
        // Save pret_vanzare too
        await saveInlineField(prodId, 'pret_vanzare', vanz);
      }
      return; // adaos_calc nu e coloană DB
    } else if(field === 'pret_achizitie' || field === 'pret_vanzare') {
      cell.textContent = fmtRON(newVal);
    } else {
      cell.textContent = newVal || '—';
    }

    if(field !== 'adaos_calc') {
      await saveInlineField(prodId, field, newVal);
    }
  };

  const cancel = () => {
    cell.classList.remove('editing');
    cell.innerHTML = origHTML;
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if(e.key === 'Escape') { input.removeEventListener('blur', save); cancel(); }
  });
}

async function saveInlineField(prodId, field, value) {
  try {
    await api(`produse_comandate?id=eq.${prodId}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: value })
    });
    logAction('UPDATE', 'produs', prodId, { [field]: value });
    showAutosaveStatus('Salvat ✓');
  } catch(e) {
    toast('Eroare salvare: '+e.message, 'error');
  }
}

