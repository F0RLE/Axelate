# Axelate

Axelate 是一个基于 Rust、Tauri v2 和原生 TypeScript 的桌面启动器。

## 当前产品定位

当前 Axelate 是：

- 本地 AI 引擎启动器
- 基于 API 的 AI 聊天壳层
- 统一的下载、设置、监控和调试桌面界面

## 当前功能

- 通过 OpenRouter 进行聊天
- 安装和启动本地引擎 `llama.cpp`、`stable-diffusion.cpp` 和 `ComfyUI`
- 本地安全存储与界面集成

## 重要说明

- `Marketplace` 标签页已经存在于界面中
- 真实的商城购买、授权和远程托管执行还没有完成
- 这些能力现在写入路线图，而不是宣称已经实现

## 目录结构

```text
Axelate/
├── src/         前端和全部 npm 依赖
├── src-tauri/   Rust 后端与 Tauri 配置
├── docs/        文档
└── .github/     脚本、工作流、hooks
```

## 开发启动

在仓库根目录运行：

```bash
npm run install-deps
npm run dev
```

## 说明

- 真正的 npm 依赖只在 `src/node_modules`
- 根目录 `package.json` 只是命令代理
- Rust 类型是事实来源，TypeScript 绑定由 Specta 生成

## 更多文档

- [Getting Started](../en/getting-started.md)
- [Architecture](../en/architecture.md)
- [Automation](../en/AUTOMATION.md)
- [Roadmap](../en/ROADMAP.md)
- [Security Hardening](../en/SECURITY_HARDENING.md)
