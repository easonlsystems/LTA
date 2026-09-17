#!/usr/bin/env python3
import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def output(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main():
    if len(sys.argv) < 2:
        output({"ok": False, "error_type": "InvalidInput", "message": "missing video id"})
        return
    video_id = sys.argv[1]
    requested = (sys.argv[2] if len(sys.argv) > 2 else "auto").strip().lower()
    try:
        tracks = list(YouTubeTranscriptApi().list(video_id))
        if not tracks:
            output({"ok": False, "error_type": "NoTranscriptFound", "message": "no transcript tracks"})
            return

        selected = None
        if requested and requested != "auto":
            selected = next((t for t in tracks if t.language_code.lower() == requested), None)
            if selected is None:
                base = requested.split("-", 1)[0]
                selected = next((t for t in tracks if t.language_code.lower().split("-", 1)[0] == base), None)
        if selected is None:
            selected = next((t for t in tracks if not t.is_generated), tracks[0])

        rows = selected.fetch()
        segments = []
        for row in rows:
            text = " ".join(str(row.text).split())
            start = float(row.start)
            duration = float(row.duration)
            if not text or start < 0 or duration <= 0:
                continue
            segments.append({"start": start, "end": start + duration, "text": text})
        if not segments:
            output({"ok": False, "error_type": "NoTranscriptFound", "message": "transcript was empty"})
            return
        output({"ok": True, "language": selected.language_code, "generated": bool(selected.is_generated), "segments": segments})
    except Exception as exc:
        output({"ok": False, "error_type": type(exc).__name__, "message": str(exc)[:2400]})


if __name__ == "__main__":
    main()
