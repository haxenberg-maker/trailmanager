// clients.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadClients() {
  document.getElementById('clients-loading').style.display='block';
  document.getElementById('clients-table').style.display='none';
  try {
    const data = await api('clienti?select=*&order=nume.asc&limit=500');
    allClients = data;
    renderClientsTable(data);
    document.getElementById('clients-count').textContent=`(${data.length})`;
    document.getElementById('clients-loading').style.display='none';
    document.getElementById('clients-table').style.display='table';
  } catch(e){
    document.getElementById('clients-loading').innerHTML=`<span class="text-red">❌ ${e.message}</span>`;
  }
}

function renderClientsTable(clients) {
  const tbody = document.getElementById('clients-body');
  tbody.innerHTML='';
  if(!clients.length){
    tbody.innerHTML='<tr><td colspan="7" class="empty-state">Niciun client găsit.</td></tr>';
    return;
  }
  clients.forEach(c=>{
    const orders = allOrders.filter(o=>o.client_id===c.id);
    const total  = orders.reduce((s,o)=>s+(+o.total_plata||0),0);
    const tr=document.createElement('tr');
    tr.className='clickable';
    tr.innerHTML=`
      <td class="fw-bold">${escHtml(c.nume)}</td>
      <td>${escHtml(c.telefon||'—')}</td>
      <td class="text-muted" style="font-size:12px">${escHtml(c.email||'—')}</td>
      <td><span class="font-mono text-muted" style="font-size:11px">${escHtml(c.vin||'—')}</span></td>
      <td style="text-align:center;font-weight:600;color:var(--accent)">${c.adaos_implicit!=null?c.adaos_implicit+'%':'—'}</td>
      <td style="text-align:center;font-weight:600;color:var(--blue)">${orders.length}</td>
      <td class="fw-bold text-green">${fmtRON(total)} RON</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        <button class="icon-btn" onclick="openEditClient('${c.id}')">✏️</button>
        <button class="icon-btn" style="color:var(--red)" onclick="event.stopPropagation();deleteClient('${c.id}','${escHtml(c.nume)}',event)">🗑</button>
      </td>
    `;
    tr.addEventListener('click',()=>loadClientDetail(c.id));
    tbody.appendChild(tr);
  });
}

async function loadClientDetail(id) {
  currentClientId=id;
  const c=allClients.find(x=>x.id===id);
  if(!c) return;

  const det=document.getElementById('client-detail');
  det.style.display='block';
  document.getElementById('client-detail-title').textContent=c.nume;

  // Reset tabs
  document.querySelectorAll('#client-detail .tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  document.getElementById('ctab-info').classList.add('active');
  document.getElementById('ctab-istoric').classList.remove('active');

  // Info tab
  document.getElementById('client-info-body').innerHTML=`
    <div class="grid2" style="margin-bottom:14px">
      <div><span class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Telefon</span><div style="font-size:15px;font-weight:600;margin-top:3px">${escHtml(c.telefon||'—')}</div></div>
      <div><span class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Email</span><div style="font-size:15px;font-weight:600;margin-top:3px">${escHtml(c.email||'—')}</div></div>
    </div>
    <div class="grid2" style="margin-bottom:14px">
      <div><span class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">VIN</span><div class="font-mono" style="font-size:14px;font-weight:600;margin-top:3px;color:var(--yellow)">${escHtml(c.vin||'—')}</div></div>
      <div><span class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Adresă</span><div style="font-size:14px;margin-top:3px">${escHtml(c.adresa||'—')}</div></div>
    </div>
    ${c.note?`<div><span class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Note</span><div style="margin-top:4px;font-size:13px">${escHtml(c.note)}</div></div>`:''}
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:10px;font-size:13px">
      <span>📋 <strong>${allOrders.filter(o=>o.client_id===id).length}</strong> comenzi</span>
      <span>💰 Total: <strong class="text-green">${fmtRON(allOrders.filter(o=>o.client_id===id).reduce((s,o)=>s+(+o.total_plata||0),0))} RON</strong></span>
    </div>
  `;

  // Istoric tab
  const cOrders=allOrders.filter(o=>o.client_id===id);
  const tbody=document.getElementById('client-orders-body');
  tbody.innerHTML='';
  if(!cOrders.length){
    tbody.innerHTML='<tr><td colspan="6" class="empty-state">Nicio comandă pentru acest client.</td></tr>';
  } else {
    cOrders.forEach(o=>{
      const tr=document.createElement('tr');
      tr.className='clickable';
      tr.innerHTML=`
        <td><span class="nr-cmd">${fmtNr(o.nr_comanda)}</span></td>
        <td>${fmtDate(o.data_creare)}</td>
        <td class="text-muted">${escHtml(o.furnizor||'—')}</td>
        <td style="text-align:center">${o.nr_produse}</td>
        <td class="fw-bold text-green">${fmtRON(o.total_plata)} RON</td>
        <td><span class="badge b-${o.status_general}">${o.status_general}</span></td>
      `;
      tr.addEventListener('click',()=>{ navigate('comenzi'); setTimeout(()=>loadDetail(o.id,o),100); });
      tbody.appendChild(tr);
    });
  }
  det.scrollIntoView({behavior:'smooth',block:'start'});
}

function closeClientDetail() {
  document.getElementById('client-detail').style.display='none';
  currentClientId=null;
}

function openNewClient() {
  editClientId=null;
  document.getElementById('modal-client-title').textContent='Client nou';
  document.getElementById('modal-client-body').innerHTML = buildClientForm({});
  openModal('modal-client');
}

async function openEditClient(id) {
  const c=allClients.find(x=>x.id===id) || await api(`clienti?id=eq.${id}&select=*`).then(r=>r[0]);
  editClientId=id;
  document.getElementById('modal-client-title').textContent=`Editează — ${c.nume}`;
  document.getElementById('modal-client-body').innerHTML = buildClientForm(c);
  openModal('modal-client');
}

function buildClientForm(c) {
  return `
    <div class="grid2">
      <div class="field"><label>Nume *</label><input id="cf-nume"    value="${escHtml(c.nume||'')}"/></div>
      <div class="field"><label>Telefon</label><input id="cf-telefon" value="${escHtml(c.telefon||'')}"/></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Email</label><input id="cf-email" type="email" value="${escHtml(c.email||'')}"/></div>
      <div class="field"><label>VIN</label><input id="cf-vin" placeholder="Ex: WBA3A5C5XDF354198" value="${escHtml(c.vin||'')}" style="font-family:monospace;letter-spacing:.5px"/></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Adaos implicit (%)</label><input type="number" id="cf-adaos" value="${c.adaos_implicit||''}" placeholder="Ex: 20 — se aplică automat la comenzi noi" min="0" step="0.5"/></div>
      <div class="field"><label>Adresă</label><input id="cf-adresa" value="${escHtml(c.adresa||'')}"/></div>
    </div>
    <div class="field"><label>Note</label><textarea id="cf-note">${escHtml(c.note||'')}</textarea></div>
  `;
}

async function saveClient() {
  const nume=document.getElementById('cf-nume')?.value?.trim();
  if(!nume){ toast('Numele este obligatoriu!','warn'); return; }
  const adaosVal = document.getElementById('cf-adaos')?.value;
  const body={
    nume, telefon:document.getElementById('cf-telefon').value,
    email:document.getElementById('cf-email').value,
    vin:document.getElementById('cf-vin').value.trim().toUpperCase()||null,
    adresa:document.getElementById('cf-adresa')?.value||null,
    note:document.getElementById('cf-note').value,
    adaos_implicit: adaosVal ? parseFloat(adaosVal) : null,
  };
  try {
    if(editClientId){
      await api(`clienti?id=eq.${editClientId}`,{method:'PATCH',body:JSON.stringify(body)});
      toast('Client actualizat!','success');
    } else {
      await api('clienti',{method:'POST',body:JSON.stringify(body)});
      toast('Client adăugat!','success');
    }
    closeModal('modal-client');
    await loadClients();
    if(editClientId && currentClientId===editClientId){
      await loadClientDetail(editClientId);
    }
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function deleteClient(clientId, clientNume, event) {
  if(event) event.stopPropagation();
  // Verifică dacă are comenzi
  const orders = allOrders.filter(o=>o.client_id===clientId);
  if(orders.length > 0) {
    toast(`❌ Nu poți șterge clientul ${clientNume} — are ${orders.length} comenzi active.`,'warn');
    return;
  }
  if(!confirm(`Ștergi clientul "${clientNume}"?
Această acțiune este ireversibilă.`)) return;
  try {
    await api(`clienti?id=eq.${clientId}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
    await logAction('DELETE','client',clientId,{nume:clientNume});
    allClients = allClients.filter(c=>c.id!==clientId);
    renderClientsTable(allClients);
    toast('Client șters.','info');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function openQuickAddClient() {
  const nume = prompt('Nume client nou:');
  if(!nume?.trim()) return;
  const telefon = prompt('Telefon (opțional):') || '';
  try {
    const [client] = await api('clienti', {
      method:'POST',
      body: JSON.stringify({ nume: nume.trim(), telefon: telefon.trim()||null })
    });
    // Adaugă în allClients și în select
    allClients.push(client);
    const sel = document.getElementById('no-client');
    if(sel) {
      const opt = document.createElement('option');
      opt.value = client.id;
      opt.textContent = escHtml(client.nume);
      opt.selected = true;
      sel.appendChild(opt);
    }
    toast(`✅ Client "${client.nume}" adăugat și selectat!`,'success');
  } catch(e){ toast('Eroare: '+e.message,'error'); }
}

async function openQuickAddClientAlloc() {
  const nume = prompt('Nume client nou:');
  if(!nume?.trim()) return;
  const telefon = prompt('Telefon (opțional):') || '';
  try {
    const [client] = await api('clienti', {
      method: 'POST',
      body: JSON.stringify({ nume: nume.trim(), telefon: telefon.trim()||null })
    });
    if(!allClients) allClients = [];
    allClients.push(client);
    const sel = document.getElementById('alloc-client');
    if(sel) {
      const opt = document.createElement('option');
      opt.value = client.id;
      opt.textContent = escHtml(client.nume);
      opt.selected = true;
      sel.appendChild(opt);
    }
    toast(`✅ Client "${client.nume}" adăugat!`, 'success');
  } catch(e) { toast('Eroare: '+e.message, 'error'); }
}

