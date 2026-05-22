# Документация Axelate на русском

Английская документация в `docs/localization/en/` является канонической. Русские
файлы переводят только отдельные разделы и могут обновляться позже английских.

## Доступно на русском

- [Разработка интеграций](INTEGRATION_DEVELOPMENT.md)

## Канонические английские документы

- [Current State](../en/CURRENT_STATE.md) - что реально есть в проекте сейчас
- [Vision](../en/VISION.md) - направление продукта и границы будущей платформы
- [Roadmap](../en/ROADMAP.md) - порядок работ, включая Integration API,
  Agent Control API, SDK, permissions и MCP
- [User Guide](../en/USER_GUIDE.md) - пользовательский обзор текущего приложения
- [Getting Started](../en/GETTING_STARTED.md) - установка и запуск из исходников
- [Development Workflow](../en/DEVELOPMENT_WORKFLOW.md) - ежедневная разработка
- [Architecture](../en/ARCHITECTURE.md) - карта frontend/backend/integration слоев
- [Trust Model](../en/TRUST_MODEL.md) - текущие и будущие границы доверия
- [Integration API](../en/INTEGRATION_API.md) - локальный HTTP API интеграций и
  база для будущего agent-control слоя
- [Custom Integrations](../en/CUSTOM_INTEGRATIONS.md) - формат пользовательских интеграций
- [Releases](../en/RELEASES.md) - релизный процесс

Английские `VISION.md` и `ROADMAP.md` описывают планы, а не уже поставленные
возможности. Сейчас полноценной permissioned agent-control платформы нет:
текущий Integration API только закладывает для нее основу.
