from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        raise RuntimeError(f"Missing required Axelate integration env var: {name}")
    return value


def validate_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in LOOPBACK_HOSTS:
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
            body = response.read().decode("utf-8")
            return json.loads(body) if body.strip() else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with HTTP {error.code}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"{method} {path} failed: {error.reason}") from error


def main() -> None:
    settings = request("GET", f"/v1/modules/{MODULE_PATH_ID}/settings").get("settings", {})
    prompt = settings.get("prompt") or "Write a short status update."

    request(
        "POST",
        f"/v1/modules/{MODULE_PATH_ID}/stage",
        {"stage": "ai.request", "label": "Calling Axelate AI", "progress": 0.5},
    )

    result = request(
        "POST",
        "/v1/ai/text",
        {
            "prompt": prompt,
            "sessionId": MODULE_ID,
        },
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
