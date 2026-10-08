// LLM Forum — комната: дерево обсуждения, WS-события, восстановление из БД.
const $ = (s) => document.querySelector(s);
const treeEl = $('#tree'), statusEl = $('#status'), modelsBar = $('#models-bar'),
  btnStart = $('#btn-start'), btnStop = $('#btn-stop'), summaryEl = $('#summary');

const roomId = location.pathname.split('/').pop();
const messages = new Map();
const children = new Map();
const audioUrls = new Map(); // msgId -> url mp3 (не теряется при перерисовке дерева)
const personaMap = new Map(); // modelId -> персона

const PALETTE = ['#4c6ef5', '#f06595', '#20c997', '#ffd43b', '#9775fa', '#ff922b', '#63e6be', '#4dabf7', '#e599f7', '#94d82d'];
const colorOf = (() => { const m = new Map(); let i = 0; return (model) => { if (!m.has(model)) m.set(model, PALETTE[i++ % PALETTE.length]); return m.get(model); }; })();

let running = false;
let ws = null;

function connect() {
  ws = new WebSocket('ws://' + location.host);
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.roomId && d.roomId !== roomId) return;
    if (d.type === 'msg') onMsg(d);
    else if (d.type === 'thinking') onThinking(d);
    else if (d.type === 'status') onStatus(d);
    else if (d.type === 'error') onError(d);
    else if (d.type === 'topic') onTopic(d);
    else if (d.type === 'audio') onAudio(d);
  };
  ws.onclose = () => setTimeout(connect, 2000);
}
connect();

// ─── Загрузка комнаты из БД ───
fetch('/api/rooms/' + roomId).then((r) => {
  if (r.status === 404) { statusEl.textContent = 'Комната не найдена'; statusEl.className = 'status error'; return null; }
  return r.json();
}).then((room) => {
  if (!room) return;
  document.title = '🧠 ' + (room.topic || 'Комната');
  running = !!room.running;
  for (const m of room.messages) {
    messages.set(m.id, m);
    const parent = m.parentId || 'root';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(m);
  }
  // ▶-кнопки: подхватываем готовые озвучки (mp3 уже на сервере) — ДО render(), чтобы старые узлы тоже получили кнопки
  if (room.audio) {
    for (const [msgId, url] of Object.entries(room.audio)) audioUrls.set(msgId, url);
  }
  render();
  const consensus = room.messages.find((m) => m.consensus);
  if (consensus) { summaryEl.textContent = '🧭 КОНСЕНСУС: ' + consensus.text; summaryEl.classList.remove('hidden'); }
  // чипы участников (имя личности + эмодзи)
  modelsBar.innerHTML = '';
  for (const m of room.participants) {
    personaMap.set(m.id, m.persona);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.model = m.id;
    chip.dataset.label = m.id.split('/').pop();
    chip.style.borderColor = colorOf(m.id);
    chip.textContent = `${m.persona.emoji} ${m.persona.name}`;
    chip.title = m.id + ' — ' + m.persona.trait;
    modelsBar.appendChild(chip);
  }
  if (running) {
    setStatus('🔴 Обсуждение идёт…', '');
    btnStart.disabled = true; btnStop.disabled = false;
  } else {
    setStatus(room.messages.length ? '⏸ Обсуждение остановлено. Можно продолжить.' : 'Обсуждение ещё не начато.', '');
  }
}).catch(() => { statusEl.textContent = 'Ошибка загрузки'; statusEl.className = 'status error'; });

function onTopic(d) { if (d.topic) document.title = '🧠 ' + d.topic; }

function onThinking(d) {
  setStatus(`💭 ${label(d.model)} думает… (раунд ${d.round || 1})`, 'thinking');
  updateChips(d.model, true);
}

function onMsg(d) {
  messages.set(d.id, d);
  const parent = d.parentId || 'root';
  if (!children.has(parent)) children.set(parent, []);
  children.get(parent).push(d);
  render();
  const el = document.getElementById('n-' + d.id);
  if (el) {
    el.classList.add('new');
    setTimeout(() => el.classList.remove('new'), 4000);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  updateChips(d.model, false);
  if (d.consensus) {
    summaryEl.textContent = '🧭 КОНСЕНСУС: ' + d.text;
    summaryEl.classList.remove('hidden');
  }
}

function onStatus(d) {
  if (d.state === 'running') {
    running = true;
    setStatus('🔴 Обсуждение идёт…', '');
    btnStart.disabled = true; btnStop.disabled = false;
  } else if (d.state === 'done') {
    running = false;
    setStatus(`⏸ Остановлено · всего сообщений: ${d.count || messages.size}`, '');
    btnStart.disabled = false; btnStop.disabled = true;
    updateChips(null, false);
    // комната остановлена — хвост авто-озвучки не доигрываем
    audioQueue.length = 0;
    if (!audio.paused) { audio.pause(); }
    showNowPlaying(null);
  } else if (d.state === 'error') {
    setStatus('❌ Ошибка: ' + (d.error || ''), 'error');
    btnStart.disabled = false; btnStop.disabled = true;
  }
}

function onError(d) {
  // Ошибки в дерево не выводим — видно только в панели 📊 (статистика)
  updateChips(d.model, false);
}

function render() {
  treeEl.innerHTML = '';
  if (!messages.size) {
    treeEl.innerHTML = '<div class="empty-hint">Здесь появится дерево обсуждения.<br>Нажми «▶ Продолжить обсуждение» — модели начнут беседу.</div>';
    return;
  }
  const root = children.get('root') || [];
  for (const m of root) renderNode(m, treeEl);
  for (const m of messages.values()) {
    if ((!m.parentId || !messages.has(m.parentId)) && !root.includes(m)) renderNode(m, treeEl);
  }
}

function renderNode(m, container) {
  const node = document.createElement('div');
  node.className = 'node' + (m.consensus ? ' consensus' : '');
  node.id = 'n-' + m.id;
  const color = colorOf(m.model);
  const p = personaMap.get(m.model);
  const name = p ? `${p.emoji} ${p.name}` : label(m.model);
  const t = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  node.innerHTML =
    `<div class="meta"><span class="badge" style="background:${color}" title="${escapeHtml(m.model)} — ${p ? p.trait : ''}">${escapeHtml(name)}</span>` +
    (p ? `<span class="p-model">${escapeHtml(label(m.model))}</span>` : '') +
    (m.consensus ? '<span class="consensus-tag">🧭 КОНСЕНСУС</span>' : '') +
    `<span class="time">${t}</span>` +
    `<button class="node-play${audioUrls.has(m.id) ? ' ready' : ''}" data-id="${m.id}" data-audio="${audioUrls.get(m.id) || ''}" title="Прослушать">▶</button></div>` +
    `<div class="body">${escapeHtml(m.text)}</div>`;
  container.appendChild(node);
  const kids = children.get(m.id);
  if (kids && kids.length) {
    const wrap = document.createElement('div');
    wrap.className = 'children';
    for (const k of kids) renderNode(k, wrap);
    container.appendChild(wrap);
  }
}

// ▶ на узле: прослушать озвучку (появляется, когда mp3 готов)
treeEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.node-play');
  if (!btn) return;
  const url = btn.dataset.audio;
  if (url) playUrl(url);
});

function updateChips(model, speaking) {
  const chips = Array.from(modelsBar.children);
  for (const c of chips) {
    if (!model || c.dataset.model === model) {
      c.classList.toggle('speaking', speaking && c.dataset.model === model);
    }
  }
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function label(model) {
  const chip = Array.from(modelsBar.children).find((c) => c.dataset.model === model);
  return chip ? chip.dataset.label : model;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

btnStart.addEventListener('click', () => {
  fetch('/api/rooms/' + roomId + '/start', { method: 'POST' }).catch(() => {});
  setStatus('🔴 Запускаю…', '');
  btnStart.disabled = true; btnStop.disabled = false;
});

btnStop.addEventListener('click', () => {
  fetch('/api/rooms/' + roomId + '/stop', { method: 'POST' }).catch(() => {});
  setStatus('⏹ Останавливаю…', '');
  btnStart.disabled = false; btnStop.disabled = true;
  updateChips(null, false);
});

// ─── Серверная озвучка ответов (нейроголоса, mp3 с сервера) ───
let ttsAuto = true, ttsRate = 1, ttsVol = 0.8;
const audioQueue = [];
let playing = false;
const audio = new Audio();

function loadTtsPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('llmf_tts') || '{}');
    if (typeof p.auto === 'boolean') ttsAuto = p.auto;
    if (p.rate) ttsRate = p.rate;
    if (typeof p.vol === 'number') ttsVol = p.vol;
    if (p.engine) $('#tts-engine').value = p.engine;
  } catch { /* ignore */ }
  $('#tts-auto').checked = ttsAuto;
  $('#tts-rate').value = String(ttsRate);
  $('#tts-vol').value = String(ttsVol);
  // сообщить серверу выбранный движок
  fetch('/api/tts/engine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: $('#tts-engine').value }),
  }).catch(() => {});
}
function saveTtsPrefs() {
  localStorage.setItem('llmf_tts', JSON.stringify({ auto: ttsAuto, rate: ttsRate, vol: ttsVol, engine: $('#tts-engine').value }));
}
loadTtsPrefs();

$('#tts-auto').addEventListener('change', () => { ttsAuto = $('#tts-auto').checked; saveTtsPrefs(); });
$('#tts-rate').addEventListener('change', () => { ttsRate = parseFloat($('#tts-rate').value); audio.playbackRate = ttsRate; saveTtsPrefs(); });
$('#tts-vol').addEventListener('change', () => { ttsVol = parseFloat($('#tts-vol').value); audio.volume = ttsVol; saveTtsPrefs(); });
$('#tts-engine').addEventListener('change', () => {
  saveTtsPrefs();
  fetch('/api/tts/engine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: $('#tts-engine').value }),
  }).catch(() => {});
});

function msgByUrl(url) {
  if (!url) return null;
  return messages.get(url.split('/').pop().replace(/\.mp3$/, '')) || null;
}

let nowIndex = -1;
const audioList = () => Array.from(messages.values()).filter((m) => audioUrls.has(m.id)).sort((a, b) => a.ts - b.ts);

function showNowPlaying(msg) {
  const el = $('#now-playing');
  if (!msg) { el.classList.add('hidden'); return; }
  const color = colorOf(msg.model);
  const p = personaMap.get(msg.model);
  nowIndex = audioList().findIndex((m) => m.id === msg.id);
  el.innerHTML =
    `<div class="np-meta"><span class="badge" style="background:${color}">${escapeHtml(p ? `${p.emoji} ${p.name}` : label(msg.model))}</span>🎙 говорит…</div>` +
    (p ? `<div class="np-who">${escapeHtml(label(msg.model))} · ${escapeHtml(p.trait)}</div>` : '') +
    `<div class="np-text">${escapeHtml(String(msg.text))}</div>` +
    `<div class="np-nav"><button id="np-prev" title="Предыдущее сообщение">◀ Пред.</button><button id="np-next" title="Следующее сообщение">След. ▶</button></div>`;
  el.classList.remove('hidden');
  el.querySelector('#np-prev').onclick = () => {
    const l = audioList();
    if (!l.length) return;
    const i = (nowIndex - 1 + l.length) % l.length;
    playUrl(audioUrls.get(l[i].id));
  };
  el.querySelector('#np-next').onclick = () => {
    const l = audioList();
    if (!l.length) return;
    const i = (nowIndex + 1) % l.length;
    playUrl(audioUrls.get(l[i].id));
  };
}

function playNext() {
  if (playing || !audioQueue.length) return;
  playing = true;
  const url = audioQueue.shift();
  audio.src = url;
  audio.playbackRate = ttsRate;
  audio.volume = ttsVol;
  showNowPlaying(msgByUrl(url)); // окошко: копия сообщения, которое сейчас проигрывается
  audio.play().catch(() => {
    // Автоплей заблокирован (нужен жест) — не умираем: вернёмся к очереди позже
    playing = false;
    setTimeout(playNext, 1000);
  });
  audio.onended = () => {
    playing = false;
    if (audioQueue.length) playNext();
    else showNowPlaying(null);
  };
}

// Разблокировка автовоспроизведения: Chrome разрешает звук после первого клика по странице.
// Прогреваем audio-элемент тишиной при первом клике — но НЕ мешаем уже идущему воспроизведению
// (иначе клики по кнопкам окошка «След./Пред.» сбивали бы текущий трек).
function unlockAudio() {
  if (!audio.src || audio.src.startsWith('data:') || !audio.paused) return;
  const prev = audio.src;
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  audio.volume = 0;
  audio.play().then(() => { audio.pause(); audio.volume = ttsVol; audio.src = prev; }).catch(() => { audio.src = prev; });
}
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

function enqueueAudio(url) {
  if (!ttsAuto || !url) return;
  audioQueue.push(url);
  playNext();
}

function playUrl(url) {
  if (!url) return;
  audioQueue.length = 0; // ручное прослушивание — авто-очередь сбрасываем
  audio.src = url;
  audio.playbackRate = ttsRate;
  audio.volume = ttsVol;
  showNowPlaying(msgByUrl(url));
  audio.onended = () => {
    playing = false;
    if (audioQueue.length) playNext();
    else showNowPlaying(null);
  };
  audio.play().catch(() => {});
}

function onAudio(d) {
  if (d.roomId && d.roomId !== roomId) return;
  const node = document.getElementById('n-' + d.msgId);
  if (node) {
    const btn = node.querySelector('.node-play');
    if (btn) { btn.dataset.audio = d.url; btn.classList.add('ready'); }
  }
  enqueueAudio(d.url); // авто: говорить по мере ответов (по очереди)
}

$('#btn-tts').addEventListener('click', () => {
  $('#tts-bar').classList.toggle('hidden');
});

// ─── Статистика по моделям ───
const statsPanel = $('#stats-panel'), statsBody = $('#stats-body'), statsSummary = $('#stats-summary');
let statsTimer = null;
const STATE_TEXT = {
  thinking: '💭 думает',
  waiting: '⏳ ждёт раунда',
  error: '⚠️ сбой хода',
  idle: '⏸ остановлена',
};
const STATE_REASON = {
  waiting: 'ждёт, пока остальные закончат раунд',
  idle: 'комната остановлена',
  error: 'сбой запроса (попытка повтора была)',
};

function fmtSec(ms) {
  if (!ms) return '—';
  const s = ms / 1000;
  return s < 60 ? s.toFixed(1) + ' с' : Math.floor(s / 60) + ' мин ' + Math.round(s % 60) + ' с';
}

function renderStats() {
  fetch('/api/rooms/' + roomId + '/stats').then((r) => r.json()).then((d) => {
    const models = d.models || [];
    const thinking = models.filter((m) => m.state === 'thinking');
    const done = models.filter((m) => m.answers > 0);
    statsSummary.textContent = d.running
      ? `думает: ${thinking.length ? thinking.map((m) => label(m.model)).join(', ') : 'никто'} · ответили ${done.length}/${models.length}`
      : 'комната остановлена';
    statsBody.innerHTML = '';
    const rows = [...models].sort((a, b) => (a.state === 'thinking' ? -1 : 1) - (b.state === 'thinking' ? -1 : 1));
    for (const m of rows) {
      const color = colorOf(m.model);
      const row = document.createElement('div');
      row.className = 'stats-row';
      const stateText = m.state === 'thinking'
        ? `💭 думает ${fmtSec(m.thinkingMs)}`
        : STATE_TEXT[m.state] || m.state;
      const reason = m.state === 'thinking' ? '' : ` — ${STATE_REASON[m.state] || ''}`;
      const avg = m.answers ? fmtSec(m.totalMs / m.answers) : '—';
      row.innerHTML =
        `<div class="s-model"><span class="badge" style="background:${color}">${escapeHtml(label(m.model))}</span>${escapeHtml(label(m.model))}</div>` +
        `<div class="s-state ${m.state}">${escapeHtml(stateText)}<span style="color:#4d5566">${escapeHtml(reason)}</span></div>` +
        `<div class="s-num">${m.answers}</div>` +
        `<div class="s-num">${avg}</div>`;
      statsBody.appendChild(row);
    }
  }).catch(() => {});
}

$('#btn-stats').addEventListener('click', () => {
  const show = statsPanel.classList.toggle('hidden');
  if (!show) {
    renderStats();
    statsTimer = setInterval(renderStats, 2000);
  } else if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
});
