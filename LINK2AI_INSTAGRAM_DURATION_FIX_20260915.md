# Link2AI Instagram duration recovery hotfix — 2026-09-15

Production incident reproduced from Railway worker logs:
- platform: instagram
- error_code: EXTRACTION_FAILED
- error_message: `The video duration could not be determined.`
- 3 retries failed before ASR started.

Fix:
1. yt-dlp metadata no longer hard-fails when top-level duration is absent.
2. Duration is recovered from duration_string / format metadata / fragments when available.
3. If metadata still has no duration, the worker downloads the public audio, probes the actual duration with ffprobe, then reserves quota before ASR.
4. Quota and max-duration checks still use a real positive duration and round upward, so this does not create an under-count or duration-limit bypass.
5. Existing transcript cache can supply the known duration without re-extraction.
6. Captions remain preferred; if captions are usable, ASR is avoided.

Files changed:
- src/resolvers/ytdlp.ts
- src/media/audio.ts
- src/worker/processor.ts
- src/worker/jobs.ts
