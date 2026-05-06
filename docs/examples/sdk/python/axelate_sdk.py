from __future__ import annotations

import json
import os
import urllib.request
from typing import Any


class AxelateClient:
    def __init__(self) -> None:
        self.base_url = os.environ["AXELATE_HTTP_API_BASE"].rstrip("/")
        self.token = os.environ["AXELATE_HTTP_API_TOKEN"]
        self.module_id = os.environ["AXELATE_MODULE_ID"]

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))

    def settings(self) -> dict[str, Any]:
        return self.request("GET", f"/v1/modules/{self.module_id}/settings").get("settings", {})

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return self.request("PUT", f"/v1/modules/{self.module_id}/settings", settings)

    def stage(self, stage: str, label: str, progress: float | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"stage": stage, "label": label}
        if progress is not None:
            payload["progress"] = progress
        return self.request("POST", f"/v1/modules/{self.module_id}/stage", payload)

    def ai_text(self, prompt: str, **options: Any) -> dict[str, Any]:
        payload = {"prompt": prompt, "sessionId": self.module_id, **options}
        return self.request("POST", "/v1/ai/text", payload)
