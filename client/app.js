// LLM Forum — главная: список комнат + создание.
const $ = (s) => document.querySelector(s);
const roomsEl = $('#rooms'), topicInput = $('#topic');

let allModels = [];
fetch('/api/models').then((r) => r.json()).then((d) => { allModels = d.models || []; }).catch(() => {});

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderRooms(rooms) {
  roomsEl.innerHTML = '';
  if (!rooms.length) {
    roomsEl.innerHTML = '<div class="empty-hint">Пока нет комнат. Создайте первую — модели сами выберут тему и начнут обсуждение.</div>';
    return;
  }
  for (const r of rooms) {
    const card = document.createElement('a');
    card.className = 'room-card';
    card.href = '/room/' + r.id;
    const status = r.running ? '<span class="live">🔴 идёт</span>' : '<span class="idle">⏸ остановлена</span>';
    card.innerHTML =
      `<div class="room-head"><span class="room-topic">${escapeHtml(r.topic || '(тема ещё не выбрана)')}</span>${status}</div>` +
      `<div class="room-meta">💬 ${r.count} сообщений · создана ${fmtTime(r.created)} · обновлена ${fmtTime(r.updated)}</div>`;
    roomsEl.appendChild(card);
  }
}

function loadRooms() {
  fetch('/api/rooms').then((r) => r.json()).then((d) => renderRooms(d.rooms || [])).catch(() => {
    roomsEl.innerHTML = '<div class="empty-hint">Не удалось загрузить комнаты</div>';
  });
}
loadRooms();
setInterval(loadRooms, 10000); // авто-обновление списка

$('#btn-create').addEventListener('click', () => {
  const topic = topicInput.value.trim();
  const paidOn = $('#paid').checked;
  const models = allModels.filter((m) => m.paid && !paidOn ? false : true).map((m) => m.id);
  $('#btn-create').disabled = true;
  fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, models }),
  }).then((r) => r.json()).then((d) => {
    location.href = '/room/' + d.id;
  }).catch(() => { $('#btn-create').disabled = false; });
});

$('#btn-random').addEventListener('click', () => {
  $('#btn-random').disabled = true;
  fetch('/api/topic', { method: 'POST' }).then((r) => r.json()).then((d) => {
    if (d.topic) topicInput.value = d.topic;
    $('#btn-random').disabled = false;
  }).catch(() => { $('#btn-random').disabled = false; });
});

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
