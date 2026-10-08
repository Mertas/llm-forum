// Реестр LLM-моделей для форума. Ключи — из .env (скопирован из BabyDiary).
import OpenAI from 'openai';
import 'dotenv/config';

const LLM_TIMEOUT = 120000;

const providers = [
  {
    prefix: 'deepseek/', baseURL: process.env.DEEPSEEK_BASE_URL, apiKey: process.env.DEEPSEEK_API_KEY,
    models: [
      { id: 'deepseek/' + (process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'), label: 'DeepSeek Pro', paid: true },
      { id: 'deepseek/' + (process.env.DEEPSEEK_FLASH_MODEL || 'deepseek-v4-flash'), label: 'DeepSeek Flash', paid: true },
      { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek Reasoner', paid: true },
    ],
  },
  // OVH: анонимный тир ЗАКРЫТ 2026-08 (403 authentication failed, требует OAuth-ключ kepler.ai) — отключено
  // {
  //   prefix: 'ovh/', baseURL: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', apiKey: 'always', jsonMode: false,
  //   models: [
  //     { id: 'ovh/Qwen3-32B', label: 'OVH Qwen3 32B' },
  //     { id: 'ovh/Meta-Llama-3_3-70B-Instruct', label: 'OVH Llama 3.3 70B' },
  //     { id: 'ovh/gpt-oss-120b', label: 'OVH GPT-OSS 120B' },
  //     { id: 'ovh/Qwen3.5-9B', label: 'OVH Qwen3.5 9B' },
  //     { id: 'ovh/gpt-oss-20b', label: 'OVH GPT-OSS 20B' },
  //     { id: 'ovh/Mistral-7B-Instruct-v0.3', label: 'OVH Mistral 7B' },
  //     { id: 'ovh/Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral Small 24B' },
  //     { id: 'ovh/Mistral-Nemo-Instruct-2407', label: 'OVH Mistral Nemo 12B' },
  //     { id: 'ovh/Qwen3.6-27B', label: 'OVH Qwen3.6 27B' },
  //     { id: 'ovh/Qwen3.5-397B-A17B', label: 'OVH Qwen3.5 397B' },
  //     { id: 'ovh/Qwen3-Coder-30B-A3B-Instruct', label: 'OVH Qwen3 Coder 30B' },
  //   ],
  // },
  {
    prefix: 'pollinations/', baseURL: 'https://text.pollinations.ai/openai', apiKey: 'always', jsonMode: false,
    models: [{ id: 'pollinations/openai', label: 'Pollinations GPT-5 Mini' }],
  },
  {
    prefix: 'aion/', baseURL: 'https://api.aionlabs.ai/v1', apiKey: process.env.AION_API_KEY,
    models: [
      { id: 'aion/aion-labs/aion-3.0-mini', label: 'Aion 3.0 Mini' },
      { id: 'aion/aion-labs/aion-2.0', label: 'Aion 2.0' },
      { id: 'aion/aion-labs/aion-3.0', label: 'Aion 3.0' },
      { id: 'aion/aion-labs/aion-rp-llama-3.1-8b', label: 'Aion RP Llama 8B' },
    ],
  },
  {
    prefix: 'opencode/', baseURL: 'https://opencode.ai/zen/v1', apiKey: process.env.OPENCODE_API_KEY,
    models: [
      { id: 'opencode/deepseek-v4-flash-free', label: 'Zen DeepSeek Flash' },
      { id: 'opencode/hy3-free', label: 'Zen Hy3' },
      { id: 'opencode/big-pickle', label: 'Zen Big Pickle' },
      { id: 'opencode/nemotron-3-ultra-free', label: 'Zen Nemotron 3 Ultra' },
      { id: 'opencode/nemotron-3.5-lightning-free', label: 'Zen Nemotron 3.5' },
      { id: 'opencode/mimo-v2.5-free', label: 'Zen Mimo 2.5' },
      { id: 'opencode/laguna-s-2.1-free', label: 'Zen Laguna S 2.1' },
    ],
  },
  {
    prefix: 'minimax/', baseURL: 'https://api.minimax.io/v1', apiKey: process.env.MINIMAX_API_KEY,
    models: [
      { id: 'minimax/MiniMax-M2.7', label: 'MiniMax M2.7', paid: true },
      { id: 'minimax/MiniMax-M2.5', label: 'MiniMax M2.5', paid: true },
    ],
  },
  {
    prefix: 'sambanova/', baseURL: 'https://api.sambanova.ai/v1', apiKey: process.env.SAMBANOVA_API_KEY,
    models: [
      { id: 'sambanova/DeepSeek-V3.1', label: 'SambaNova DeepSeek V3.1', paid: true },
      { id: 'sambanova/Meta-Llama-3.3-70B-Instruct', label: 'SambaNova Llama 3.3 70B', paid: true },
    ],
  },
  {
    prefix: 'together/', baseURL: 'https://api.together.xyz/v1', apiKey: process.env.TOGETHER_API_KEY,
    models: [
      { id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Together Llama 3.3 70B', paid: true },
      { id: 'together/Qwen/Qwen3-32B', label: 'Together Qwen3 32B', paid: true },
    ],
  },
  // ─── Российские ───
  {
    prefix: 'giga/', baseURL: 'https://gigachat.devices.sberbank.ru/api/v1',
    apiKey: process.env.GIGACHAT_CLIENT_SECRET, jsonMode: false,
    group: 'GigaChat (Сбер)',
    models: [
      { id: 'giga/GigaChat-2-Max', label: 'GigaChat 2 Max' },
      { id: 'giga/GigaChat-2-Pro', label: 'GigaChat 2 Pro' },
      { id: 'giga/GigaChat-2', label: 'GigaChat 2' },
      // GigaChat-2-Lite удалён: модель не существует (404 No such model)
    ],
  },
  {
    prefix: 'yandex/', baseURL: 'https://llm.api.cloud.yandex.net/v1', apiKey: process.env.YANDEX_API_KEY,
    group: 'YandexGPT',
    models: [
      { id: 'yandex/yandexgpt-32k', label: 'YandexGPT 32k', paid: true },
      { id: 'yandex/yandexgpt-lite', label: 'YandexGPT Lite', paid: true },
    ],
  },
];

const clientCache = new Map();

// ─── GigaChat (Сбер): OAuth-токен из client_id/client_secret + самоподписанный TLS ───
import https from 'https';
import crypto from 'crypto';

let gigaTokenCache = null;

/** Малый POST через node:https (undici-fetch не умеет rejectUnauthorized:false). */
function gigaPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('GigaChat OAuth: bad response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function getGigaToken() {
  if (gigaTokenCache && gigaTokenCache.exp > Date.now() + 60000) return gigaTokenCache.token;
  const auth = Buffer.from(`${process.env.GIGACHAT_CLIENT_ID || ''}:${process.env.GIGACHAT_CLIENT_SECRET || ''}`).toString('base64');
  const d = await gigaPost('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'Authorization': 'Basic ' + auth,
    'RqUID': crypto.randomUUID(),
  }, 'scope=GIGACHAT_API_PERS');
  if (!d.access_token) throw new Error('GigaChat OAuth: ' + JSON.stringify(d).slice(0, 100));
  gigaTokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 1800) * 1000 };
  return gigaTokenCache.token;
}

function makeClient(p) {
  const opts = {
    apiKey: p.apiKey === 'always' ? '' : p.apiKey,
    baseURL: p.baseURL,
    timeout: LLM_TIMEOUT,
  };
  if (p.prefix === 'giga/') {
    opts.httpAgent = new https.Agent({ rejectUnauthorized: false }); // самоподписанный сертификат Сбера
  }
  const client = new OpenAI(opts);
  clientCache.set(p.prefix, client);
  return client;
}

export function clientFor(model, apiKeyOverride) {
  const p = providers.find((x) => model.startsWith(x.prefix));
  if (!p) throw new Error('Unknown model: ' + model);
  const key = apiKeyOverride || p.apiKey;
  if (!key) throw new Error('Нет ключа для ' + p.prefix);
  return clientCache.get(p.prefix) || makeClient(p);
}

/** Асинхронный клиент: для GigaChat сначала добывает OAuth-токен (клиент не кэшируется — токен живёт 30 мин). */
export async function clientForModel(model) {
  if (model.startsWith('giga/')) {
    const token = await getGigaToken();
    const p = providers.find((x) => x.prefix === 'giga/');
    return makeClient({ ...p, apiKey: token });
  }
  return clientFor(model);
}

export function resolveModelId(model) {
  const p = providers.find((x) => model.startsWith(x.prefix));
  return p ? model.slice(p.prefix.length) : model;
}

export function providerInfo(model) {
  const p = providers.find((x) => model.startsWith(x.prefix));
  const m = p && p.models.find((x) => x.id === model);
  return { group: p ? p.group : '', label: m ? m.label : model };
}

export function supportsJsonMode(model) {
  const p = providers.find((x) => model.startsWith(x.prefix));
  return !(p && p.jsonMode === false);
}

/** Все доступные модели (с ключом или безключевые). */
export function getAvailableModels() {
  const out = [];
  for (const p of providers) {
    if (p.apiKey === 'always' || p.apiKey) {
      for (const m of p.models) out.push({ id: m.id, label: m.label, group: p.group, paid: !!m.paid });
    }
  }
  return out;
}
