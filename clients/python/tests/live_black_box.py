from __future__ import annotations

import asyncio
import html
import os
import re
import time
from contextlib import contextmanager

import httpx

from lta import (
    LTA,
    LTAExtractionFailed,
    LTAInaccessibleSource,
    LTAPrivateSource,
    LTAUnsupportedSource,
)


BASE_URL = os.environ.get(
    "LINK2AI_PRODUCTION_URL",
    os.environ.get("LTA_BASE_URL", "https://api-production-0383e.up.railway.app"),
).rstrip("/")
REVIEWER_EMAIL = os.environ.get("LINK2AI_CERT_EMAIL", "").strip()
REVIEWER_PASSWORD = os.environ.get("LINK2AI_CERT_PASSWORD", "")

TELEGRAM_URL = os.environ.get("LTA_TELEGRAM_SHAPE_URL", "https://example.com/")
YOUTUBE_URL = os.environ.get("LTA_KB_YOUTUBE_URL", "https://www.youtube.com/watch?v=jNQXAC9IVRw")
X_URL = os.environ.get("LTA_KB_X_URL", "https://x.com/githubstatus/status/2039764648241598521")
WEB_URL = os.environ.get("LTA_KB_WEB_URL", "https://example.com/")
PDF_URL = os.environ.get(
    "LTA_KB_PDF_URL",
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
)
UNSUPPORTED_URL = os.environ.get(
    "LTA_UNSUPPORTED_URL",
    "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
)
FAILED_URL = os.environ.get("LTA_FAILED_URL", "https://x.com/githubstatus/status/1")


def _hidden(page: str, name: str) -> str:
    match = re.search(
        rf'name=["\']{re.escape(name)}["\'][^>]*value=["\']([^"\']+)["\']',
        page,
        re.I,
    )
    if not match:
        raise RuntimeError(f"Expected hidden field {name}")
    return html.unescape(match.group(1))


def _downstream_summarizer_shape(content: str) -> str:
    # A real target replaces this with its own LLM call. This probe only verifies
    # that caller code receives source text directly, with no polling loop.
    return " ".join(content.split())[:240]


@contextmanager
def temporary_reviewer_api_key():
    if not REVIEWER_EMAIL or not REVIEWER_PASSWORD:
        raise RuntimeError(
            "Live Python black-box BLOCKED: configure LINK2AI_CERT_EMAIL and "
            "LINK2AI_CERT_PASSWORD for the quota-exempt reviewer account."
        )

    key = ""
    key_id = ""
    with httpx.Client(base_url=BASE_URL, follow_redirects=False, timeout=20) as web:
        origin = {"origin": BASE_URL}
        login = web.post(
            "/auth/reviewer",
            data={"email": REVIEWER_EMAIL, "password": REVIEWER_PASSWORD, "return_to": "/account"},
            headers=origin,
        )
        if login.status_code != 302:
            raise RuntimeError(f"Reviewer sign-in failed with HTTP {login.status_code}")

        account = web.get("/account")
        if account.status_code != 200:
            raise RuntimeError(f"Account page failed with HTTP {account.status_code}")
        csrf = _hidden(account.text, "csrf")

        created = web.post(
            "/account/api-keys",
            data={"csrf": csrf, "name": f"Python live certification {int(time.time())}"},
            headers=origin,
        )
        if created.status_code != 200:
            raise RuntimeError(f"Temporary API key creation failed with HTTP {created.status_code}")

        key_match = re.search(r"l2ai_live_[A-Za-z0-9_-]+", created.text)
        id_match = re.search(r'data-api-key-id="([0-9a-f-]+)"', created.text, re.I)
        if not key_match or not id_match:
            raise RuntimeError("Temporary API key response did not contain key + key id")
        key = key_match.group(0)
        key_id = id_match.group(1)

        try:
            usage = httpx.get(
                BASE_URL + "/v1/usage",
                headers={"authorization": f"Bearer {key}", "accept": "application/json"},
                timeout=20,
            )
            data = usage.json() if usage.headers.get("content-type", "").startswith("application/json") else {}
            if usage.status_code != 200 or data.get("quota_exempt") is not True:
                raise RuntimeError(
                    "Live Python black-box requires a quota-exempt reviewer; refusing to spend real user units."
                )
            yield key
        finally:
            if key_id:
                try:
                    account = web.get("/account")
                    if account.status_code == 200:
                        csrf = _hidden(account.text, "csrf")
                        web.post(
                            "/account/api-keys/revoke",
                            data={"csrf": csrf, "key_id": key_id},
                            headers=origin,
                        )
                finally:
                    key = ""


async def run_shapes(api_key: str) -> None:
    lta = LTA(api_key=api_key, base_url=BASE_URL, timeout=180, max_retries=2)

    # 1. Telegram summarizer shape: caller never implements polling.
    telegram = await lta.read_async(TELEGRAM_URL, refresh=True)
    summary_input = _downstream_summarizer_shape(telegram.content)
    assert summary_input, "Telegram-shape source content was empty"
    print(f"telegram-shape: {telegram.source_type} -> downstream content ready")

    # 2. Knowledge-base shape: heterogeneous sources normalize to LTAResult.
    kb = [
        ("youtube", YOUTUBE_URL),
        ("x", X_URL),
        ("web", WEB_URL),
        ("pdf", PDF_URL),
    ]
    for expected, url in kb:
        result = await lta.read_async(url)
        assert result.source_type == expected, (expected, result.source_type)
        assert result.content.strip(), f"{expected} returned empty content"
        assert result.source_completeness in {"complete", "partial"}, result.source_completeness
        print(f"knowledge-base-shape: {expected} normalized")

    try:
        await lta.read_async(UNSUPPORTED_URL)
    except LTAUnsupportedSource:
        print("knowledge-base-shape: unsupported source cleanly falls back")
    else:
        raise AssertionError("Unsupported source unexpectedly succeeded")

    # 3. Multi-source shape.
    # Prewarm one unique URL so read_many has a cache-hit sibling. A second unique
    # URL remains cold so it follows the server's normal queued/async path.
    stamp = int(time.time())
    cache_url = f"https://example.com/?lta_cache_probe={stamp}"
    cold_url = f"https://example.com/?lta_async_probe={stamp}"
    await lta.read_async(cache_url, refresh=True)

    outcomes = await lta.read_many(
        [WEB_URL, cold_url, cache_url, UNSUPPORTED_URL, FAILED_URL],
        concurrency=4,
    )
    assert len(outcomes) == 5
    assert outcomes[0].ok, outcomes[0].error
    assert outcomes[1].ok, outcomes[1].error
    assert outcomes[2].ok, outcomes[2].error
    assert isinstance(outcomes[3].error, LTAUnsupportedSource), type(outcomes[3].error)
    assert isinstance(
        outcomes[4].error,
        (LTAExtractionFailed, LTAInaccessibleSource, LTAPrivateSource),
    ), type(outcomes[4].error)
    print("multi-source-shape: sibling successes survived unsupported + failed URLs")


def main() -> None:
    with temporary_reviewer_api_key() as api_key:
        asyncio.run(run_shapes(api_key))


if __name__ == "__main__":
    main()
