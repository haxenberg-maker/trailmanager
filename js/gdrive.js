// gdrive.js — CRM Piese Auto
// ════════════════════════════════════════════════════════════

async function gdriveGetToken() {
  return new Promise((resolve, reject) => {
    if(_gdriveToken) { resolve(_gdriveToken); return; }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope:     GDRIVE_SCOPE,
      callback:  (resp) => {
        if(resp.error) { reject(new Error(resp.error)); return; }
        _gdriveToken = resp.access_token;
        // Expiră în ~1h, resetăm
        setTimeout(() => { _gdriveToken = null; }, 3500 * 1000);
        resolve(_gdriveToken);
      },
    });
    client.requestAccessToken();
  });
}

async function gdriveUpload(nrFactura, file) {
  const token = await gdriveGetToken();

  // Metadata fișier
  const metadata = {
    name:    `Factura_${nrFactura.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
    parents: [GDRIVE_FOLDER_ID],
    mimeType: 'application/pdf',
    description: `Factură furnizor: ${nrFactura}`,
  };

  // Multipart upload
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    form,
    }
  );
  if(!res.ok) throw new Error(`Drive upload error: ${res.status}`);
  const data = await res.json();

  // Setează permisiune publică (anyone with link can view)
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  // Returnează URL preview
  return `https://drive.google.com/file/d/${data.id}/preview`;
}

async function startUploadFactura(nrFactura) {
  _pendingUploadNr = nrFactura;

  if(_gdriveToken) {
    // Token există — deschide direct file picker
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => uploadFacturaPdf(nrFactura, e.target);
    input.click();
    return;
  }

  // Token lipsă — trebuie autentificare (popup)
  // Afișăm un buton explicit ca utilizatorul să-l apese conștient
  const confirmed = confirm(
    'Este nevoie de autentificare Google Drive.\n\nApasă OK pentru a deschide fereastra de autentificare, după care vei putea selecta fișierul PDF.'
  );
  if(!confirmed) return;

  try {
    toast('⏳ Autentificare Google...', 'info');
    await gdriveGetToken();
    toast('✅ Autentificat! Selectează fișierul PDF.', 'success');
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => uploadFacturaPdf(nrFactura, e.target);
    input.click();
  } catch(e) {
    toast('Autentificare eșuată: ' + e.message + '\nVerifică că ești în lista Test Users din Google Cloud.', 'error');
  }
}

async function uploadFacturaPdf(nrFactura, inputEl) {
  const file = inputEl?.files?.[0];
  if(!file) return;
  if(file.type !== 'application/pdf') { toast('Doar fișiere PDF!', 'warn'); return; }

  try {
    toast('⏳ Se urcă PDF-ul în Google Drive...', 'info');
    const previewUrl = await gdriveUpload(nrFactura, file);
    await upsertFactura(nrFactura, {
      pdf_url:      previewUrl,
      pdf_filename: file.name,
      status:       getFacturaByNr(nrFactura)?.status || 'nou'
    });
    toast(`✅ PDF urcat! Factura ${nrFactura} e în sistem.`, 'success');

    // Dacă workspace-ul e deschis, actualizează iframe
    const ws = document.getElementById('modal-factura-workspace');
    if(ws?.classList.contains('open')) {
      document.getElementById('fw-no-pdf').style.display = 'none';
      document.getElementById('fw-iframe').style.display = 'block';
      document.getElementById('fw-iframe').src = previewUrl;
    }

    await showFacturiTab('pdf-list');
    loadFacturi();
  } catch(e) {
    toast('Eroare upload: ' + e.message, 'error');
  }
}

