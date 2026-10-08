// Серверная озвучка ответов: edge-tts (Microsoft Neural, русские голоса),
// у каждой модели свой голос + интонации (rate/pitch/volume). Очередь — по одному.
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { personaFor } from './personas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ttsDir = path.join(__dirname, '../data/tts');

const VOICES = ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural']; // edge: женский / мужской
// Вариативность: по 6-7 вариантов скорости/тона/громкости — у каждой личности свой тембр
const RATES = ['+0%', '+10%', '+18%', '-6%', '+6%', '-12%', '+14%'];
const PITCHES = ['+0Hz', '+5Hz', '-4Hz', '+9Hz', '+12Hz', '-8Hz', '+3Hz'];
const VOLUMES = ['+10%', '+15%', '+5%', '+20%', '+0%'];
const MAX_CHUNK = 1200; // edge-tts: один запрос до ~1500 символов — длиннее режем на чанки

// Piper (локальный нейро-TTS, офлайн): русские голоса по полу
const PIPER_DIR = path.join(__dirname, '../data/piper');
const PIPER_FEMALE = ['ru_RU-irina-medium.onnx'];
const PIPER_MALE = ['ru_RU-denis-medium.onnx', 'ru_RU-ruslan-medium.onnx', 'ru_RU-dmitri-medium.onnx'];
const PIPER_LENGTH = ['1.05', '0.95', '1.0', '0.9', '1.15', '0.85']; // длина слога (скорость речи)

// Silero v5 (локальный нейро-TTS, лучший русский, torch CPU)
const SILERO_DIR = path.join(__dirname, '../data/silero');
const SILERO_MODEL = path.join(SILERO_DIR, 'v5_ru.pt');
const SILERO_FEMALE = ['xenia', 'kseniya', 'baya']; // ж/ж/ж
const SILERO_MALE = ['aidar', 'eugene']; // м/м
const CHUNK_MARK = '===CHUNK===';

let engine = 'edge'; // 'edge' | 'silero' | 'piper'
export function setEngine(e) { if (e === 'edge' || e === 'silero' || e === 'piper') engine = e; }
export function getEngine() { return engine; }

const queue = [];
let busy = false;
let onAudio = null; // callback: (roomId, msgId, url)

export function setAudioCallback(cb) { onAudio = cb; }

/** Выбросить из очереди все задачи комнаты (при её остановке) —
 *  иначе хвост остановленной комнаты блокирует озвучку новых комнат. */
export function cancelRoom(roomId) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].roomId === roomId) queue.splice(i, 1);
  }
}

export function queueTts(roomId, msg) {
  if (!msg.text) return;
  queue.push({ roomId, msg });
  pump();
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('python', args, { timeout: 60000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 120000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  try {
    const url = await generate(job.roomId, job.msg);
    if (onAudio && url) onAudio(job.roomId, job.msg.id, url);
  } catch (e) {
    console.error('[tts]', e.message.slice(0, 120));
  }
  busy = false;
  pump();
}

async function generate(roomId, msg) {
  const dir = path.join(ttsDir, roomId);
  fs.mkdirSync(dir, { recursive: true });
  const hash = hashCode(msg.model);
  // Пол личности → пол голоса (женские имена — женские голоса и наоборот)
  const persona = personaFor(msg.model);
  const female = persona.gender === 'ж';
  const voice = female ? VOICES[0] : VOICES[1]; // Svetlana / Dmitry
  // Вариативность: скорость/тон/громкость — разные у каждой личности
  const rate = RATES[hash % RATES.length];
  const pitch = PITCHES[(hash >> 2) % PITCHES.length];
  const volume = VOLUMES[(hash >> 4) % VOLUMES.length];
  const text = String(msg.text).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const out = path.join(dir, msg.id + '.mp3');
  const chunks = chunkText(text);
  if (engine === 'silero') {
    await generateSilero(dir, msg.id, chunks, hash, female, out);
  } else if (engine === 'piper') {
    await generatePiper(dir, msg.id, chunks, hash, female, out);
  } else {
    await generateEdge(dir, msg.id, chunks, hash, voice, rate, pitch, volume, out);
  }
  return '/tts/' + roomId + '/' + msg.id + '.mp3';
}

/** Генерация через Silero v5 (локально, torch CPU): модель грузится 1 раз на все чанки. */
async function generateSilero(dir, msgId, chunks, hash, female, out) {
  const pool = female ? SILERO_FEMALE : SILERO_MALE;
  const speaker = pool[hash % pool.length];
  const inFile = path.join(dir, msgId + '.txt');
  fs.writeFileSync(inFile, chunks.join('\n' + CHUNK_MARK + '\n'), 'utf8');
  const base = path.join(dir, msgId + '.part');
  await run([path.join(__dirname, 'tts_silero.py'), '--model', SILERO_MODEL, '--text-file', inFile, '--speaker', speaker,
    '--multi', '--out', base]);
  fs.unlinkSync(inFile);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const p = base + i + '.wav';
    if (fs.existsSync(p)) parts.push(p);
  }
  if (parts.length === 1) {
    await runFfmpeg(['-y', '-i', parts[0], '-codec:a', 'libmp3lame', '-qscale:a', '4', out]);
    fs.unlinkSync(parts[0]);
  } else if (parts.length > 1) {
    const listFile = path.join(dir, msgId + '.list.txt');
    fs.writeFileSync(listFile, parts.map((p) => "file '" + p.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
    const merged = path.join(dir, msgId + '.merged.wav');
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', merged]);
    fs.unlinkSync(listFile);
    for (const p of parts) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
    await runFfmpeg(['-y', '-i', merged, '-codec:a', 'libmp3lame', '-qscale:a', '4', out]);
    fs.unlinkSync(merged);
  }
}

/** Генерация через edge-tts (Microsoft Neural, облако). */
async function generateEdge(dir, msgId, chunks, hash, voice, rate, pitch, volume, out) {
  if (chunks.length === 1) {
    const tmpTxt = path.join(dir, msgId + '.txt');
    fs.writeFileSync(tmpTxt, chunks[0], 'utf8');
    await run(['-m', 'edge_tts', '--voice', voice, '--rate=' + rate, '--pitch=' + pitch,
      '--volume=' + volume, '--file', tmpTxt, '--write-media', out]);
    fs.unlinkSync(tmpTxt);
  } else {
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const tmpTxt = path.join(dir, msgId + '.' + i + '.txt');
      const part = path.join(dir, msgId + '.' + i + '.mp3');
      fs.writeFileSync(tmpTxt, chunks[i], 'utf8');
      await run(['-m', 'edge_tts', '--voice', voice, '--rate=' + rate, '--pitch=' + pitch,
        '--volume=' + volume, '--file', tmpTxt, '--write-media', part]);
      fs.unlinkSync(tmpTxt);
      parts.push(part);
    }
    const listFile = path.join(dir, msgId + '.list.txt');
    fs.writeFileSync(listFile, parts.map((p) => "file '" + p.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out]);
    fs.unlinkSync(listFile);
    for (const p of parts) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
  }
}

/** Генерация через Piper (локально, офлайн): чанки → wav → склейка → mp3. */
async function generatePiper(dir, msgId, chunks, hash, female, out) {
  const pool = female ? PIPER_FEMALE : PIPER_MALE;
  const voice = pool[hash % pool.length];
  const lengthScale = PIPER_LENGTH[(hash >> 2) % PIPER_LENGTH.length];
  const modelPath = path.join(PIPER_DIR, voice);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const tmpTxt = path.join(dir, msgId + '.' + i + '.txt');
    const part = path.join(dir, msgId + '.' + i + '.wav');
    fs.writeFileSync(tmpTxt, chunks[i], 'utf8');
    await run(['-m', 'piper', '-m', modelPath, '-i', tmpTxt, '-f', part, '--length-scale', lengthScale]);
    fs.unlinkSync(tmpTxt);
    parts.push(part);
  }
  if (parts.length === 1) {
    await runFfmpeg(['-y', '-i', parts[0], '-codec:a', 'libmp3lame', '-qscale:a', '4', out]);
    fs.unlinkSync(parts[0]);
  } else {
    const listFile = path.join(dir, msgId + '.list.txt');
    fs.writeFileSync(listFile, parts.map((p) => "file '" + p.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
    const merged = path.join(dir, msgId + '.merged.wav');
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', merged]);
    fs.unlinkSync(listFile);
    for (const p of parts) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
    await runFfmpeg(['-y', '-i', merged, '-codec:a', 'libmp3lame', '-qscale:a', '4', out]);
    fs.unlinkSync(merged);
  }
}

/** Разбить длинный текст на чанки по границам предложений. */
function chunkText(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const parts = [];
  let cur = '';
  const sents = text.split(/(?<=[.!?…])\s+/);
  for (const sent of sents) {
    if (cur && (cur + ' ' + sent).length > MAX_CHUNK) {
      parts.push(cur);
      cur = sent;
    } else {
      cur = cur ? cur + ' ' + sent : sent;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Очистка старых mp3 при старте сервера. */
export function cleanTts() {
  try { fs.rmSync(ttsDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
