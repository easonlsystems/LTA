from youtube_transcript_api import YouTubeTranscriptApi

for video_id in ['jJiw4CdAanw', 'aqz-KE-bpKQ', 'dQw4w9WgXcQ']:
    print(f'=== {video_id} ===')
    try:
        api = YouTubeTranscriptApi()
        tracks = api.list(video_id)
        tracks_list = list(tracks)
        print('tracks=', [(t.language_code, t.is_generated) for t in tracks_list[:8]])
        if tracks_list:
            rows = tracks_list[0].fetch()
            print('rows=', len(rows))
            print('sample=', [(r.text, r.start, r.duration) for r in rows[:3]])
    except Exception as exc:
        print(type(exc).__name__, str(exc)[:1600])
