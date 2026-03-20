// api.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

function getHeaders(extra={}) {
  return {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${accessToken || ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extra,
  };
}

async function api(path, opts={}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts, headers: getHeaders(opts.headers||{})
  });
  // Token expirat — încearcă refresh
  if(res.status === 401) {
    const ok = await refreshSession();
    if(ok) {
      const res2 = await fetch(`${SB}/rest/v1/${path}`, {
        ...opts, headers: getHeaders(opts.headers||{})
      });
      if(!res2.ok) throw new Error(await res2.text());
      return res2.status===204 ? null : res2.json();
    } else {
      doLogout();
      throw new Error('Sesiunea a expirat. Te rog autentifică-te din nou.');
    }
  }
  if (!res.ok) throw new Error(await res.text());
  return res.status===204 ? null : res.json();
}

async function storageUpload(bucket, path, file) {
  const res = await fetch(`${SB}/storage/v1/object/${bucket}/${path}`, {
    method:'POST',
    headers:{ 'apikey':ANON_KEY, 'Authorization':`Bearer ${accessToken||ANON_KEY}`, 'Content-Type':file.type },
    body:file,
  });
  if (!res.ok) throw new Error(await res.text());
  return `${SB}/storage/v1/object/public/${bucket}/${path}`;
}

async function logAction(actiune, entitate, entitateId, detalii={}) {
  try {
    const res = await fetch(`${SB}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        ...getHeaders({ 'Prefer': 'return=minimal' }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id:    currentUserId,
        user_email: currentUserEmail,
        user_rol:   currentUserRole,
        actiune,
        entitate,
        entitate_id: entitateId,
        detalii,
      })
    });
    // 201 sau 204 — nu parsăm JSON
    if(!res.ok) console.warn('Log error status:', res.status);
  } catch(e) { console.warn('Log error:', e.message); }
}

