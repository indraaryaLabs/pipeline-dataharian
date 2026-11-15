from __future__ import annotations

import httpx
import pytest

from dataharian.http import Fetcher, SourceError


def fetcher_for(
    responses: list[httpx.Response | Exception], attempts: int = 3
) -> tuple[Fetcher, list[float], dict[str, int]]:
    delays: list[float] = []
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        item = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        if isinstance(item, Exception):
            raise item
        return item

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return Fetcher(client, attempts=attempts, backoff_s=1.0, sleep=delays.append), delays, calls


def test_returns_parsed_json() -> None:
    fetcher, delays, calls = fetcher_for([httpx.Response(200, json={"ok": True})])
    assert fetcher.get_json("https://a.example/x") == {"ok": True}
    assert calls["n"] == 1
    assert delays == []


def test_204_means_no_content() -> None:
    fetcher, _, _ = fetcher_for([httpx.Response(204)])
    assert fetcher.get_json("https://a.example/x") is None


def test_retries_server_errors_with_exponential_backoff() -> None:
    fetcher, delays, calls = fetcher_for(
        [httpx.Response(503), httpx.Response(502), httpx.Response(200, json=[1])]
    )
    assert fetcher.get_json("https://a.example/x") == [1]
    assert calls["n"] == 3
    assert delays == [1.0, 2.0]


def test_gives_up_after_the_attempt_limit_and_says_why() -> None:
    fetcher, delays, calls = fetcher_for([httpx.Response(500)], attempts=3)
    with pytest.raises(SourceError, match=r"a\.example failed after 3 attempts \(HTTP 500\)"):
        fetcher.get_json("https://a.example/x")
    assert calls["n"] == 3
    assert len(delays) == 2


def test_honours_retry_after_but_caps_it() -> None:
    fetcher, delays, _ = fetcher_for(
        [
            httpx.Response(429, headers={"retry-after": "7"}),
            httpx.Response(429, headers={"retry-after": "9999"}),
            httpx.Response(200, json={}),
        ]
    )
    fetcher.get_json("https://a.example/x")
    assert delays == [7.0, 30.0]


def test_ignores_an_unparseable_retry_after() -> None:
    fetcher, delays, _ = fetcher_for(
        [httpx.Response(503, headers={"retry-after": "soon"}), httpx.Response(200, json={})]
    )
    fetcher.get_json("https://a.example/x")
    assert delays == [1.0]


def test_retries_network_errors() -> None:
    fetcher, delays, _ = fetcher_for([httpx.ConnectError("boom"), httpx.Response(200, json=1)])
    assert fetcher.get_json("https://a.example/x") == 1
    assert delays == [1.0]


def test_network_error_message_names_the_error_type() -> None:
    fetcher, _, _ = fetcher_for([httpx.ReadTimeout("slow")], attempts=2)
    with pytest.raises(SourceError, match="network error \\(ReadTimeout\\)"):
        fetcher.get_json("https://a.example/x")


def test_retries_a_body_that_is_not_json() -> None:
    fetcher, _, calls = fetcher_for(
        [httpx.Response(200, text="<html>"), httpx.Response(200, json=2)]
    )
    assert fetcher.get_json("https://a.example/x") == 2
    assert calls["n"] == 2


def test_other_client_errors_fail_at_once() -> None:
    fetcher, _, calls = fetcher_for([httpx.Response(400, text="bad parameter")])
    with pytest.raises(SourceError, match="HTTP 400: bad parameter"):
        fetcher.get_json("https://a.example/x")
    assert calls["n"] == 1


def test_at_least_one_attempt_is_made() -> None:
    fetcher, _, calls = fetcher_for([httpx.Response(200, json=0)], attempts=0)
    assert fetcher.get_json("https://a.example/x") == 0
    assert calls["n"] == 1
