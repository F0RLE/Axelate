# 集成开发

> English `docs/localization/en/INTEGRATION_DEVELOPMENT.md` is the canonical
> reference and may be updated before this translation.

> 将你的产品接入 Axelate，并使用启动器提供的 AI、设置、日志和运行时目录，
> 而不是依赖应用内部文件。

## 快速开始

创建一个集成模板：

```bash
npm run integration:new -- ./my-integration --id my-integration --name "My Integration"
npm run integration:doctor -- ./my-integration
```

然后在 Axelate 的 Integrations 页面导入这个文件夹并启动卡片。
如果集成入口是 JavaScript，可以使用 `--runtime node` 或 `--runtime bun`。

如果要接入已有应用，把应用代码放在集成目录里，在 `axelate-module.toml`
中声明入口文件，并在进程启动时读取启动器提供的环境变量。生成的状态写入
`AXELATE_MODULE_RUNTIME_DIR`，通过 `/v1/ai/text` 或 `/v1/ai/image` 调用 AI，
然后运行 `integration:doctor`，再导入该文件夹。

## 仓库工具

- `npm run integration:new -- <folder>` 创建一个最小 Python 集成。
  JavaScript runtime 可添加 `--runtime node` 或 `--runtime bun`。
- `npm run integration:doctor -- <folder>` 检查 `axelate-module.toml`、入口文件、
  settings UI、依赖路径，以及不应该随包发布的生成目录。
- `docs/examples/integrations/python-ai-tool/` 是最小可运行示例。
- `docs/examples/sdk/python/axelate_sdk.py` 和
  `docs/examples/sdk/javascript/axelate-client.mjs` 是可复制的小型客户端 helper。
- `docs/examples/sdk/browser/axelate-settings-bridge.js` 是 custom settings
  UI iframe 消息协议的可复制 helper。

真正的运行时契约仍然是 [Integration API](../en/INTEGRATION_API.md) 中描述的本地
HTTP API。
它适合 launcher-managed 集成，也支撑当前的本地 Agent Control 层。外部 agent
必须使用 agent profile token、scopes、audit 和 approvals，不能通过文件或 UI
绕过权限模型。

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

## Agent Control

当前 Integration API 对普通集成仍然是模块级、受限制的接口：集成拿到
runtime token 后，只能使用自己的设置、状态、日志目录和 AI 请求能力。

Agent Control 已由单独的英文规范文档说明：
[Agent Control](../en/AGENT_CONTROL.md)。它是面向 Codex、本地 CLI agent、
IDE assistant 和本地脚本的 `127.0.0.1` 本地控制 API。

主要 scopes：

- `observe` 读取状态、健康信息、模块列表和清理后的控制台日志
- `operate` 打开页面、选择卡片、start、stop、restart 和 repair
- `configure` 修改设置，必要时需要用户确认
- `draft-create` 创建集成草稿文件夹，但不安装或运行
- `full-access` 由用户手动授予完整本地访问

Agent 不应该读取 Axelate 内部文件、抓取 UI，或拿到 provider secrets。
危险操作需要 scopes、audit log 和用户确认。

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

导入的集成是用户选择运行的本地代码。目前它们不是经过审查、签名或沙箱隔离的包。

保持集成干净且边界明确：

- 不要发布生成的依赖目录
- 不要硬编码端口或 Axelate 内部路径
- 将运行时写入放在 `AXELATE_MODULE_RUNTIME_DIR`
- 将日志写入放在 `AXELATE_MODULE_LOG_DIR`
- 通过本地 API 读取和保存设置，不要直接编辑启动器内部配置文件
- 导入或打包文件夹前运行 `integration:doctor`

URL 导入必须使用 `https://`，本地开发的 `http://localhost` 或
`http://127.0.0.1` 除外。GitHub 仓库根 URL 可以解析为 `main` 或 `master`
分支归档；直接归档 URL 会按归档文件下载。

启动器会验证 module id、runtime entry path、settings UI path、归档条目、文件数量
和大小限制。这些检查可以防止常见导入错误和 path traversal，但不能替代对将要运行的
集成代码进行审查。
