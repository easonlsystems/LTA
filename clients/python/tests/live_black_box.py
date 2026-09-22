from __future__ import annotations

import asyncio
import os
import time

from lta import (
    LTA,
    LTAExtractionFailed,
    LTAInaccessibleSource,
    LTAPrivateSource,
    LTAUnsupportedSource,
)


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for live black-box verification")
    return value


API_KEY = required("LTA_API_KEY")
BASE_URL = os.environ.get("LTA_BASE_URL", "https://api-production-0383e.up.railway.app").rstrip("/")

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


def downstream_summarizer_shape(content: str) -> str:
    # The point of this probe is that downstream code receives source text directly.
    # A real workflow can replace this with its own LLM call.
    return " ".join(content.split())[:240]


async def main() -> None:
    lta = LTA(api_key=API_KEY, base_url=BASE_URL, timeout=180, max_retries=2)

    # 1. Telegram summarizer shape: caller never implements polling.
    telegram = await lta.read_async(TELEGRAM_URL, refresh=True)
    summary_input = downstream_summarizer_shape(telegram.content)
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
        fallback = "existing_fetcher_would_run"
        assert fallback
        print("knowledge-base-shape: unsupported source cleanly falls back")
    else:
        raise AssertionError("Unsupported source unexpectedly succeeded")

    # 3. Multi-source shape.
    # Prewarm one unique URL so read_many sees a cache-hit sibling. Another unique URL
    # is left cold so the server can take its normal async processing path.
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


if __name__ == "__main__":
    asyncio.run(main())
