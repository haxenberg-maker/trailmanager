// state.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

let accessToken = null;

function getHeaders(extra={}) {
  return {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${accessToken || ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extra,
  };
}

// ════ SUPABASE AUTH ════
function doLoginGoogle() {
  const btn = document.getElementById('login-google-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Se redirecționează...';

  // Redirect direct — nu fetch (CORS)
  const redirectTo = encodeURIComponent(window.location.href.split('#')[0]);
  const scopes     = encodeURIComponent('email profile https://www.googleapis.com/auth/drive.file');
  window.location.href = `${SB}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}&scopes=${scopes}`;
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if(!email || !password) { errEl.textContent='Completează email și parola.'; errEl.style.display='block'; return; }

  btn.disabled = true; btn.textContent = 'Se autentifică...';
  try {
    const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if(!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.msg || 'Autentificare eșuată');
    }
    accessToken = data.access_token;
    currentUserId = data.user?.id;
    localStorage.setItem('crm_token', data.access_token);
    localStorage.setItem('crm_refresh', data.refresh_token);
    localStorage.setItem('crm_email', data.user?.email || email);
    localStorage.setItem('crm_user_id', data.user?.id || '');

    // Verifică dacă trebuie să schimbe parola
    const profileRes = await fetch(`${SB}/rest/v1/user_profiles?id=eq.${data.user?.id}&select=must_change_password`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${data.access_token}` }
    });
    const profiles = await profileRes.json();
    const mustChange = profiles?.[0]?.must_change_password === true;
    showApp(data.user?.email || email, data.user?.id, mustChange);
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Intră în cont';
}

async function refreshSession() {
  const refresh = localStorage.getItem('crm_refresh');
  if(!refresh) return false;
  try {
    const res = await fetch(`${SB}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = await res.json();
    if(!res.ok || !data.access_token) return false;
    accessToken = data.access_token;
    localStorage.setItem('crm_token', data.access_token);
    localStorage.setItem('crm_refresh', data.refresh_token);
    return true;
  } catch { return false; }
}

function doLogout() {
  accessToken = null;
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_refresh');
  localStorage.removeItem('crm_email');
  document.getElementById('login-page').classList.add('visible');
  document.getElementById('app').style.display = 'none';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

async function showApp(email, userId, mustChangePass=false) {
  if(mustChangePass) {
    showChangePasswordPrompt();
    return;
  }

  // 1. Setează imediat variabilele globale
  currentUserEmail = email;
  currentUserId    = userId || currentUserId;

  // 2. Arată UI-ul
  document.getElementById('login-page').classList.remove('visible');
  document.getElementById('app').style.display    = 'flex';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('sidebar-user').textContent = email;
  window._currentAgentFirstName = email.split('@')[0];

  // 3. Badge rol în sidebar
  if(!document.getElementById('sidebar-role')) {
    const roleDiv = document.createElement('div');
    roleDiv.id = 'sidebar-role';
    roleDiv.style.cssText = 'margin-top:4px;display:inline-block';
    document.getElementById('sidebar-user').after(roleDiv);
  }

  // 4. Încarcă profilul — EXPLICIT cu userId
  try {
    const profiles = await api(`user_profiles?id=eq.${currentUserId}&select=id,email,name,role`);
    if(profiles && profiles.length > 0) {
      const p = profiles[0];
      currentUserRole = p.role;
      window._currentAgentFirstName = p.name || email.split('@')[0];
      // Actualizează badge rol
      const roleEl = document.getElementById('sidebar-role');
      if(roleEl) {
        roleEl.className   = `role-${p.role}`;
        roleEl.textContent = p.role?.toUpperCase() || '';
      }
      // Aplică UI pe baza rolului
      applyRoleUI();
      console.log('Profile loaded:', p.role, p.name);
    } else {
      console.warn('No profile found for userId:', currentUserId);
      // Încearcă să creeze profilul dacă lipsește (Google OAuth nou)
      try {
        await api('user_profiles', {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ id: currentUserId, email, name: email.split('@')[0], role: 'user' })
        });
        currentUserRole = 'user';
        applyRoleUI();
      } catch(e2) { console.warn('Could not create profile:', e2.message); }
    }
  } catch(e) {
    console.error('Profile load error:', e.message);
  }

  // 5. Încarcă datele
  loadOrders();
  logAction('LOGIN', 'user', currentUserId, { email });
}

// Enter key pe login
document.addEventListener('keydown', e => {
  if(e.key === 'Enter' && document.getElementById('login-page').classList.contains('visible')) {
    doLogin();
  }
});
