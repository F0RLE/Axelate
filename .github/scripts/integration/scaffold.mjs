#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (!targetArg) {
    console.error(
        'Usage: npm run integration:new -- <target-dir> [--id my-id] [--name "My Integration"]',
    );
    process.exit(1);
}

function optionValue(name, fallback) {
    const index = args.indexOf(name);
    if (index === -1 || index + 1 >= args.length) {
        return fallback;
    }

    return args[index + 1];
}

function slugFromName(value) {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/gu, '-')
            .replace(/^-+|-+$/gu, '') || 'my-integration'
    );
}

function fail(message) {
    console.error(`[integration:new] ${message}`);
    process.exit(1);
}

function validateId(value) {
    const trimmed = String(value).trim();
    if (!/^[A-Za-z0-9_-]+$/u.test(trimmed)) {
        fail('Integration id may contain only letters, numbers, "-" and "_".');
    }

    return trimmed;
}

function validateName(value) {
    const trimmed = String(value).trim().replace(/\s+/gu, ' ');
    if (!/^[\p{L}\p{N} _-]+$/u.test(trimmed)) {
        fail('Integration name may contain only letters, numbers, spaces, "-" and "_".');
    }

    return trimmed;
}

const target = path.resolve(targetArg);
const defaultId = slugFromName(path.basename(target));
const id = validateId(optionValue('--id', defaultId));
const name = validateName(optionValue('--name', id.replace(/[-_]+/gu, ' ')));

if (existsSync(target)) {
    console.error(`Target already exists: ${target}`);
    process.exit(1);
}

mkdirSync(path.join(target, 'src'), { recursive: true });
mkdirSync(path.join(target, 'settings-ui'), { recursive: true });

writeFileSync(
    path.join(target, 'axelate-module.toml'),
    `api_version = "1"
id = "${id}"
name = "${name}"
version = "0.1.0"
description = "Connects ${name} to Axelate AI."
author = "Your Name"
type = "service"
icon = "⚙"
readme = "README.md"
settings_ui = "settings-ui/index.html"

[runtime]
kind = "python"
version = "3.11"
entry = "src/main.py"
`,
);

writeFileSync(
    path.join(target, 'README.md'),
    `# ${name}

Axelate integration scaffold.

## Run

1. Import this folder in Axelate.
2. Open the integration settings and save a prompt.
3. Launch the integration card.

Use \`npm run integration:doctor -- ${target}\` from the Axelate repository to validate the package.
`,
);

writeFileSync(
    path.join(target, 'src', 'main.py'),
    `from __future__ import annotations

import json
import os
import urllib.parse
import urllib.error
import urllib.request


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def validate_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise ValueError("AXELATE_HTTP_API_BASE must be an http(s) loopback URL.")
    return value.rstrip("/")


BASE_URL = validate_base_url(required_env("AXELATE_HTTP_API_BASE"))
TOKEN = required_env("AXELATE_HTTP_API_TOKEN")
MODULE_ID = required_env("AXELATE_MODULE_ID")
MODULE_PATH_ID = urllib.parse.quote(MODULE_ID, safe="")


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with HTTP {error.code}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"{method} {path} failed: {error.reason}") from error

    return json.loads(text) if text.strip() else {}


def main() -> None:
    settings = request("GET", f"/v1/modules/{MODULE_PATH_ID}/settings").get("settings", {})
    prompt = settings.get("prompt") or "Write a short status update."
    request(
        "POST",
        f"/v1/modules/{MODULE_PATH_ID}/stage",
        {"stage": "ai.request", "label": "Calling Axelate AI", "progress": 0.5},
    )
    result = request("POST", "/v1/ai/text", {"prompt": prompt, "sessionId": MODULE_ID})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
`,
);

writeFileSync(
    path.join(target, 'settings-ui', 'axelate-settings-bridge.js'),
    `const CHANNEL = "axelate:module-settings";

export class AxelateSettingsBridge {
  constructor({ target = window.parent, allowedOrigin = window.location.origin } = {}) {
    this.target = target;
    this.allowedOrigin = allowedOrigin;
    this.pending = new Map();
    this.context = null;
    this.settings = {};
    window.addEventListener("message", (event) => this.handleMessage(event));
  }

  ready() {
    this.target.postMessage({ channel: CHANNEL, type: "module-ready" }, this.allowedOrigin);
  }

  rendered() {
    this.target.postMessage({ channel: CHANNEL, type: "module-rendered" }, this.allowedOrigin);
  }

  waitForHost() {
    return new Promise((resolve) => {
      if (this.context !== null) {
        resolve({ context: this.context, settings: this.settings });
        return;
      }

      this.pending.set("host-ready", { resolve });
    });
  }

  saveSettings(settings) {
    return this.request("saveSettings", settings).then((savedSettings) => {
      this.settings = savedSettings;
      return savedSettings;
    });
  }

  request(method, payload) {
    const requestId = crypto.randomUUID();
    this.target.postMessage({ channel: CHANNEL, requestId, method, payload }, this.allowedOrigin);

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
  }

  handleMessage(event) {
    if (event.origin !== this.allowedOrigin || event.source !== this.target) {
      return;
    }

    const payload = event.data;
    if (payload?.channel !== CHANNEL) {
      return;
    }

    if (payload.type === "host-ready") {
      this.context = payload.context;
      this.settings = payload.settings ?? {};
      const waiter = this.pending.get("host-ready");
      if (waiter) {
        this.pending.delete("host-ready");
        waiter.resolve({ context: this.context, settings: this.settings });
      }
      return;
    }

    if (typeof payload.requestId !== "string") {
      return;
    }

    const pending = this.pending.get(payload.requestId);
    if (!pending) {
      return;
    }

    this.pending.delete(payload.requestId);
    if (payload.ok) {
      pending.resolve(payload.result);
    } else {
      pending.reject(new Error(payload.error ?? "Settings bridge request failed."));
    }
  }
}
`,
);

writeFileSync(
    path.join(target, 'settings-ui', 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name} Settings</title>
    <style>
      body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; color: #f5f5f7; background: #15161a; }
      label { display: grid; gap: 8px; font-size: 13px; }
      textarea { min-height: 120px; resize: vertical; border: 1px solid #3a3d46; border-radius: 6px; padding: 10px; color: inherit; background: #0f1014; }
      button { margin-top: 12px; border: 0; border-radius: 6px; padding: 9px 12px; color: #fff; background: #2563eb; cursor: pointer; }
    </style>
  </head>
  <body>
    <label>
      Prompt
      <textarea id="prompt"></textarea>
    </label>
    <button id="save" type="button">Save</button>
    <script type="module">
      import { AxelateSettingsBridge } from "./axelate-settings-bridge.js";

      const bridge = new AxelateSettingsBridge();
      const prompt = document.getElementById("prompt");
      const saveButton = document.getElementById("save");

      bridge.ready();
      const { settings } = await bridge.waitForHost();
      prompt.value = settings.prompt ?? "Write a short status update.";
      bridge.rendered();

      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        try {
          await bridge.saveSettings({ prompt: prompt.value });
        } finally {
          saveButton.disabled = false;
        }
      });
    </script>
  </body>
</html>
`,
);

console.log(`[integration:new] created ${target}`);
console.log(`[integration:new] validate with: npm run integration:doctor -- ${target}`);
