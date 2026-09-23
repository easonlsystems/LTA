# LTA Python client

A deliberately thin client over the existing LTA REST API. It does not add a second source engine or a new server-side batch contract.

## Install

The package is prepared for public distribution as `lta-client`. After the
first PyPI release is published, the external install command is:

```bash
pip install lta-client
```

Until that first release exists, do not advertise the command as live. The
monorepo is private, so external users must not be pointed at a
`git+https://github.com/easonlsystems/link2ai...` install URL.

Release builds are standard wheel + sdist artifacts and are published through
the dedicated PyPI Trusted Publishing workflow.

## Read one link

```python
from lta import LTA

lta = LTA(api_key="l2ai_live_...")
result = lta.read("https://example.com/article")

print(result.content)
print(result.source_type)
print(result.source_completeness)
```

`read()` internally handles:

- `200 completed`
- `202 processing` and `/v1/jobs/{id}` polling
- `retry_after_seconds`
- bounded retry/backoff for transient transport/server failures
- retryable source failures
- one overall timeout
- normalized completed results
- typed LTA errors

Async:

```python
result = await lta.read_async(url)
```

## Keep your existing fallback

Typed errors are intended to make LTA easy to insert before an existing extractor:

```python
from lta import LTA, LTAUnsupportedSource, LTAInaccessibleSource

lta = LTA(api_key="...")

try:
    return lta.read(url).content
except (LTAUnsupportedSource, LTAInaccessibleSource):
    return existing_fetcher(url)
```

Useful error classes include:

- `LTAUnsupportedSource`
- `LTAPrivateSource`
- `LTAInaccessibleSource`
- `LTAQuotaExceeded`
- `LTARetryableError`
- `LTAExtractionFailed`
- `LTATimeout`
- `LTAAuthenticationError`

Every `LTAError` preserves `code`, `status_code`, `retryable`, `retry_after_seconds`, and the safe parsed API payload when available.

## Read many links

This is client-side concurrency. It still calls the existing `/v1/read` endpoint for each URL.

```python
outcomes = await lta.read_many(urls, concurrency=4)

for item in outcomes:
    if item.ok:
        print(item.url, item.result.content[:120])
    else:
        print(item.url, type(item.error).__name__, item.error.code)
```

One URL failing does not cancel or discard sibling results. Call `item.unwrap()` when you want the single-read exception behavior for a particular item.

## Configuration

```python
lta = LTA(
    api_key="...",
    timeout=120,         # whole read lifecycle, including polling
    request_timeout=20,  # individual HTTP request
    max_retries=2,
)
```

The default base URL is the LTA production API. Pass `base_url=` for local or test environments.
