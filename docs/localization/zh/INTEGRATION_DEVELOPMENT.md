# 集成开发

> 将你的产品接入 Axelate，并使用启动器提供的 AI、设置、日志和运行时目录，
> 而不是依赖应用内部文件。

## 快速开始

创建一个集成模板：

```bash
npm run integration:new -- ./my-integration --id my-integration --name "My Integration"
npm run integration:doctor -- ./my-integration
```

然后在 Axelate 的 Integrations 页面导入这个文件夹并启动卡片。

## 仓库工具

- `npm run integration:new -- <folder>` 创建一个最小 Python 集成。
- `npm run integration:doctor -- <folder>` 检查 `axelate-module.toml`、入口文件、
  settings UI、依赖路径，以及不应该随包发布的生成目录。
- `docs/examples/integrations/python-ai-tool/` 是最小可运行示例。
- `docs/examples/sdk/python/axelate_sdk.py` 和
  `docs/examples/sdk/javascript/axelate-client.mjs` 是可复制的小型客户端 helper。
- `docs/examples/sdk/browser/axelate-settings-bridge.js` 是 custom settings
  UI iframe 消息协议的可复制 helper。

真正的运行时契约仍然是 [Integration API](../en/INTEGRATION_API.md) 中描述的本地
HTTP API。

## 集成结构

```text
my-integration/
  axelate-module.toml
  README.md
  src/
    main.py
  settings-ui/
    index.html
```

最小 manifest：

```toml
api_version = "1"
id = "my-integration"
name = "My Integration"
version = "0.1.0"
type = "service"
settings_ui = "settings-ui/index.html"

[runtime]
kind = "python"
version = "3.11"
entry = "src/main.py"
```

支持的 runtime: `python`, `node`, `bun`, `binary`。

## 运行时契约

Axelate 启动 script-runtime 集成时会设置：

- `AXELATE_INTEGRATION_API_VERSION`
- `AXELATE_HTTP_API_BASE`
- `AXELATE_HTTP_API_TOKEN`
- `AXELATE_MODULE_ID`
- `AXELATE_MODULE_DIR`
- `AXELATE_RUNTIME_DIR`
- `AXELATE_MODULE_RUNTIME_DIR`
- `AXELATE_MODULE_LOG_DIR`

在进程启动时读取这些值。不要硬编码端口或数据路径。

## 调用 AI

Python：

```python
from axelate_sdk import AxelateClient

client = AxelateClient()
settings = client.settings()
reply = client.ai_text(settings.get("prompt", "Write a short status update."))
print(reply)
```

JavaScript：

```js
import { AxelateClient } from './axelate-client.mjs';

const client = new AxelateClient();
const settings = await client.settings();
const reply = await client.aiText(settings.prompt ?? 'Write a short status update.');
console.log(reply);
```

## Settings UI

如果 `settings_ui` 指向 HTML 文件，或指向包含 `index.html` 的目录，启动器会在
sandboxed settings host 中打开它。

iframe 协议：

- 发送 `{ channel: "axelate:module-settings", type: "module-ready" }`
- 等待包含 `settings` 和 `context` 的 `host-ready`
- UI 准备完成后发送 `module-rendered`
- 使用 `method: "saveSettings"` 的消息保存设置

当前参考示例：`docs/examples/integrations/python-ai-tool/settings-ui/index.html` 和
`docs/examples/integrations/python-ai-tool/settings-ui/axelate-settings-bridge.js`。

## 开发循环

1. 创建模板或复制示例。
2. 运行 `integration:doctor`。
3. 在 Axelate 中导入文件夹。
4. 启动卡片。
5. 在启动器的日志界面查看集成日志。
6. 将运行时文件写入 `AXELATE_MODULE_RUNTIME_DIR`。
7. 不要发布 `.venv`, `node_modules`, caches, logs 或下载的 runtime。

## 信任规则

导入的集成是用户选择运行的本地代码。目前它们不是经过 review、签名或 sandbox
隔离的 packages。
