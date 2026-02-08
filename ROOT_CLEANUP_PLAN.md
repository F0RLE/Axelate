# План реорганизации корневых папок

## Текущая структура

### `.github/` (10 элементов)
```
.github/
├── .husky/                    # Git hooks
├── ISSUE_TEMPLATE/            # GitHub шаблоны
│   ├── bug_report.md
│   └── feature_request.md
├── scripts/                   # PowerShell скрипты
│   ├── clear.ps1
│   ├── dev.ps1
│   ├── release.ps1
│   ├── update.ps1
│   └── verify-all.ps1
├── workflows/                 # CI/CD
│   ├── ci.yml
│   └── release.yml
├── CODE_OF_CONDUCT.md         # ← Перемещено из корня
├── CONTRIBUTING.md            # ← Перемещено из корня
├── SECURITY.md                # ← Перемещено из корня
├── PULL_REQUEST_TEMPLATE.md
├── commitlint.config.js
└── dependabot.yml
```

### `docs/` (5 элементов)
```
docs/
├── en/
│   ├── CODING_STANDARDS.md
│   ├── FileTree.md
│   ├── architecture.md
│   └── getting-started.md
└── VISION.md
```

### Корневые файлы
```
package.json        # Proxy-скрипты + Husky
package-lock.json   # Lock-файл (можно удалить)
```

---

## Предлагаемые изменения

### 1. `.github/` — оставить как есть ✅
Структура оптимальна. GitHub распознаёт все community-файлы.

### 2. `docs/` — добавить русскую локализацию
```
docs/
├── en/                        # English
│   ├── CODING_STANDARDS.md
│   ├── FileTree.md
│   ├── architecture.md
│   └── getting-started.md
├── ru/                        # Russian (TODO)
│   └── ...
└── VISION.md                  # Общий для всех языков
```

### 3. Корневые package-файлы — удалить lock
```bash
Remove-Item package-lock.json
```

**Почему безопасно:**
- В корне только 3 dev-зависимости (husky, commitlint)
- Основные зависимости в `src/package-lock.json`
- `npm install` пересоздаст при необходимости

---

## Команды для выполнения

```powershell
# 1. Удалить package-lock.json из корня
Remove-Item package-lock.json

# 2. Создать папку для русской документации (опционально)
# New-Item -ItemType Directory -Path docs/ru
```

---

## Итоговая структура корня

```
Axelate/
├── .git/
├── .github/           # 10 элементов (оптимизировано)
├── docs/              # Документация
├── src/               # Frontend
├── src-tauri/         # Backend
├── .editorconfig
├── .gitattributes
├── .gitignore
├── LICENSE
├── README.md
└── package.json       # Только proxy-скрипты
```

**Итого:** 5 папок + 6 файлов (было 7 файлов)
