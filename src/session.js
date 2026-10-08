// Сеанс комнаты: ВСЕ модели отвечают параллельно каждый раунд, без ограничений
// на число сообщений и раундов. Остановка: кнопка Стоп или consensus модели.
import { clientFor, clientForModel, resolveModelId, supportsJsonMode, getAvailableModels, providerInfo } from './models.js';
import { getRoom, setRoomRunning, setRoomTopic, addMessage, treeText } from './db.js';
import { personaFor } from './personas.js';

const TURN_TIMEOUT = 90000; // таймаут одного хода (1.5 мин) + авто-ретрай
const PAUSE_MS = 700;

const runningRooms = new Map(); // roomId -> true (стоп-флаг)
// Статистика по моделям комнаты: model -> {state, thinkingSince, answers, totalMs}
const roomStats = new Map();

function statsFor(roomId) {
  if (!roomStats.has(roomId)) roomStats.set(roomId, new Map());
  return roomStats.get(roomId);
}

function statSet(roomId, model, patch) {
  const m = statsFor(roomId);
  if (!m.has(model)) m.set(model, { state: 'idle', thinkingSince: 0, answers: 0, totalMs: 0 });
  Object.assign(m.get(model), patch);
}

export function getRoomStats(roomId) {
  const m = statsFor(roomId);
  const out = [];
  for (const [model, s] of m) {
    out.push({ model, ...s, thinkingMs: s.state === 'thinking' ? Date.now() - s.thinkingSince : 0 });
  }
  return out;
}

export function isRoomRunning(id) { return !!runningRooms.get(id); }

export function stopRoom(id) {
  const was = runningRooms.get(id);
  runningRooms.set(id, false);
  const room = getRoom(id);
  if (room && was) setRoomRunning(id, false);
  if (room) for (const p of room.participants) statSet(id, p, { state: 'idle', thinkingSince: 0 });
  return !!was;
}

export function getParticipants(roomId) {
  const room = getRoom(roomId);
  return room ? room.participants : [];
}

/** Один ход модели: вернуть {parentId, text} | {consensus, text} | {error} */
async function askModel(model, room, snapshot) {
  const persona = personaFor(model);
  const cast = room.participants
    .map((m) => { const p = personaFor(m); return `${p.name} (${p.trait})`; })
    .join(', ');
  const sys =
    'Ты — участник круглого стола ИИ. У тебя есть ЛИЧНОСТЬ, веди себя соответственно:\n' +
    `Ты — ${persona.name} (${persona.trait}) ${persona.emoji}.\n` +
    `${persona.persona}\n` +
    `Стиль речи: ${persona.style}.\n` +
    (persona.likes?.length ? `Симпатии: ${persona.likes.join(', ')}. Относишься к ним тепло, поддерживаешь.\n` : '') +
    (persona.dislikes?.length ? `Антипатии: ${persona.dislikes.join(', ')}. Подкалываешь их, не соглашаешься без причины.\n` : '') +
    '\nЗа круглым столом (все знают друг друга): ' + cast + '.\n' +
    'Ваша цель — совместно обсудить тему, развивать идеи друг друга, спорить и прийти к интересному выводу. ' +
    'Отвечай СТРОГО одним JSON-объектом без текста вне него: ' +
    '{"parentId": "<id сообщения, на которое отвечаешь>", "text": "твой ответ (1-4 предложения)"} ' +
    'parentId — обязательно id существующего сообщения из списка ниже (или "root" — если продолжаешь тему в новой ветке). ' +
    'Не повторяй сказанное, добавляй новое. Обращайся к собеседникам по именам (например: «Согласен с Марфой», «Аристарх, ты как всегда придираешься»). ' +
    `Твоё имя — ${persona.name}. НЕ обращайся к самому себе и не цитируй себя; отвечай другим участникам.`;
  const user =
    `ТЕМА: ${room.topic}\n\nДЕРЕВО ОБСУЖДЕНИЯ:\n${snapshot || '(пока пусто — ты открываешь обсуждение, отвечай на "root")'}\n\n` +
    `Твоя модель: ${model} (${providerInfo(model).label}). Ты ходишь сейчас.`;
  const client = await clientForModel(model);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TURN_TIMEOUT);
  try {
    const res = await client.chat.completions.create(
      {
        model: resolveModelId(model),
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        stream: false,
        max_tokens: 1200,
        temperature: 0.9,
        response_format: supportsJsonMode(model) ? { type: 'json_object' } : undefined,
      },
      {
        signal: ac.signal,
        // Yandex Cloud: API-ключ требует идентификатор каталога
        headers: model.startsWith('yandex/') && process.env.YANDEX_FOLDER_ID ? { 'x-folder-id': process.env.YANDEX_FOLDER_ID } : undefined,
      },
    );
    const raw = res.choices[0]?.message?.content || '';
    return parseTurn(raw, ['root', ...room.messages.map((m) => m.id)]);
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 100) };
  } finally {
    clearTimeout(timer);
  }
}

/** Ход с одним ретраем при сбое/таймауте (>5 минут). */
async function askModelWithRetry(model, room, snapshot) {
  const first = await askModel(model, room, snapshot);
  if (!first.error || !runningRooms.get(room.id)) return first;
  await new Promise((r) => setTimeout(r, 2000));
  return askModel(model, room, snapshot);
}

function parseTurn(raw, parentCandidates) {
  let text = String(raw).trim();
  // Незакрытый <think> = оборванный reasoning-ответ (модель не успела закончить) — ход невалиден
  if (text.includes('<think') && !text.includes('</think>')) {
    return { parentId: 'root', text: '' };
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Модели иногда экранируют кавычки (JSON внутри JSON): {\"parentId\": ...} — снимаем экранирование
  const variants = [text];
  if (text.includes('\\"')) {
    variants.push(text.split('\\"').join('"').split('\\n').join('\n'));
  }
  for (const t of variants) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const p = JSON.parse(m[0]);
        const out = {};
        if (p.consensus) out.consensus = true;
        out.parentId = parentCandidates.includes(p.parentId) ? p.parentId : 'root';
        out.text = String(p.text || p.message || '').trim();
        return out;
      } catch { /* битый JSON — regex-экстракция */ }
    }
    const pid = t.match(/"parentId"\s*:\s*"([^"]*)"/);
    const txt = t.match(/"text"\s*:\s*"([^"]*)"/);
    if (txt) {
      return {
        parentId: pid && parentCandidates.includes(pid[1]) ? pid[1] : 'root',
        text: txt[1].replace(/\\n/g, '\n').trim(),
        consensus: /"consensus"\s*:\s*true/.test(t),
      };
    }
  }
  return { parentId: 'root', text: text.slice(0, 300).trim() };
}

/** Предложить тему: случайная модель. */
export async function proposeTopic(onEvent) {
  const models = getAvailableModels();
  const model = models[Math.floor(Math.random() * models.length)].id;
  try { onEvent('thinking', { model, phase: 'topic' }); } catch { /* noop */ }
  const sys = 'Ты — генератор тем. Предложи одну интересную, дискуссионную и небанальную тему для круглого стола ИИ-ассистентов (философия, наука, технологии, общество, будущее). Ответь ТОЛЬКО текстом темы, 1-2 предложения, без кавычек.';
  try {
    const client = clientFor(model);
    const res = await client.chat.completions.create({
      model: resolveModelId(model),
      messages: [{ role: 'system', content: sys }, { role: 'user', content: 'Предложи тему.' }],
      stream: false, max_tokens: 120, temperature: 1.0,
    });
    const topic = (res.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    try { onEvent('topic', { model, topic }); } catch { /* noop */ }
    return { model, topic };
  } catch (e) {
    const topic = 'Что делает нас людьми, а не просто разумными машинами?';
    try { onEvent('topic', { model, topic }); } catch { /* noop */ }
    return { model, topic };
  }
}

/** Запустить обсуждение комнаты. У КАЖДОЙ модели свой непрерывный цикл:
 *  ответила → сразу берёт свежее дерево → генерирует следующий ответ (не ждёт раунда).
 *  Остановка: stopRoom / consensus любой модели. */
export async function runRoom(roomId, onEvent) {
  const room = getRoom(roomId);
  if (!room || runningRooms.get(roomId)) return;
  if (!room.topic) {
    const t = await proposeTopic((type, data) => onEvent(type, { roomId, ...data }));
    room.topic = t.topic;
    setRoomTopic(roomId, t.topic); // сохранить тему в БД
  }
  runningRooms.set(roomId, true);
  setRoomRunning(roomId, true);
  onEvent('status', { roomId, state: 'running', topic: room.topic });
  // Статистика: состояния сбрасываем, накопленные ответы/время сохраняем
  for (const p of room.participants) statSet(roomId, p, { state: 'waiting', thinkingSince: 0 });

  try {
    const loop = async (model) => {
      while (runningRooms.get(roomId)) {
        const fresh = getRoom(roomId);
        const snapshot = treeText(fresh);
        onEvent('thinking', { roomId, model, round: fresh.messages.length + 1 });
        statSet(roomId, model, { state: 'thinking', thinkingSince: Date.now() });
        const res = await askModelWithRetry(model, fresh, snapshot);
        if (!runningRooms.get(roomId)) break;
        if (res.error) {
          console.log('[loop]', model, '->', res.error);
          statSet(roomId, model, { state: 'error' });
          onEvent('error', { roomId, model, error: res.error });
          // Rate-limit/бан (429/402/403) — лимит не спадает за 8 секунд: ждём подольше, не спамим
          const limited = /429|402|403|rate limit|too many|forbidden/i.test(res.error);
          await new Promise((r) => setTimeout(r, limited ? 30000 : 8000));
          continue;
        }
        if (!res.text) {
          statSet(roomId, model, { state: 'waiting' });
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const msg = {
          id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          parentId: res.parentId === 'root' ? null : res.parentId,
          model,
          text: res.text,
          ts: Date.now(),
          consensus: !!res.consensus,
        };
        addMessage(roomId, msg);
        const s = statsFor(roomId).get(model) || {};
        statSet(roomId, model, {
          state: 'waiting', thinkingSince: 0,
          answers: (s.answers || 0) + 1,
          totalMs: (s.totalMs || 0) + Math.max(0, Date.now() - (s.thinkingSince || Date.now())),
        });
        onEvent('msg', { roomId, ...msg });
        await new Promise((r) => setTimeout(r, 1500)); // небольшая пауза между ходами модели
      }
    };
    await Promise.allSettled(room.participants.map((m) => loop(m)));
  } finally {
    runningRooms.set(roomId, false);
    setRoomRunning(roomId, false);
    onEvent('status', { roomId, state: 'done', count: getRoom(roomId).messages.length });
  }
}
