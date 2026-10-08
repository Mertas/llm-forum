// БД форума: комнаты и сообщения (better-sqlite3, как в BabyDiary).
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { personaFor } from './personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'forum.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  running INTEGER NOT NULL DEFAULT 0,
  participants TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  parent_id TEXT,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  consensus INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, ts);
`);

export function createRoom({ topic, participants }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  db.prepare('INSERT INTO rooms (id, topic, created, updated, running, participants) VALUES (?, ?, ?, ?, 0, ?)')
    .run(id, topic || '', now, now, JSON.stringify(participants || []));
  return getRoom(id);
}

export function getRoom(id) {
  const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!r) return null;
  r.participants = JSON.parse(r.participants || '[]');
  r.messages = db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY ts ASC').all(id)
    .map((m) => ({ id: m.id, parentId: m.parent_id, model: m.model, text: m.text, ts: m.ts, consensus: !!m.consensus }));
  return r;
}

export function listRooms() {
  return db.prepare('SELECT id, topic, created, updated, running FROM rooms ORDER BY updated DESC').all()
    .map((r) => ({ ...r, count: db.prepare('SELECT COUNT(*) c FROM messages WHERE room_id = ?').get(r.id).c }));
}

export function setRoomRunning(id, running) {
  db.prepare('UPDATE rooms SET running = ?, updated = ? WHERE id = ?').run(running ? 1 : 0, Date.now(), id);
}

export function touchRoom(id) {
  db.prepare('UPDATE rooms SET updated = ? WHERE id = ?').run(Date.now(), id);
}

export function setRoomTopic(id, topic) {
  db.prepare('UPDATE rooms SET topic = ? WHERE id = ?').run(topic, id);
}

export function addMessage(roomId, msg) {
  db.prepare('INSERT INTO messages (id, room_id, parent_id, model, text, ts, consensus) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(msg.id, roomId, msg.parentId, msg.model, msg.text, msg.ts, msg.consensus ? 1 : 0);
  touchRoom(roomId);
}

/** Сообщения комнаты в компактном виде для промпта. */
export function treeText(room, maxChars = 7000) {
  const lines = [];
  const byId = new Map(room.messages.map((m) => [m.id, m]));
  const depthOf = (id) => {
    let d = 0, cur = id;
    const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); d++; cur = byId.get(cur)?.parentId || null; }
    return d;
  };
  for (const m of room.messages) {
    const d = depthOf(m.id);
    const p = personaFor(m.model);
    const who = p ? `${p.name} (${m.model})` : m.model;
    lines.push(`${'  '.repeat(Math.max(0, d - 1))}• [${m.id}] ${who}: ${String(m.text).slice(0, 240)}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(-maxChars);
  return out;
}
