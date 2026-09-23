/* Admin and photo-proof extension for the local Steady MVP. */
state.users ||= [{ id: 'admin', name: state.user || 'Jordan', email: '', role: 'Admin' }];

const oldRender = render;
const nav = document.querySelector('.nav');
const adminNav = document.createElement('button');
adminNav.dataset.page = 'admin';
adminNav.innerHTML = '<span class="navicon">♙</span><span class="navtext">Admin</span>';
nav.appendChild(adminNav);
adminNav.onclick = () => {
  currentPage = 'admin';
  document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle('active', x === adminNav));
  render();
};

render = function () {
  if (currentPage !== 'admin') {
    oldRender();
    if (currentPage === 'log') addPhotoControls();
    return;
  }
  document.getElementById('crumb').textContent = 'Admin';
  document.getElementById('content').innerHTML = adminMarkup();
  bindAdmin();
};

function adminMarkup() {
  const proofs = [];
  Object.entries(state.logs).forEach(([date, entries]) => {
    Object.entries(entries).forEach(([taskId, entry]) => {
      if (entry.photo) proofs.push({ date, task: state.tasks.find(t => t.id === taskId), entry, taskId });
    });
  });
  return `<div class="pagehead"><div><div class="eyebrow">Workspace controls</div><h1>Admin panel.</h1><p class="subtitle">Manage users, practices, and photo submissions for this workspace.</p></div><button class="primary" id="adminAddTask">＋ Add a practice</button></div>
  <div class="grid"><div class="card" style="grid-column:span 6"><div class="cardtitle">Users</div><div class="cardhint">Add people to this workspace.</div><div class="twocol"><div class="field"><label>Name</label><input id="memberName" placeholder="Full name"></div><div class="field"><label>Email (optional)</label><input id="memberEmail" type="email" placeholder="name@example.com"></div></div><button class="secondary" id="addMember">＋ Add user</button>
  ${state.users.map(u => `<div class="logrow"><div><div class="logtask">${esc(u.name)} <span class="tag">${esc(u.role || 'Member')}</span></div><div class="logdetail">${esc(u.email || 'No email added')}</div></div>${u.id !== 'admin' ? `<button class="secondary" data-remove-user="${esc(u.id)}">Remove</button>` : ''}</div>`).join('')}</div>
  <div class="card" style="grid-column:span 6"><div class="cardtitle">Practice management</div><div class="cardhint">Create and remove tasks from this panel.</div>${state.tasks.map(t => `<div class="logrow"><div><div class="logtask">${esc(t.name)}</div><div class="logdetail">${esc(t.category)} · ${esc(t.frequency)}</div></div><button class="secondary" data-admin-delete="${esc(t.id)}">Delete</button></div>`).join('') || '<div class="empty">No practices yet.</div>'}</div>
  <div class="card" style="grid-column:span 12"><div class="cardtitle">Photo submissions</div><div class="cardhint">Review task photos here. AI checks require a secure vision service and are not active in this local version.</div>${proofs.length ? proofs.map(p => `<div class="logrow"><img src="${esc(p.entry.photo)}" alt="Submitted task proof" style="height:74px;width:96px;object-fit:cover;border-radius:8px"><div style="flex:1"><div class="logtask">${esc(p.task?.name || 'Removed practice')}</div><div class="logdetail">${esc(p.date)} · ${p.entry.reviewed ? 'Reviewed' : 'Awaiting review'}</div></div><button class="secondary" data-review="${esc(p.date)}|${esc(p.taskId)}">Mark reviewed</button></div>`).join('') : '<div class="empty">No photo submissions yet.</div>'}</div></div>`;
}

function bindAdmin() {
  document.getElementById('adminAddTask').onclick = openModal;
  document.getElementById('addMember').onclick = () => {
    const name = document.getElementById('memberName').value.trim();
    if (!name) return document.getElementById('memberName').focus();
    state.users.push({ id: uid(), name, email: document.getElementById('memberEmail').value.trim(), role: 'Member' });
    save(); render(); toast('User added to this workspace.');
  };
  document.querySelectorAll('[data-remove-user]').forEach(button => button.onclick = () => {
    if (!confirm('Remove this user from the workspace?')) return;
    state.users = state.users.filter(user => user.id !== button.dataset.removeUser);
    save(); render(); toast('User removed.');
  });
  document.querySelectorAll('[data-admin-delete]').forEach(button => button.onclick = () => {
    if (!confirm('Delete this practice? Existing logs will remain in saved data.')) return;
    state.tasks = state.tasks.filter(task => task.id !== button.dataset.adminDelete);
    save(); render(); toast('Practice deleted.');
  });
  document.querySelectorAll('[data-review]').forEach(button => button.onclick = () => {
    const [date, taskId] = button.dataset.review.split('|');
    if (state.logs[date]?.[taskId]) state.logs[date][taskId].reviewed = true;
    save(); render(); toast('Photo marked as reviewed.');
  });
}

function addPhotoControls() {
  document.querySelectorAll('.logrow').forEach(row => {
    const toggle = row.querySelector('[data-toggle]');
    if (!toggle || row.querySelector('[data-photo-proof]')) return;
    const taskId = toggle.dataset.toggle;
    const proof = logFor(today(), taskId).photo;
    const area = document.createElement('div');
    area.dataset.photoProof = taskId;
    area.style.cssText = 'display:flex;align-items:center;gap:9px;margin:0 0 10px 33px;flex-wrap:wrap';
    area.innerHTML = `<label class="secondary" style="cursor:pointer">＋ Attach photo<input type="file" accept="image/*" data-photo="${esc(taskId)}" style="display:none"></label>${proof ? `<img src="${esc(proof)}" alt="Task proof" style="height:42px;width:54px;object-fit:cover;border-radius:6px"><span class="logdetail">Saved · AI review not connected</span><button class="checkbtn" data-ai-check>AI check</button>` : ''}`;
    row.after(area);
  });
  document.querySelectorAll('[data-photo]').forEach(input => input.onchange = () => {
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        state.logs[today()] ||= {};
        const entry = state.logs[today()][input.dataset.photo] || { done: false, value: '', friction: '' };
        entry.photo = canvas.toDataURL('image/jpeg', 0.72); entry.done = true;
        state.logs[today()][input.dataset.photo] = entry;
        try { save(); render(); toast('Photo proof saved with today’s task.'); }
        catch { toast('The photo could not be saved. Try a smaller image.'); }
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  document.querySelectorAll('[data-ai-check]').forEach(button => button.onclick = () => toast('AI photo checking needs a connected vision service. Photo is saved for manual review.'));
}
