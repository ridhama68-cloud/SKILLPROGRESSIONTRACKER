(() => {
  const app = window.steadyApp;
  if (!app) return;

  const KEY = 'steady-focus-timer-v1';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { status: 'idle' }; }
    catch { return { status: 'idle' }; }
  };
  let timer = read();
  let idleDetector = null;
  let tickHandle = null;

  const style = document.createElement('style');
  style.textContent = `.focus-timer{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;align-items:center;gap:12px;background:#f1f4ec}.timer-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.timer-controls .select{max-width:220px}.timer-duration{display:flex;align-items:center;gap:6px;color:#757b71;font-size:11px}.timer-duration input{width:58px;border:1px solid #e9eae4;border-radius:7px;padding:8px;background:white}.timer-readout{font:700 28px Manrope,sans-serif;letter-spacing:-1px;min-width:94px;text-align:right}.timer-away{grid-column:1/-1;display:flex;align-items:center;gap:7px;font-size:11px;color:#697064}.focus-timer .cardhint{line-height:1.5}@media(max-width:760px){.focus-timer{grid-template-columns:1fr auto}.timer-controls{grid-column:1/-1;grid-row:2}.timer-readout{grid-column:2;grid-row:1}.timer-away{grid-column:1/-1}}`;
  document.head.appendChild(style);

  const persist = () => localStorage.setItem(KEY, JSON.stringify(timer));
  const formatted = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
  const remaining = () => timer.status === 'running'
    ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000))
    : Math.max(0, timer.remaining || 0);

  function addWidget() {
    const content = document.getElementById('content');
    const grid = content?.querySelector('.pagehead + .grid');
    if (!grid || document.getElementById('focusTimerCard')) return;
    const card = document.createElement('section');
    card.id = 'focusTimerCard';
    card.className = 'card focus-timer';
    card.innerHTML = `<div><div class="eyebrow">FOCUS SESSION</div><div class="cardtitle">Make a little room for practice</div><div class="cardhint">Pick a practice and start a timer. We’ll remind you when it’s done.</div></div><div class="timer-controls"><select class="select" id="timerTask" aria-label="Practice to focus on"><option value="">Choose a practice</option>${app.state.tasks.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')}</select><label class="timer-duration"><input id="timerMinutes" type="number" min="1" max="240" value="25" aria-label="Timer minutes"> min</label><button class="primary" id="timerStart">Start timer</button><button class="secondary" id="timerPause" style="display:none">Pause</button><button class="secondary" id="timerStop" style="display:none">End</button></div><div class="timer-readout" id="timerReadout" aria-live="polite">25:00</div><label class="timer-away"><input type="checkbox" id="pauseWhenAway" checked> Pause if I’m away from the computer (when supported)</label><div class="cardhint" id="timerHint">Away detection can detect inactivity, but not which app is open.</div>`;
    grid.prepend(card);
    const select = card.querySelector('#timerTask');
    if (timer.taskId && app.state.tasks.some(t => t.id === timer.taskId)) select.value = timer.taskId;
    if (timer.minutes) card.querySelector('#timerMinutes').value = timer.minutes;
    card.querySelector('#timerStart').onclick = start;
    card.querySelector('#timerPause').onclick = pause;
    card.querySelector('#timerStop').onclick = stop;
    updateWidget();
  }

  function escapeHtml(value='') {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function updateWidget() {
    const readout = document.getElementById('timerReadout');
    if (!readout) return;
    const startButton = document.getElementById('timerStart');
    const pauseButton = document.getElementById('timerPause');
    const stopButton = document.getElementById('timerStop');
    readout.textContent = formatted(remaining());
    startButton.style.display = timer.status === 'running' ? 'none' : '';
    startButton.textContent = timer.status === 'paused' ? 'Resume' : 'Start timer';
    pauseButton.style.display = timer.status === 'running' ? '' : 'none';
    stopButton.style.display = timer.status === 'idle' ? 'none' : '';
    document.getElementById('timerTask').disabled = timer.status === 'running' || timer.status === 'paused';
    document.getElementById('timerMinutes').disabled = timer.status === 'running' || timer.status === 'paused';
    const hint = document.getElementById('timerHint');
    if (hint && timer.status === 'paused' && timer.pauseReason === 'away') hint.textContent = 'Paused because you were inactive. Resume when you’re ready.';
    else if (hint && timer.status === 'running' && timer.taskName) hint.textContent = `Working on: ${timer.taskName}`;
    else if (hint) hint.textContent = 'Away detection can detect inactivity, but not which app is open.';
  }

  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    else if (app.toast) app.toast(body);
  }

  async function start() {
    if (timer.status === 'paused') {
      timer.endsAt = Date.now() + timer.remaining * 1000;
    } else {
      const taskId = document.getElementById('timerTask').value;
      const task = app.state.tasks.find(t => t.id === taskId);
      const minutes = Math.max(1, Math.min(240, Number(document.getElementById('timerMinutes').value) || 25));
      timer = { status: 'running', endsAt: Date.now() + minutes * 60000, remaining: minutes * 60, minutes, taskId, taskName: task?.name || 'Practice' };
    }
    timer.status = 'running'; timer.pauseReason = '';
    persist(); updateWidget();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(()=>{});
    if (document.getElementById('pauseWhenAway').checked) await enableAwayPause();
    clearInterval(tickHandle);
    tickHandle = setInterval(tick, 1000);
    tick();
  }

  function pause(reason='manual') {
    if (timer.status !== 'running') return;
    timer.remaining = remaining(); timer.status = 'paused'; timer.pauseReason = reason;
    persist(); updateWidget();
    if (reason === 'away') notify('Focus timer paused', 'You were inactive. Resume when you’re ready.');
  }

  function stop() {
    timer = { status: 'idle' }; persist(); clearInterval(tickHandle); updateWidget();
    if (idleDetector) { try { idleDetector.stop(); } catch {} idleDetector = null; }
  }

  function tick() {
    if (timer.status !== 'running') return;
    const left = remaining(); updateWidget();
    if (left <= 0) {
      const taskName = timer.taskName || 'your practice';
      timer = { status: 'idle' }; persist(); clearInterval(tickHandle); updateWidget();
      notify('Focus session complete', `Nice work showing up for ${taskName}.`);
      if (idleDetector) { try { idleDetector.stop(); } catch {} idleDetector = null; }
    }
  }

  async function enableAwayPause() {
    const hint = document.getElementById('timerHint');
    if (!('IdleDetector' in window) || !window.isSecureContext) {
      if (hint) hint.textContent = 'This browser can’t detect inactivity here. The timer will still notify you when time is up.';
      return;
    }
    try {
      const permission = await IdleDetector.requestPermission();
      if (permission !== 'granted') {
        if (hint) hint.textContent = 'Away detection permission wasn’t granted. The timer will keep running normally.';
        return;
      }
      idleDetector = new IdleDetector();
      idleDetector.addEventListener('change', () => {
        if (idleDetector.userState === 'idle' || idleDetector.screenState === 'locked') pause('away');
      });
      await idleDetector.start({ threshold: 120 });
      if (idleDetector.userState === 'idle' || idleDetector.screenState === 'locked') pause('away');
    } catch {
      if (hint) hint.textContent = 'Away detection isn’t available in this browser. The timer will keep running normally.';
    }
  }

  const baseRender = app.render;
  app.render = function () { baseRender(); addWidget(); };
  app.render();
  if (timer.status === 'running') {
    tickHandle = setInterval(tick, 1000);
    tick();
  }
})();
