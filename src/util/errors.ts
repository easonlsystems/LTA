export type Link2AIErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'PRIVATE_MEDIA'
  | 'MEDIA_NOT_FOUND'
  | 'LOGIN_REQUIRED'
  | 'GEO_BLOCKED'
  | 'RATE_LIMITED'
  | 'PLATFORM_BLOCKED'
  | 'CONTENT_RESTRICTED'
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


export function publicErrorMessage(code:string):string{
  switch(code){
    case 'INVALID_URL': return 'This URL is not valid.';
    case 'UNSUPPORTED_URL': return 'This link type is not supported by LTA.';
    case 'PRIVATE_MEDIA': return 'This source is not publicly accessible.';
    case 'MEDIA_NOT_FOUND': return 'LTA could not find this public source.';
    case 'LOGIN_REQUIRED': return 'This source requires sign-in and cannot be read through LTA.';
    case 'GEO_BLOCKED': return 'This source is unavailable from LTA’s current processing region.';
    case 'RATE_LIMITED': return 'The source platform is temporarily rate-limiting access. Try again later.';
    case 'PLATFORM_BLOCKED': return 'This source is not available through this LTA distribution. No processing units were charged.';
    case 'CONTENT_RESTRICTED': return 'This source is outside LTA’s general-audience ChatGPT scope. No processing units were charged.';
    case 'EXTRACTION_FAILED': return 'LTA could not retrieve a complete, reliable result from this source. No processing units were charged.';
    case 'DOWNLOAD_TOO_LARGE': return 'This source could not be processed within the current infrastructure limits. No processing units were charged.';
    case 'DURATION_LIMIT_EXCEEDED': return 'This source could not be processed within the current service limits. No processing units were charged.';
    case 'QUOTA_EXCEEDED': return 'The connected LTA account does not have enough processing units for this source.';
    case 'AUTH_REQUIRED': return 'Reconnect LTA and try again.';
    case 'JOB_NOT_FOUND': return 'This LTA reading job is no longer available.';
    case 'INVALID_TIME_RANGE': return 'The requested time range is invalid.';
    case 'TIMELINE_UNAVAILABLE': return 'This processed source does not have a usable timestamped timeline.';
    case 'TRANSCRIPTION_FAILED': return 'LTA could not produce a reliable transcript from this source. No processing units were charged.';
    case 'TRANSCRIPT_EXPIRED': return 'This temporary LTA result has expired. Read the original link again if the source is still needed.';
    case 'PAYMENT_SESSION_EXPIRED': return 'This previous LTA request has expired. Read the original link again if the source is still needed.';
    case 'INTERNAL_ERROR': return 'LTA hit an internal error while processing this request. No processing units were charged.';
    default: return 'LTA could not complete this request.';
  }
}
