"""A small JSON fetcher with bounded retries."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

MAX_RETRY_AFTER_S = 30.0


class SourceError(RuntimeError):
    """A source could not be read. The message is safe to show on the dashboard."""


class Fetcher:
    """GET JSON with exponential backoff on network errors, 429 and 5xx."""

    def __init__(
        self,
        client: httpx.Client,
        *,
        attempts: int = 3,
        backoff_s: float = 1.0,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self._client = client
        self._attempts = max(1, attempts)
        self._backoff_s = backoff_s
        self._sleep = sleep if sleep is not None else time.sleep

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        """Return parsed JSON, or None when the server answers 204 (no content)."""
        problem = "no attempt made"
        for attempt in range(1, self._attempts + 1):
            delay = self._backoff_s * 2 ** (attempt - 1)
            try:
                response = self._client.get(url, params=params)
            except httpx.TransportError as error:
                problem = f"network error ({type(error).__name__})"
            else:
                if response.status_code == 204:
                    return None
                if response.status_code == 200:
                    try:
                        return response.json()
                    except ValueError:
                        problem = "response was not valid JSON"
                elif response.status_code == 429 or response.status_code >= 500:
                    problem = f"HTTP {response.status_code}"
                    delay = _retry_after(response, delay)
                else:
                    raise SourceError(
                        f"{_host(url)} answered HTTP {response.status_code}: "
                        f"{response.text[:160].strip()}"
                    )
            if attempt < self._attempts:
                self._sleep(delay)
        raise SourceError(f"{_host(url)} failed after {self._attempts} attempts ({problem})")


def _retry_after(response: httpx.Response, fallback: float) -> float:
    value = response.headers.get("retry-after", "")
    try:
        return min(max(float(value), 0.0), MAX_RETRY_AFTER_S)
    except ValueError:
        return fallback


def _host(url: str) -> str:
    return httpx.URL(url).host
