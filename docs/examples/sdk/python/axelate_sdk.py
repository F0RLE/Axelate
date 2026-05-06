from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


class AxelateApiError(RuntimeError):
    def __init__(self, method: str, path: str, status: int | None, body: str, message: str) -> None:
        self.method = method
        self.path = path
        self.status = status
        self.body = body
        super().__init__(f"{method} {path} failed: {message}")


class AxelateClient:
    def __init__(self) -> None:
        self.base_url = validate_base_url(required_env("AXELATE_HTTP_API_BASE")).rstrip("/")
        self.token = required_env("AXELATE_HTTP_API_TOKEN")
        self.module_id = required_env("AXELATE_MODULE_ID")

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
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read().decode("utf-8")
                return {} if body == "" else json.loads(body)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise AxelateApiError(
                method,
                path,
                error.code,
                body,
                extract_error_message(body) or error.reason,
            ) from error
        except urllib.error.URLError as error:
            raise AxelateApiError(method, path, None, "", str(error.reason)) from error

    def settings(self) -> dict[str, Any]:
        payload = self.request("GET", f"/v1/modules/{urllib.parse.quote(self.module_id)}/settings")
        if "error" in payload:
            raise AxelateApiError("GET", "/settings", None, json.dumps(payload), str(payload["error"]))
        return payload.get("settings", {})

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return self.request(
            "PUT",
            f"/v1/modules/{urllib.parse.quote(self.module_id)}/settings",
            settings,
        )

    def stage(self, stage: str, label: str, progress: float | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"stage": stage, "label": label}
        if progress is not None:
            payload["progress"] = progress
        return self.request("POST", f"/v1/modules/{urllib.parse.quote(self.module_id)}/stage", payload)

    def ai_text(self, prompt: str, **options: Any) -> dict[str, Any]:
        """Run text generation. sessionId defaults to module_id and can be overridden."""
        session_id = options.pop("sessionId", self.module_id)
        payload = {"prompt": prompt, "sessionId": session_id, **options}
        return self.request("POST", "/v1/ai/text", payload)


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        raise ValueError(f"Missing required Axelate integration env var: set {name}.")
    return value


def validate_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("AXELATE_HTTP_API_BASE must use http or https.")
    if parsed.hostname not in LOOPBACK_HOSTS:
        raise ValueError("AXELATE_HTTP_API_BASE must point to localhost, 127.0.0.1, or ::1.")
    return value


def extract_error_message(body: str) -> str | None:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body or None
    if isinstance(parsed, dict):
        error = parsed.get("error") or parsed.get("message")
        if isinstance(error, str):
            return error
    return body or None
