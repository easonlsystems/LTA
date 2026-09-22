from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import httpx

from .errors import (
    LTAAuthenticationError,
    LTAError,
    LTAExtractionFailed,
    LTAInaccessibleSource,
    LTAInvalidURL,
    LTAPrivateSource,
    LTAProtocolError,
    LTAQuotaExceeded,
    LTARetryableError,
    LTATimeout,
    LTAUnsupportedSource,
)


DEFAULT_BASE_URL = "https://api-production-0383e.up.railway.app"


@dataclass(frozen=True)
class LTAResult:
    job_id: str
    content: str
    source_type: str | None
    source_url: str | None
    canonical_url: str | None
    title: str | None
    creator: str | None
    metadata: Mapping[str, Any]
    evidence: Sequence[Mapping[str, Any]]
    source_completeness: str | None
    truncation_reason: str | None
    content_sections_truncated: Sequence[str]
    units_used: int
    remaining_usage_units: int | None
    raw: Mapping[str, Any]

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "LTAResult":
        job_id = str(payload.get("job_id") or payload.get("id") or "")
        content = payload.get("content")
        if not isinstance(content, str):
            content = payload.get("transcript")
        if not job_id or not isinstance(content, str):
            raise LTAProtocolError(
                "LTA returned a completed result without job_id/content.",
                code="invalid_completed_result",
                payload=payload,
            )
        metadata = payload.get("metadata")
        evidence = payload.get("evidence")
        truncated = payload.get("content_sections_truncated")
        return cls(
            job_id=job_id,
            content=content,
            source_type=_optional_str(payload.get("source_type")),
            source_url=_optional_str(payload.get("source_url")),
            canonical_url=_optional_str(payload.get("canonical_url")),
            title=_optional_str(payload.get("title")),
            creator=_optional_str(payload.get("creator")),
            metadata=dict(metadata) if isinstance(metadata, Mapping) else {},
            evidence=tuple(evidence) if isinstance(evidence, list) else (),
            source_completeness=_optional_str(payload.get("source_completeness")),
            truncation_reason=_optional_str(payload.get("truncation_reason")),
            content_sections_truncated=tuple(str(x) for x in truncated) if isinstance(truncated, list) else (),
            units_used=_int_or_zero(payload.get("units_used")),
            remaining_usage_units=_optional_int(payload.get("remaining_usage_units")),
            raw=dict(payload),
        )


@dataclass(frozen=True)
class LTAReadOutcome:
    """One read_many item. A failed URL never cancels sibling reads."""

    url: str
    result: LTAResult | None = None
    error: LTAError | None = None

    @property
    def ok(self) -> bool:
        return self.result is not None and self.error is None

    def unwrap(self) -> LTAResult:
        if self.result is not None:
            return self.result
        if self.error is not None:
            raise self.error
        raise LTAProtocolError("read_many outcome contained neither result nor error.")


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _optional_int(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _int_or_zero(value: Any) -> int:
    return _optional_int(value) or 0


class LTA:
    """Thin synchronous + asynchronous LTA client."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 120.0,
        request_timeout: float = 20.0,
        max_retries: int = 2,
        poll_interval: float = 0.75,
        max_poll_interval: float = 5.0,
        _transport: httpx.BaseTransport | httpx.AsyncBaseTransport | None = None,
    ) -> None:
        api_key = api_key.strip()
        if not api_key:
            raise ValueError("api_key is required")
        if timeout <= 0 or request_timeout <= 0:
            raise ValueError("timeout and request_timeout must be > 0")
        if max_retries < 0:
            raise ValueError("max_retries must be >= 0")
        if poll_interval <= 0 or max_poll_interval <= 0:
            raise ValueError("poll intervals must be > 0")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = float(timeout)
        self.request_timeout = float(request_timeout)
        self.max_retries = int(max_retries)
        self.poll_interval = float(poll_interval)
        self.max_poll_interval = float(max_poll_interval)
        self._transport = _transport

    def __repr__(self) -> str:
        return f"LTA(base_url={self.base_url!r}, api_key='***')"

    def read(self, url: str, *, refresh: bool = False, timeout: float | None = None) -> LTAResult:
        url = _validate_input_url(url)
        deadline = time.monotonic() + (self.timeout if timeout is None else _positive_timeout(timeout))
        headers = self._headers()
        transport = self._transport if isinstance(self._transport, httpx.BaseTransport) else None
        with httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=self.request_timeout,
            transport=transport,
        ) as client:
            for source_attempt in range(self.max_retries + 1):
                try:
                    payload, status_code = self._request_sync(
                        client, "POST", "/v1/read", deadline, json={"url": url, "refresh": refresh}
                    )
                    return self._resolve_sync(client, payload, status_code, deadline)
                except LTAError as exc:
                    if not exc.retryable or source_attempt >= self.max_retries:
                        raise
                    self._sleep_sync(self._retry_delay(exc, source_attempt), deadline)
        raise AssertionError("unreachable")

    async def read_async(self, url: str, *, refresh: bool = False, timeout: float | None = None) -> LTAResult:
        url = _validate_input_url(url)
        deadline = time.monotonic() + (self.timeout if timeout is None else _positive_timeout(timeout))
        headers = self._headers()
        transport = self._transport if isinstance(self._transport, httpx.AsyncBaseTransport) else None
        async with httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=self.request_timeout,
            transport=transport,
        ) as client:
            for source_attempt in range(self.max_retries + 1):
                try:
                    payload, status_code = await self._request_async(
                        client, "POST", "/v1/read", deadline, json={"url": url, "refresh": refresh}
                    )
                    return await self._resolve_async(client, payload, status_code, deadline)
                except LTAError as exc:
                    if not exc.retryable or source_attempt >= self.max_retries:
                        raise
                    await self._sleep_async(self._retry_delay(exc, source_attempt), deadline)
        raise AssertionError("unreachable")

    async def read_many(
        self,
        urls: Iterable[str],
        *,
        concurrency: int = 4,
        refresh: bool = False,
        timeout: float | None = None,
    ) -> list[LTAReadOutcome]:
        """Read URLs concurrently without one failure cancelling siblings."""

        if concurrency < 1:
            raise ValueError("concurrency must be >= 1")
        ordered = list(urls)
        semaphore = asyncio.Semaphore(concurrency)

        async def run_one(url: str) -> LTAReadOutcome:
            async with semaphore:
                try:
                    result = await self.read_async(url, refresh=refresh, timeout=timeout)
                    return LTAReadOutcome(url=url, result=result)
                except LTAError as exc:
                    return LTAReadOutcome(url=url, error=exc)

        return list(await asyncio.gather(*(run_one(url) for url in ordered)))

    def _headers(self) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self.api_key}",
            "accept": "application/json",
            "user-agent": "lta-python/0.1.0",
        }

    def _resolve_sync(
        self, client: httpx.Client, payload: Mapping[str, Any], status_code: int, deadline: float
    ) -> LTAResult:
        delay = self.poll_interval
        while True:
            status = str(payload.get("status") or "")
            if status_code == 200 and status == "completed":
                return LTAResult.from_payload(payload)
            if status_code == 202 or status == "processing":
                job_id = str(payload.get("job_id") or payload.get("id") or "")
                if not job_id:
                    raise LTAProtocolError("LTA returned processing without a job_id.", payload=payload)
                requested = _retry_after(payload)
                self._sleep_sync(requested if requested is not None else delay, deadline)
                delay = min(self.max_poll_interval, max(self.poll_interval, delay * 1.6))
                payload, status_code = self._request_sync(client, "GET", f"/v1/jobs/{job_id}", deadline)
                continue
            raise _error_from_payload(payload, status_code)

    async def _resolve_async(
        self, client: httpx.AsyncClient, payload: Mapping[str, Any], status_code: int, deadline: float
    ) -> LTAResult:
        delay = self.poll_interval
        while True:
            status = str(payload.get("status") or "")
            if status_code == 200 and status == "completed":
                return LTAResult.from_payload(payload)
            if status_code == 202 or status == "processing":
                job_id = str(payload.get("job_id") or payload.get("id") or "")
                if not job_id:
                    raise LTAProtocolError("LTA returned processing without a job_id.", payload=payload)
                requested = _retry_after(payload)
                await self._sleep_async(requested if requested is not None else delay, deadline)
                delay = min(self.max_poll_interval, max(self.poll_interval, delay * 1.6))
                payload, status_code = await self._request_async(client, "GET", f"/v1/jobs/{job_id}", deadline)
                continue
            raise _error_from_payload(payload, status_code)

    def _request_sync(
        self, client: httpx.Client, method: str, path: str, deadline: float, **kwargs: Any
    ) -> tuple[Mapping[str, Any], int]:
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            remaining = _remaining(deadline)
            try:
                response = client.request(method, path, timeout=min(self.request_timeout, remaining), **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    raise LTARetryableError(
                        "LTA could not be reached after retries.",
                        code="transport_error",
                        retryable=True,
                    ) from exc
                self._sleep_sync(_backoff(attempt), deadline)
                continue
            payload = _json_payload(response)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= self.max_retries:
                    raise LTARetryableError(
                        str(payload.get("message") or f"LTA returned HTTP {response.status_code}."),
                        code=_optional_str(payload.get("error_code") or payload.get("error")),
                        status_code=response.status_code,
                        retryable=True,
                        retry_after_seconds=_retry_after(payload),
                        payload=payload,
                    )
                self._sleep_sync(_retry_after(payload) or _backoff(attempt), deadline)
                continue
            return payload, response.status_code
        raise LTARetryableError("LTA request failed.", code="transport_error", retryable=True) from last_error

    async def _request_async(
        self, client: httpx.AsyncClient, method: str, path: str, deadline: float, **kwargs: Any
    ) -> tuple[Mapping[str, Any], int]:
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            remaining = _remaining(deadline)
            try:
                response = await client.request(method, path, timeout=min(self.request_timeout, remaining), **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    raise LTARetryableError(
                        "LTA could not be reached after retries.",
                        code="transport_error",
                        retryable=True,
                    ) from exc
                await self._sleep_async(_backoff(attempt), deadline)
                continue
            payload = _json_payload(response)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= self.max_retries:
                    raise LTARetryableError(
                        str(payload.get("message") or f"LTA returned HTTP {response.status_code}."),
                        code=_optional_str(payload.get("error_code") or payload.get("error")),
                        status_code=response.status_code,
                        retryable=True,
                        retry_after_seconds=_retry_after(payload),
                        payload=payload,
                    )
                await self._sleep_async(_retry_after(payload) or _backoff(attempt), deadline)
                continue
            return payload, response.status_code
        raise LTARetryableError("LTA request failed.", code="transport_error", retryable=True) from last_error

    def _sleep_sync(self, seconds: float, deadline: float) -> None:
        remaining = _remaining(deadline)
        time.sleep(min(max(0.0, seconds), remaining))
        _remaining(deadline)

    async def _sleep_async(self, seconds: float, deadline: float) -> None:
        remaining = _remaining(deadline)
        await asyncio.sleep(min(max(0.0, seconds), remaining))
        _remaining(deadline)

    def _retry_delay(self, exc: LTAError, attempt: int) -> float:
        return exc.retry_after_seconds if exc.retry_after_seconds is not None else _backoff(attempt)


def _positive_timeout(value: float) -> float:
    value = float(value)
    if value <= 0:
        raise ValueError("timeout must be > 0")
    return value


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise LTATimeout("Timed out waiting for LTA.", code="timeout")
    return remaining


def _validate_input_url(url: str) -> str:
    value = str(url).strip()
    if not value:
        raise LTAInvalidURL("url is required", code="INVALID_URL")
    return value


def _backoff(attempt: int) -> float:
    return min(5.0, 0.5 * (2**attempt))


def _retry_after(payload: Mapping[str, Any]) -> float | None:
    value = payload.get("retry_after_seconds")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
        return min(float(value), 30.0)
    return None


def _json_payload(response: httpx.Response) -> Mapping[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise LTAProtocolError(
            f"LTA returned non-JSON HTTP {response.status_code}.",
            status_code=response.status_code,
        ) from exc
    if not isinstance(payload, Mapping):
        raise LTAProtocolError(
            "LTA returned a JSON value that was not an object.",
            status_code=response.status_code,
        )
    return payload


def _error_from_payload(payload: Mapping[str, Any], status_code: int) -> LTAError:
    code = _optional_str(payload.get("error_code") or payload.get("error"))
    message = str(payload.get("message") or code or f"LTA request failed with HTTP {status_code}.")
    retryable = bool(payload.get("retryable"))
    retry_after = _retry_after(payload)
    status = str(payload.get("status") or "")

    kwargs = dict(
        code=code,
        status_code=status_code,
        retryable=retryable,
        retry_after_seconds=retry_after,
        payload=payload,
    )

    if status_code == 401 or code in {"AUTH_REQUIRED", "unauthorized"}:
        return LTAAuthenticationError(message, **kwargs)
    if status_code == 402 or status == "payment_required" or code == "QUOTA_EXCEEDED":
        return LTAQuotaExceeded(message, **kwargs)
    if code == "UNSUPPORTED_URL":
        return LTAUnsupportedSource(message, **kwargs)
    if code == "PRIVATE_MEDIA":
        return LTAPrivateSource(message, **kwargs)
    if code == "INVALID_URL" or code == "invalid_request":
        return LTAInvalidURL(message, **kwargs)
    if code in {"MEDIA_NOT_FOUND", "LOGIN_REQUIRED", "GEO_BLOCKED", "PLATFORM_BLOCKED"}:
        return LTAInaccessibleSource(message, **kwargs)
    if code in {"EXTRACTION_FAILED", "TRANSCRIPTION_FAILED", "DOWNLOAD_TOO_LARGE", "DURATION_LIMIT_EXCEEDED"}:
        return LTAExtractionFailed(message, **kwargs)
    if retryable or code == "RATE_LIMITED":
        return LTARetryableError(message, **{**kwargs, "retryable": True})
    return LTAError(message, **kwargs)
