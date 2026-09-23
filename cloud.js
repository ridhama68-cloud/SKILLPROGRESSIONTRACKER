const config = window.STEADY_CLOUD_CONFIG || {};
const app = window.steadyApp;
const configured = Boolean(config.supabaseUrl && config.publishableKey);
if (!configured) {
  const note = document.createElement('div');
  note.className = 'card';
  note.style.cssText = 'margin:0 0 16px;padding:12px 15px;color:#65705f;font-size:12px';
  note.textContent = 'Local demo mode · connect Supabase to share accounts, logs, and private photo proof across devices.';
  document.querySelector('.content').prepend(note);
} else startCloud();

async function startCloud() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const client = createClient(config.supabaseUrl, config.publishableKey);
  window.steadyCloud = { client, get workspaceId(){return workspaceId;}, get role(){return role;} };
  let user = null, workspaceId = null, role = 'member', ready = false, viewUserId = null, members = [], loadPromise = null;
  const localSave = window.save;
  const originalBindAdmin = window.bindAdmin;
  const baseRender = app.render;
  const dateToday = app.today;
  const authGate = document.createElement('div');
  authGate.className = 'modal-backdrop open';
  authGate.style.zIndex = '30';
  document.body.appendChild(authGate);
  showSignIn();

  const saveWithCloud = function () {
    localSave();
    if (ready) queueMicrotask(syncCurrentState);
  };
  window.save = saveWithCloud;
  app.save = saveWithCloud;
  window.bindAdmin = function () {
    originalBindAdmin();
    if (role !== 'admin') {
      document.querySelectorAll('[data-admin-delete],[data-remove-user]').forEach(el => el.remove());
      const addTask = document.getElementById('adminAddTask');
      if (addTask) addTask.remove();
      const memberForm = document.getElementById('addMember');
      if (memberForm) memberForm.closest('.card').querySelector('.twocol')?.remove();
      if (memberForm) memberForm.remove();
    } else bindCloudAdmin();
  };
  app.render = function () {
    baseRender();
    if (!ready) return;
    if (role !== 'admin') document.querySelectorAll('#addTask,#addTaskSettings,#adminAddTask,[data-delete],[data-admin-delete],[data-remove-user]').forEach(el => el.remove());
    if (role === 'admin' && viewUserId !== user.id) {
      document.querySelectorAll('[data-toggle],[data-value],[data-friction],#saveLog').forEach(el => { el.disabled = true; el.title = 'Viewing another member’s progress'; });
    }
    addMemberPicker();
  };
  window.addPhotoControls = function () { addCloudPhotoControls(); };

  function showSignIn(message = '') {
    authGate.innerHTML = `<div class="modal" style="max-width:430px"><div class="eyebrow">Shared workspace</div><h2 style="font:700 23px Manrope;margin:5px 0 8px">Sign in to Steady</h2><p style="color:#777;font-size:12px;line-height:1.6">Use your email to receive a secure sign-in link. Workspace data will sync across your devices.</p><label class="field"><span>Email</span><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><div id="authMessage" style="color:#67735e;font-size:12px;min-height:18px;margin:10px 0">${escapeText(message)}</div><button class="primary" id="sendMagicLink" style="width:100%">Email me a sign-in link</button></div>`;
    document.getElementById('sendMagicLink').onclick = async () => {
      const email = document.getElementById('cloudEmail').value.trim();
      if (!email.includes('@')) { document.getElementById('authMessage').textContent = 'Enter a valid email address.'; return; }
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      document.getElementById('authMessage').textContent = error ? error.message : 'Check your inbox for a secure sign-in link.';
    };
  }

  client.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    if (user) queueMicrotask(loadWorkspace);
    else { ready = false; showSignIn(); }
  });
  const { data } = await client.auth.getSession();
  if (data.session?.user) { user = data.session.user; await loadWorkspace(); }

  async function loadWorkspace() {
    if (loadPromise) return loadPromise;
    loadPromise = loadWorkspaceOnce();
    try { await loadPromise; } finally { loadPromise = null; }
  }

  async function loadWorkspaceOnce() {
    if (!user) return;
    authGate.style.display = 'grid';
    const { data: rows, error } = await client.from('workspace_members').select('workspace_id,user_id,role,display_name').eq('user_id', user.id);
    if (error) { showSignIn('Could not load workspace. Check the Supabase setup and migration.'); return; }
    if (!rows?.length) {
      const { data: newId, error: createError } = await client.rpc('create_workspace', { workspace_name: config.workspaceName || 'My workspace' });
      if (createError) { showSignIn(createError.message); return; }
      workspaceId = newId;
    } else workspaceId = rows[0].workspace_id;
    const { data: roster, error: rosterError } = await client.from('workspace_members').select('workspace_id,user_id,role,display_name').eq('workspace_id', workspaceId);
    if (rosterError) { showSignIn(rosterError.message); return; }
    members = roster || [];
    role = members.find(m => m.user_id === user.id)?.role || 'member';
    viewUserId = role === 'admin' && members.some(m => m.user_id === viewUserId) ? viewUserId : user.id;
    const loaded = await loadData();
    if (!loaded) return;
    authGate.style.display = 'none';
    ready = true;
    addMemberPicker();
    addSignOutButton();
    window.steadyApp.render();
  }

  async function loadData() {
    const { data: tasks, error: taskError } = await client.from('tasks').select('*').eq('workspace_id', workspaceId).is('archived_at', null).order('created_at');
    if (taskError) { showSignIn('Could not load practices: ' + taskError.message); return false; }
    app.state.tasks = (tasks || []).map(t => ({ id:t.id, name:t.name, category:t.category, frequency:t.frequency, type:t.track_type, unit:t.unit, direction:t.direction, target:t.target, created:t.created_on }));
    app.state.users = members.map(m => ({ id:m.user_id, name:m.display_name || 'Member', role:m.role === 'admin' ? 'Admin' : 'Member', email:'' }));
    const { data: logs, error: logError } = await client.from('task_logs').select('*').eq('workspace_id', workspaceId).eq('user_id', viewUserId).order('log_date');
    if (logError) { showSignIn('Could not load progress: ' + logError.message); return false; }
    const photoRows = (logs || []).filter(l => l.photo_path);
    const signed = new Map();
    if (photoRows.length) {
      const paths = photoRows.map(l => l.photo_path);
      const { data: urls } = await client.storage.from('task-proofs').createSignedUrls(paths, 3600);
      (urls || []).forEach((v, i) => signed.set(paths[i], v.signedUrl));
    }
    const mapped = {};
    (logs || []).forEach(l => {
      const date = String(l.log_date).slice(0,10);
      mapped[date] ||= {};
      mapped[date][l.task_id] = { done:l.done, value:l.value == null ? '' : String(l.value), friction:l.friction || '', photo:signed.get(l.photo_path) || '', photoPath:l.photo_path, reviewed:l.photo_reviewed, verified:l.ai_result === 'matched' };
    });
    app.state.logs = mapped;
    app.state.user = members.find(m => m.user_id === viewUserId)?.display_name || user.email?.split('@')[0] || 'Friend';
    app.save();
    return true;
  }

  async function syncCurrentState() {
    if (!ready || !user) return;
    if (role === 'admin') {
      const taskRows = app.state.tasks.map(t => ({ id:t.id, workspace_id:workspaceId, name:t.name, category:t.category, frequency:t.frequency, track_type:t.type, unit:t.unit || '', direction:t.direction || 'up', target:t.target || '', created_on:t.created || new Date().toISOString().slice(0,10), created_by:user.id }));
      if (taskRows.length) {
        const { error } = await client.from('tasks').upsert(taskRows);
        if (error) console.error('Task sync failed:', error.message);
      }
      const { data: savedTasks } = await client.from('tasks').select('id').eq('workspace_id', workspaceId).is('archived_at', null);
      const live = new Set(app.state.tasks.map(t => t.id));
      for (const t of savedTasks || []) if (!live.has(t.id)) await client.from('tasks').update({ archived_at:new Date().toISOString() }).eq('id', t.id);
    }
    if (viewUserId !== user.id) return;
    const rows = [];
    Object.entries(app.state.logs).forEach(([date, entries]) => Object.entries(entries).forEach(([taskId, x]) => {
      if (!crypto.randomUUID || !isUuid(taskId)) return;
      rows.push({ workspace_id:workspaceId, task_id:taskId, user_id:user.id, log_date:date, done:Boolean(x.done), value:x.value === '' ? null : Number(x.value), friction:x.friction || '', photo_path:x.photoPath || null, photo_reviewed:Boolean(x.reviewed), ai_result:x.verified ? 'matched' : 'not_checked' });
    }));
    if (rows.length) {
      const { error } = await client.from('task_logs').upsert(rows, { onConflict:'task_id,user_id,log_date' });
      if (error) console.error('Progress sync failed:', error.message);
    }
  }

  function addMemberPicker() {
    document.getElementById('memberPicker')?.remove();
    if (role !== 'admin') return;
    const select = document.createElement('select'); select.id = 'memberPicker'; select.className = 'select';
    select.setAttribute('aria-label','View member progress');
    select.innerHTML = members.map(m => `<option value="${m.user_id}">${escapeText(m.display_name || 'Member')}${m.user_id === user.id ? ' (you)' : ''}</option>`).join('');
    select.value = viewUserId;
    select.onchange = async () => { viewUserId = select.value; await loadData(); window.steadyApp.render(); };
    document.querySelector('.top-actions').prepend(select);
  }

  function addSignOutButton() {
    let button = document.getElementById('cloudSignOut');
    if (button) return;
    button = document.createElement('button'); button.id = 'cloudSignOut'; button.className = 'secondary'; button.textContent = 'Sign out';
    button.onclick = () => client.auth.signOut(); document.querySelector('.top-actions').append(button);
  }

  function bindCloudAdmin() {
    const invite = document.getElementById('addMember');
    if (invite) invite.onclick = async () => {
      const displayName = document.getElementById('memberName').value.trim();
      const email = document.getElementById('memberEmail').value.trim();
      if (!displayName || !email.includes('@')) { toast('Enter a name and a valid email address.'); return; }
      invite.disabled = true;
      const { error } = await client.functions.invoke('invite-member', { body:{ workspaceId, displayName, email } });
      invite.disabled = false;
      if (error) {
        let message = error.message;
        try { const body = await error.context.clone().json(); message = body.error || body.message || message; } catch {}
        console.error('Invite failed:', message);
        toast('Invite failed: ' + message);
        return;
      }
      toast('Invitation sent.');
    };
    document.querySelectorAll('[data-remove-user]').forEach(button => button.onclick = async () => {
      if (!confirm('Remove this member’s workspace access? Their saved progress will remain.')) return;
      const { error } = await client.from('workspace_members').delete().eq('workspace_id',workspaceId).eq('user_id',button.dataset.removeUser).eq('role','member');
      if (error) { toast('Could not remove member.'); return; }
      await loadWorkspace();
    });
    document.querySelectorAll('[data-review]').forEach(button => button.onclick = async () => {
      const [date, taskId] = button.dataset.review.split('|');
      const { error } = await client.from('task_logs').update({photo_reviewed:true})
        .eq('workspace_id',workspaceId).eq('user_id',viewUserId).eq('task_id',taskId).eq('log_date',date);
      if (error) { toast('Could not save the review.'); return; }
      await loadData(); window.steadyApp.render(); toast('Photo marked as reviewed.');
    });
  }

  function addCloudPhotoControls() {
    document.querySelectorAll('.logrow').forEach(row => {
      const toggle = row.querySelector('[data-toggle]');
      if (!toggle || row.querySelector('[data-photo-proof]')) return;
      const taskId = toggle.dataset.toggle, entry = app.logFor(dateToday(),taskId);
      const area = document.createElement('div'); area.dataset.photoProof = taskId;
      area.style.cssText = 'display:flex;align-items:center;gap:9px;margin:0 0 10px 33px;flex-wrap:wrap';
      area.innerHTML = `<label class="secondary" style="cursor:pointer">＋ Attach photo<input type="file" accept="image/jpeg,image/png,image/webp" data-cloud-photo="${taskId}" style="display:none"></label>${entry.photo ? `<img src="${entry.photo}" alt="Task proof" style="height:42px;width:54px;object-fit:cover;border-radius:6px"><span class="logdetail">${entry.verified?'AI match':'Saved securely'}</span>` : ''}`;
      row.after(area);
    });
    document.querySelectorAll('[data-cloud-photo]').forEach(input => input.onchange = async () => {
      const file = input.files?.[0], taskId = input.dataset.cloudPhoto;
      if (file && file.size > 5 * 1024 * 1024) { toast('Choose an image smaller than 5 MB.'); return; }
      if (!file) return;
      const path = `${workspaceId}/${user.id}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
      const { error } = await client.storage.from('task-proofs').upload(path,file,{contentType:file.type,upsert:false});
      if (error) { toast('Photo upload failed. Check storage policies.'); return; }
      app.state.logs[dateToday()] ||= {};
      const entry = app.state.logs[dateToday()][taskId] || {done:false,value:'',friction:''};
      entry.photoPath = path; entry.photo = URL.createObjectURL(file); entry.done = true;
      app.state.logs[dateToday()][taskId] = entry;
      app.save(); await syncCurrentState(); await loadData(); app.render(); toast('Photo proof saved to the shared workspace.');
    });
  }

  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
}

function escapeText(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
