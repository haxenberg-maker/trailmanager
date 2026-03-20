// users.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function loadUsers() {
  document.getElementById('users-loading').style.display = 'block';
  document.getElementById('users-table').style.display   = 'none';
  try {
    const data = await api('user_profiles?select=id,email,name,role,created_at&order=created_at.asc');
    allUsers = data;
    renderUsers(data);
  } catch(e) {
    document.getElementById('users-loading').innerHTML = `<span class="text-red">❌ ${e.message}</span>`;
  }
}

function renderUsers(users) {
  document.getElementById('users-loading').style.display = 'none';
  document.getElementById('users-table').style.display   = 'table';
  const tbody = document.getElementById('users-body');
  tbody.innerHTML = '';

  users.forEach(u => {
    const isSelf = u.id === currentUserId;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="fw-bold">${escHtml(u.name||'—')}</td>
      <td style="font-size:12px">${escHtml(u.email)}</td>
      <td><span class="role-${u.role}">${(u.role||'').toUpperCase()}</span></td>
      <td>
        <span class="badge" style="${u.activ?'background:#064e3b;color:#6ee7b7':'background:#3b1515;color:#fca5a5'}">
          ✅ Activ
        </span>
      </td>
      <td style="font-size:12px;color:var(--muted)">${fmtDate(u.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn" onclick="openEditUser('${u.id}')" title="Editează">✏️</button>
        ${!isSelf ? `<button class="icon-btn" style="color:var(--red)" onclick="toggleUserActive('${u.id}',${!u.activ})" title="${u.activ?'Dezactivează':'Activează'}">${u.activ?'🔒':'🔓'}</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAddUser() {
  editUserId = null;
  document.getElementById('modal-user-title').textContent = 'Utilizator nou';
  document.getElementById('modal-user-body').innerHTML = buildUserForm({});
  openModal('modal-user');
}

function openEditUser(id) {
  const u = allUsers.find(x=>x.id===id);
  if(!u) return;
  editUserId = id;
  document.getElementById('modal-user-title').textContent = `Editează — ${u.email}`;
  document.getElementById('modal-user-body').innerHTML = buildUserForm(u);
  openModal('modal-user');
}

function buildUserForm(u) {
  return `
    <div class="grid2">
      <div class="field">
        <label>Email *</label>
        <input type="email" id="uf-email" value="${escHtml(u.email||'')}" ${u.id?'readonly style="opacity:.6"':''}/>
      </div>
      <div class="field">
        <label>Nume afișat</label>
        <input id="uf-nume" value="${escHtml(u.name||'')}"/>
      </div>
    </div>
    <div class="grid2">
      <div class="field">
        <label>Rol</label>
        <select id="uf-rol">
          <option value="user"      ${u.role==='user'      ?'selected':''}>👤 User</option>
          <option value="gestionar" ${u.role==='gestionar' ?'selected':''}>🔧 Gestionar</option>
          <option value="admin"     ${u.role==='administrator'     ?'selected':''}>👑 Admin</option>
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="uf-activ" style="display:none">
          <option value="true"  ${'selected'}>✅ Activ</option>
          <option value="false" ${''}>❌ Inactiv</option>
        </select>
      </div>
    </div>
    ${!u.id ? `
    <div class="field">
      <label>Parolă temporară *</label>
      <input type="password" id="uf-password" placeholder="Minim 8 caractere"/>
      <small style="color:var(--muted);font-size:11px">Utilizatorul o va putea schimba ulterior</small>
    </div>` : ''}
  `;
}

async function saveUser() {
  const email = document.getElementById('uf-email')?.value?.trim();
  const nume  = document.getElementById('uf-nume')?.value?.trim();
  const rol   = document.getElementById('uf-rol')?.value;

  if(!editUserId) {
    // Utilizator NOU — apelează Edge Function
    const pass = document.getElementById('uf-password')?.value;
    if(!email) { toast('Email-ul este obligatoriu!','warn'); return; }
    if(!pass)  { toast('Parola temporară este obligatorie!','warn'); return; }
    if(pass.length < 8) { toast('Parola trebuie să aibă minim 8 caractere!','warn'); return; }

    const btn = document.querySelector('#modal-user .btn-primary');
    btn.disabled = true; btn.textContent = '⏳ Se creează...';

    try {
      const res = await fetch(`${SB}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey':        ANON_KEY,
        },
        body: JSON.stringify({ email, password: pass, name: nume, role: rol })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Eroare necunoscută');

      await logAction('CREATE', 'user', data.user?.id, { email, role: rol });
      toast(`✅ Cont creat pentru ${email}! Parola temporară a fost setată.`, 'success');
      closeModal('modal-user');
      await loadUsers();
    } catch(e) {
      toast('Eroare: ' + e.message, 'error');
    }
    btn.disabled = false; btn.textContent = '💾 Salvează';
    return;
  }

  // Editare utilizator EXISTENT
  try {
    await api(`user_profiles?id=eq.${editUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: nume, role: rol })
    });
    await logAction('UPDATE', 'user', editUserId, { role: rol, name: nume });
    toast('Utilizator actualizat!','success');
    closeModal('modal-user');
    await loadUsers();
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

async function toggleUserActive(id, newState) {
  try {
    await api(`user_profiles?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: u?.role||'user' })
    });
    await logAction('UPDATE', 'user', id, { activ: newState });
    toast(newState ? 'Utilizator activat.' : 'Utilizator dezactivat.', 'info');
    await loadUsers();
  } catch(e) { toast('Eroare: '+e.message,'error'); }
}

