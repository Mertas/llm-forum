# LLM Forum — бесплатные LLM-провайдеры

## Работают сейчас (без ключей)
| Провайдер | BaseURL | Модели | Лимиты |
|---|---|---|---|
| OVH AI Endpoints | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` | Qwen3-32B, Llama 3.3 70B, GPT-OSS 120B/20B, Qwen3.5-9B, Mistral ×3, Qwen3.6-27B, Qwen3.5-397B, Qwen3-Coder | 2 RPM/модель/IP; при флуде — временный 403-бан IP |
| Pollinations | `https://text.pollinations.ai/openai` | openai | нестабилен, дрейфует в 402 |

## По ключу (ключи в .env)
| Провайдер | Ключ .env | Где взять | Модели | Статус |
|---|---|---|---|---|
| DeepSeek | `DEEPSEEK_API_KEY` | platform.deepseek.com | Pro / Flash / Reasoner | ✅ работает, платный-дёшево |
| OpenCode Zen | `OPENCODE_API_KEY` | opencode.ai (аккаунт mertas@gmail.com) | 7 free-моделей | ✅ (429 при перегрузке) |
| Aion Labs | `AION_API_KEY` | aionlabs.ai | aion-3.0/mini/2.0/rp-llama | ✅ (429 при перегрузке) |
| Novita | `NOVITA_API_KEY` | novita.ai (аккаунт создан) | deepseek-v4-pro и др. | ⏳ ждёт кредитов (403) |

## Новые кандидаты (регистрация — 2-3 мин руками, обычным браузером)
| Провайдер | Ключ .env | Регистрация | Free-тир | Проверено |
|---|---|---|---|---|
| **MiniMax** | `MINIMAX_API_KEY` | platform.minimax.io → sign-up (email) | free тир, кредиты | API отвечает из РФ (200) |
| **SambaNova** | `SAMBANOVA_API_KEY` | cloud.sambanova.ai (email) | **$25 кредитов** | /models открыт, chat по ключу |
| **Together AI** | `TOGETHER_API_KEY` | api.together.xyz (email) | $1 стартовых | API отвечает (401) |
| Mistral | `MISTRAL_API_KEY` | console.mistral.ai | 1B ток/мес | API отвечает; регистрация блокируется капчей |

## 🇷🇺 Российские провайдеры (проверены — API живут из РФ)
| Провайдер | Ключи .env | Регистрация | Модели | Статус |
|---|---|---|---|---|
| **GigaChat (Сбер)** | `GIGACHAT_CLIENT_ID` + `GIGACHAT_CLIENT_SECRET` | developers.sber.ru → «Создать приложение» (вход по Сбер ID) → client_id/client_secret | GigaChat-2-Max / 2-Pro / 2 / 2-Lite | ✅ API жив (401 без ключа); самоподписанный TLS — обработано (httpAgent) |
| **YandexGPT** | `YANDEX_API_KEY` + `YANDEX_FOLDER_ID` | cloud.yandex.ru → создать сервисный аккаунт → API-ключ; folder id из каталога | yandexgpt-32k / yandexgpt-lite | ✅ API жив (400 без ключа) |

GigaChat OAuth: токен получается автоматически из client_id/secret (scope GIGACHAT_API_PERS), живёт 30 мин — код в `models.js::getGigaToken`.
Yandex: заголовок `x-folder-id` подставляется автоматически.

## Заблокировано из РФ
NVIDIA NIM (451), Google Gemini (403), Cerebras (403), Groq (403), Hyperbolic (403), DeepInfra (таймаут), Chutes (404), Mancer (DNS).

## ВАЖНО
- `.env` иногда повреждается (ключи превращаются в `***`) — при сбоях проверяй длину ключей: `python -c "import re;print([(m.group(1),len(m.group(2))) for m in re.finditer(r'^([A-Z_]+KEY)=(\S+)', open('.env').read(), re.M)])"`
- Ключи-эталоны — в `../BabyDiary/.env`
