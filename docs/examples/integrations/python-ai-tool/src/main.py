from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request


def validate_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("AXELATE_HTTP_API_BASE must use http or https.")
    return value.rstrip("/")


BASE_URL = validate_base_url(os.environ["AXELATE_HTTP_API_BASE"])
TOKEN = os.environ["AXELATE_HTTP_API_TOKEN"]
MODULE_ID = os.environ["AXELATE_MODULE_ID"]
MODULE_PATH_ID = urllib.parse.quote(MODULE_ID)


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
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


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
    try:
        main()
    except urllib.error.HTTPError as error:
        print(error.read().decode("utf-8"))
        raise
