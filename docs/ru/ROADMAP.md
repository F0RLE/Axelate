# 🗺 Axelate: Дорожная Карта Развития

> **Версия:** 1.0.0  
> **Статус:** Активная разработка (v0.1.5)  
> **Обновлено:** 2026-02-14

---

## Текущее Состояние

Axelate — AI-лаунчер с чатом, мониторингом ресурсов и hardware-bound шифрованием.

**Работает сейчас:**
- ✅ Чат с облачными провайдерами (GPT, Gemini, Claude, DeepSeek, Llama)
- ✅ Мониторинг CPU/GPU/VRAM/Диск/Сеть
- ✅ AES-256-GCM хранилище ключей
- ✅ Streaming ответов с thinking-режимами
- ✅ Multimodal (текст + изображения через API)

**Проблемы:**
- ⚠️ 3 файла с DIP-нарушениями (ChatService, DebugService, DownloadUI)
- ⚠️ AppUI.ts — 1019 строк, нужна декомпозиция
- ⚠️ Провайдеры работают, но не тестированы комплексно
- ⚠️ Нет разделения capabilities (text/image/audio) в UI

---

## Phase 0: Стабилизация (v0.2.0)

### 0.1 Техдолг
- [ ] Закрыть DIP-нарушения (ChatService, DebugService, DownloadUI → TauriProvider DI)
- [ ] Декомпозировать AppUI.ts → ToastManager + ModuleCards + ModalManager + SkeletonLoader
- [ ] Вычистить пустые фичи (testfeature, user-preferences placeholder)
- [ ] Довести покрытие тестами services/ до 80%+

### 0.2 API Provider Testing
- [ ] Комплексное тестирование каждого провайдера:
  - [ ] GPT (прямой OpenAI API)
  - [ ] Gemini (Google API — отдельный формат)
  - [ ] Claude (через OpenRouter)
  - [ ] DeepSeek (собственный API, OpenAI-совместимый)
  - [ ] Llama (через OpenRouter)
- [ ] Проверить streaming, thinking mode, multimodal для каждого
- [ ] Проверить обработку ошибок (неверный ключ, rate limit, timeout)

### 0.3 Упрощение архитектуры провайдеров

**Текущая проблема:** 3 разных backend-типа (`api`, `gemini`, будущий `local`), хотя GPT/Claude/Llama/DeepSeek все используют OpenAI-совместимый формат.

**Целевая архитектура:**

```
┌──────────────────────────────────────────────────┐
│                Provider Config                    │
│  type: "openai-compat" | "gemini" | "local"      │
│  baseUrl: string                                  │
│  capabilities: ["text", "image", "audio", "code"] │
└──────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│    AIProvider trait  │
├─────────────────────┤
│ OpenAICompatProvider │ ← GPT, Claude, DeepSeek, Llama, Custom servers
│ GeminiProvider       │ ← Google Gemini API
│ LocalProvider        │ ← Ollama, LM Studio (future)
└─────────────────────┘
```

- Переименовать `"type": "api"` → `"openai-compat"` (честное имя)
- Добавить поле `capabilities` в `IAIProviderData`
- Один `OpenAICompatProvider` обслуживает всех с разным `baseUrl`

### 0.4 Настройки AI — раздельные вкладки

Вынести в Settings отдельные разделы по capability:

| Вкладка | Что настраивается |
|---------|------------------|
| **💬 Текст** | Провайдер, модель, temperature, max tokens, system prompt |
| **🖼 Изображения** | Провайдер (DALL-E, Stable Diffusion API), размер, стиль |
| **🎙 Аудио** | STT провайдер (Whisper API), TTS провайдер, голос |
| **⚙️ Кастомный сервер** | URL, API-ключ, тест подключения |

Каждая вкладка показывает только совместимые провайдеры/модели.

---

## Phase 1: Облачные Capabilities (v0.3.0)

### 1.1 Image Generation (API)
- [ ] Интеграция DALL-E 3/4 через OpenAI API (уже есть `apiModels.image` слот)
- [ ] Интеграция Gemini image generation
- [ ] UI: кнопка "Generate Image" в чате, инлайн-отображение результата

### 1.2 Audio/Speech (API)
- [ ] Whisper API для speech-to-text (связать с VoiceInputService)
- [ ] TTS через OpenAI TTS API (озвучка ответов)

### 1.3 Кастомный OpenAI-совместимый сервер
- [ ] Settings → "Custom Server" — ввод URL + API key
- [ ] Автоопределение доступных моделей (`/v1/models`)
- [ ] Поддержка: LM Studio, text-generation-webui, vLLM, LocalAI

---

## Phase 2: Локальная Генерация (v0.4.0)

### Рекомендуемый стек для интеграции

#### 💬 Текст — Ollama

| | Детали |
|---|---|
| **Что** | [Ollama](https://ollama.com) — локальный LLM runner |
| **API** | OpenAI-совместимый (`localhost:11434/v1`) |
| **Модели** | Llama 4, Gemma 3, Qwen 3, DeepSeek, Phi-4, Mistral |
| **Интеграция** | Через `OpenAICompatProvider` с `baseUrl: localhost:11434` |
| **Сложность** | Низкая — архитектура уже поддерживает |
| **VRAM** | 4GB+ (зависит от модели) |

**Функции Axelate:**
- [ ] Auto-detect Ollama на `localhost:11434`
- [ ] Pull моделей из UI (прогресс через `DownloadUI`)
- [ ] Рекомендация моделей по доступной VRAM (уже собираем через `system_monitor`)
- [ ] Переключение cloud ↔ local одной кнопкой

#### 🖼 Изображения — Stable Diffusion (ComfyUI / Forge)

| | Детали |
|---|---|
| **Что** | [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — node-based SD interface | 
| **API** | REST API на `localhost:8188` |
| **Модели** | SD 3.5, SDXL, Flux, DALL-E style |
| **Альтернатива** | [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) (A1111 fork с API на `localhost:7860`) |
| **Сложность** | Средняя — свой формат API, нужен адаптер |
| **VRAM** | 6GB+ (SDXL), 4GB+ (SD 1.5) |

**Функции Axelate:**
- [ ] Detect ComfyUI/Forge на стандартных портах
- [ ] Простой UI: prompt → generate → preview в чате
- [ ] Настройки: размер, steps, sampler, seed

#### 🎙 Speech-to-Text — Whisper.cpp

| | Детали |
|---|---|
| **Что** | [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) — C++ порт Whisper |
| **API** | CLI или server mode (`localhost:8080`) |
| **Модели** | tiny (75MB), base (142MB), small (466MB), medium (1.5GB) |
| **Интеграция** | Заменить Web Speech API в `VoiceInputService` |
| **Сложность** | Низкая — HTTP API или spawn process |
| **VRAM** | CPU-only работает, GPU ускоряет |

#### 🗣 Text-to-Speech — Piper

| | Детали |
|---|---|
| **Что** | [Piper](https://github.com/rhasspy/piper) — быстрый offline TTS |
| **API** | CLI (stdin text → stdout audio) |
| **Модели** | ~65 языков, 200+ голосов, 20-50MB каждый |
| **Сложность** | Низкая — spawn process, pipe audio |
| **VRAM** | CPU-only (работает на любом железе) |

#### 🎵 Music Generation — (будущее)

| | Детали |
|---|---|
| **Что** | [Stable Audio Open](https://github.com/Stability-AI/stable-audio-tools) |
| **Сложность** | Высокая — экспериментальное |
| **VRAM** | 8GB+ |

#### 🎬 Video Generation — (далёкое будущее)

| | Детали |
|---|---|
| **Что** | [Wan 2.1](https://github.com/Wan-Video/Wan2.1) или CogVideoX |
| **Сложность** | Очень высокая — требует мощных GPU |
| **VRAM** | 12GB+ (минимум) |

### Приоритет интеграции

```
1. Ollama (текст)          ← делаем первым, уже есть архитектура
2. ComfyUI/Forge (картинки) ← второй, самый запрашиваемый
3. Whisper.cpp (STT)        ← третий, уже есть VoiceInputService
4. Piper (TTS)              ← четвёртый, лёгкая интеграция
5. Audio/Video генерация    ← позже, когда будет спрос
```

---

## Phase 3: Скрипты и Автоматизация (v0.5.0)

- [ ] Script manifest формат (`script.json`)
- [ ] Запуск скриптов как изолированных процессов (Python/Node)
- [ ] IPC протокол скрипт ↔ Axelate (JSON-RPC)
- [ ] UI: карточки скриптов, запуск/стоп, логи
- [ ] Script SDK для авторов (минимальный Python + Node)

---

## Phase 4: Экосистема (v0.6.0+)

- [ ] Публичный каталог скриптов (GitHub-based JSON index)
- [ ] Auto-dependency resolution (venv для Python, node_modules для JS)
- [ ] Community contributions

---

## Phase 5: Монетизация (v1.0+)

- [ ] Платные скрипты (комиссия 10%)
- [ ] Pro-tier (расширенный мониторинг, приоритетная поддержка)
- [ ] Лицензирование через существующий SecureStorage

---

## Принципы Развития

1. **Бесплатно до v1.0** — сначала value, потом деньги
2. **Каждая фаза = рабочий релиз** — не "вот-вот будет", а "уже работает"
3. **Local-first** — всё что можно запустить локально, запускаем локально
4. **Windows-first** — macOS/Linux после стабильного v1.0
5. **Простота > Амбиции** — лучше 3 features которые работают идеально, чем 10 которые "почти"
