// Shows a small notice when a WhatsApp confirmation link is opened
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-wa]');
  if (!a) return;
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = 'WhatsApp confirmation opened.';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
});

// Reports page: show only the date fields that matter for the chosen period
const sel = document.getElementById('period');
if (sel) {
  const apply = () => document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(sel.value); });
  sel.addEventListener('change', apply); apply();
}

// Settings page: shrink the chosen logo to max 256px and send it as a data URL
const lf = document.getElementById('logofile');
if (lf) lf.addEventListener('change', () => {
  const msg = document.getElementById('logomsg'), save = document.getElementById('logosave'), f = lf.files[0];
  save.disabled = true;
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { msg.textContent = 'Please choose a PNG, JPEG or WebP image.'; return; }
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL('image/png');
    if (d.length > 260000) { msg.textContent = 'That image is too detailed. Try a simpler or smaller logo.'; return; }
    document.getElementById('logo_data').value = d; msg.textContent = 'Ready: ' + c.width + '×' + c.height + ' px. Click Upload logo.'; save.disabled = false;
  };
  img.onerror = () => { msg.textContent = 'Could not read that image.'; };
  img.src = URL.createObjectURL(f);
});
