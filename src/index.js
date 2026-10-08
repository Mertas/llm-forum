// LLM Forum — комнаты: на разных страницах идут разные обсуждения, всё в SQLite.
// Порт 3106. Структура как в BabyDiary: src/server-модули, data/*.db.
import 'dotenv/config'; // явно: PORT и ключи моделей из .env
import express from 'express';
import http from 'http';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAvailableModels } from './models.js';
import { createRoom, getRoom, listRooms, setRoomRunning } from './db.js';
import { runRoom, stopRoom, isRoomRunning, proposeTopic, getRoomStats } from './session.js';
import { queueTts, setAudioCallback, cancelRoom, setEngine, getEngine } from './tts.js';
import { PERSONAS, personaFor } from './personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3106;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../client')));
app.use('/tts', express.static(path.join(__dirname, '../data/tts')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Страница комнаты: /room/<id>
app.get('/room/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/room.html'));
});

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
function broadcast(type, data) {
  const msg = JSON.stringify({ type, ...data });
  for (const c of clients) { try { c.send(msg); } catch { /* ignore */ } }
}

// Озвучка: при каждом новом сообщении генерируем mp3 в фоне и шлём URL
setAudioCallback((roomId, msgId, url) => broadcast('audio', { roomId, msgId, url }));

app.get('/api/models', (_req, res) => res.json({ models: getAvailableModels() }));

// Движок озвучки: edge (облако Microsoft) | piper (локально, офлайн)
app.get('/api/tts/engine', (_req, res) => res.json({ engine: getEngine() }));
app.post('/api/tts/engine', (req, res) => {
  const { engine: e } = req.body || {};
  setEngine(e);
  res.json({ engine: getEngine() });
});

// ─── Комнаты ───
app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: listRooms().map((r) => ({ ...r, running: isRoomRunning(r.id) || !!r.running })) });
});

app.post('/api/rooms', (req, res) => {
  const { topic, models } = req.body || {};
  const participants = (Array.isArray(models) && models.length ? models : getAvailableModels().map((m) => m.id))
    .filter((m) => getAvailableModels().some((x) => x.id === m));
  const room = createRoom({ topic: topic || '', participants });
  res.json({ id: room.id, topic: room.topic, participants: room.participants });
  // Цикл в фоне + озвучка каждого ответа
  const onEvt = (type, data) => {
    broadcast(type, data);
    if (type === 'msg') queueTts(data.roomId, data);
    // Комната завершила цикл (консенсус/ошибка) — её хвост озвучки не нужен
    if (type === 'status' && (data.state === 'done' || data.state === 'error')) cancelRoom(data.roomId);
  };
  runRoom(room.id, onEvt).catch((e) =>
    broadcast('status', { roomId: room.id, state: 'error', error: String(e).slice(0, 150) }));
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'no room' });
  // Готовые озвучки (mp3) — для ▶-кнопок после перезагрузки страницы
  const audio = {};
  try {
    const dir = path.join(__dirname, '../data/tts', req.params.id);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.mp3')) audio[f.replace(/\.mp3$/, '')] = '/tts/' + req.params.id + '/' + f;
      }
    }
  } catch { /* ignore */ }
  res.json({
    id: room.id, topic: room.topic, messages: room.messages,
    participants: room.participants.map((p) => ({ id: p, persona: personaFor(p) })),
    running: isRoomRunning(room.id), audio,
  });
});

app.get('/api/rooms/:id/stats', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'no room' });
  res.json({ running: isRoomRunning(room.id), models: getRoomStats(req.params.id) });
});

app.post('/api/rooms/:id/stop', (req, res) => {
  cancelRoom(req.params.id); // стоп: не догенериваем mp3 остановленной комнаты
  res.json({ stopped: stopRoom(req.params.id) });
});

app.post('/api/rooms/:id/start', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'no room' });
  if (!isRoomRunning(room.id)) {
    const onEvt = (type, data) => {
      broadcast(type, data);
      if (type === 'msg') queueTts(data.roomId, data);
      if (type === 'status' && (data.state === 'done' || data.state === 'error')) cancelRoom(data.roomId);
    };
    runRoom(room.id, onEvt).catch((e) =>
      broadcast('status', { roomId: room.id, state: 'error', error: String(e).slice(0, 150) }));
  }
  res.json({ running: true });
});

// ─── Тема от модели (для поля ввода) ───
app.post('/api/topic', async (_req, res) => {
  const t = await proposeTopic(broadcast);
  res.json(t);
});

// При старте: все «running» комнаты в БД — помечаем остановленными (процесс умер)
for (const r of listRooms()) {
  if (r.running) setRoomRunning(r.id, false);
}
// cleanTts() убран: после рестарта сервера mp3 остановленных комнат остаются,
// и ▶-кнопки у старых сообщений не пропадают (перегенерации всё равно не будет).

server.listen(PORT, () => {
  console.log(`LLM Forum running at http://localhost:${PORT}`);
});
