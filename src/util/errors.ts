export type Link2AIErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'PRIVATE_MEDIA'
  | 'MEDIA_NOT_FOUND'
  | 'LOGIN_REQUIRED'
  | 'GEO_BLOCKED'
  | 'RATE_LIMITED'
  | 'PLATFORM_BLOCKED'
  | 'EXTRACTION_FAILED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'DURATION_LIMIT_EXCEEDED'
  | 'QUOTA_EXCEEDED'
  | 'AUTH_REQUIRED'
  | 'JOB_NOT_FOUND'
  | 'INVALID_TIME_RANGE'
  | 'TIMELINE_UNAVAILABLE'
  | 'TRANSCRIPTION_FAILED'
  | 'INTERNAL_ERROR';

export class Link2AIError extends Error {
  constructor(
    public readonly code: Link2AIErrorCode,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'Link2AIError';
  }
}

export function asLink2AIError(err: unknown): Link2AIError {
  if (err instanceof Link2AIError) return err;
  // Unknown runtime errors may contain filesystem paths, SQL details or provider internals.
  // Log the original error at the call site, but never persist/return that raw message.
  void err;
  return new Link2AIError('INTERNAL_ERROR', 'The service hit an internal error while processing this link.', 500, false);
}
