from __future__ import annotations

from typing import Any, Mapping


class LTAError(Exception):
    """Base exception for LTA API failures."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        retryable: bool = False,
        retry_after_seconds: float | None = None,
        payload: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        self.payload = dict(payload or {})


class LTAAuthenticationError(LTAError):
    pass


class LTAUnsupportedSource(LTAError):
    pass


class LTAPrivateSource(LTAError):
    pass


class LTAInaccessibleSource(LTAError):
    pass


class LTAQuotaExceeded(LTAError):
    pass


class LTARetryableError(LTAError):
    pass


class LTAExtractionFailed(LTAError):
    pass


class LTATimeout(LTAError):
    pass


class LTAInvalidURL(LTAError):
    pass


class LTAProtocolError(LTAError):
    pass
