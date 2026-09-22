import asyncio
import json
import unittest
from urllib.parse import urlparse

import httpx

from lta import (
    LTA,
    LTAExtractionFailed,
    LTAQuotaExceeded,
    LTAUnsupportedSource,
)


def completed(job_id: str, url: str, source_type: str = "web", content: str = "source body"):
    return {
        "id": job_id,
        "job_id": job_id,
        "status": "completed",
        "source_type": source_type,
        "source_url": url,
        "canonical_url": url,
        "content": content,
        "source_completeness": "complete",
        "units_used": 1,
        "remaining_usage_units": 99,
        "metadata": {},
        "evidence": [],
    }


class TestSyncRead(unittest.TestCase):
    def test_telegram_shape_hides_polling(self):
        calls = []
        job_id = "11111111-1111-4111-8111-111111111111"
        url = "https://example.com/story"

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, request.url.path))
            if request.method == "POST":
                return httpx.Response(
                    202,
                    json={
                        "id": job_id,
                        "job_id": job_id,
                        "status": "processing",
                        "retry_after_seconds": 0,
                    },
                )
            return httpx.Response(200, json=completed(job_id, url, content="A long source for downstream summarization."))

        lta = LTA(
            "test-key",
            base_url="https://lta.test",
            timeout=2,
            poll_interval=0.001,
            max_poll_interval=0.001,
            _transport=httpx.MockTransport(handler),
        )
        result = lta.read(url)
        downstream_summary = result.content.split(".")[0]

        self.assertEqual(downstream_summary, "A long source for downstream summarization")
        self.assertEqual(calls, [("POST", "/v1/read"), ("GET", f"/v1/jobs/{job_id}")])

    def test_unsupported_is_typed_for_existing_fallback(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                422,
                json={
                    "status": "failed",
                    "error": "UNSUPPORTED_URL",
                    "error_code": "UNSUPPORTED_URL",
                    "message": "Unsupported",
                    "retryable": False,
                },
            )

        lta = LTA("test-key", base_url="https://lta.test", _transport=httpx.MockTransport(handler))
        with self.assertRaises(LTAUnsupportedSource):
            lta.read("https://unsupported.example/item")

    def test_payment_required_is_typed(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                402,
                json={
                    "status": "payment_required",
                    "error_code": "QUOTA_EXCEEDED",
                    "message": "Not enough processing units",
                    "retryable": False,
                    "remaining_usage_units": 2,
                    "required_usage_units": 5,
                },
            )

        lta = LTA("test-key", base_url="https://lta.test", _transport=httpx.MockTransport(handler))
        with self.assertRaises(LTAQuotaExceeded) as raised:
            lta.read("https://example.com/large-source")
        self.assertEqual(raised.exception.payload["remaining_usage_units"], 2)
        self.assertEqual(raised.exception.payload["required_usage_units"], 5)

    def test_retryable_typed_error_retries_then_succeeds(self):
        calls = 0
        job_id = "99999999-9999-4999-8999-999999999999"
        url = "https://example.com/retry"

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(
                    422,
                    json={
                        "status": "failed",
                        "error_code": "EXTRACTION_FAILED",
                        "message": "Temporary extractor failure",
                        "retryable": True,
                        "retry_after_seconds": 0,
                    },
                )
            return httpx.Response(200, json=completed(job_id, url, content="recovered content"))

        lta = LTA(
            "test-key",
            base_url="https://lta.test",
            max_retries=1,
            poll_interval=0.001,
            _transport=httpx.MockTransport(handler),
        )
        result = lta.read(url)
        self.assertEqual(result.content, "recovered content")
        self.assertEqual(calls, 2)


class TestAsyncShapes(unittest.IsolatedAsyncioTestCase):
    async def test_knowledge_base_shape_normalizes_multiple_source_types(self):
        urls = {
            "https://youtube.example/watch?v=1": "youtube",
            "https://x.example/post/1": "x",
            "https://web.example/article": "web",
            "https://pdf.example/file.pdf": "pdf",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content.decode())
            url = body["url"]
            source_type = urls[url]
            job_id = {
                "youtube": "22222222-2222-4222-8222-222222222222",
                "x": "33333333-3333-4333-8333-333333333333",
                "web": "44444444-4444-4444-8444-444444444444",
                "pdf": "55555555-5555-4555-8555-555555555555",
            }[source_type]
            return httpx.Response(200, json=completed(job_id, url, source_type, f"{source_type} normalized content"))

        lta = LTA("test-key", base_url="https://lta.test", _transport=httpx.MockTransport(handler))
        for url, expected_type in urls.items():
            result = await lta.read_async(url)
            self.assertEqual(result.source_type, expected_type)
            self.assertEqual(result.content, f"{expected_type} normalized content")
            self.assertEqual(result.source_completeness, "complete")

    async def test_read_many_keeps_successes_when_siblings_fail(self):
        jobs = {}
        counters = {}

        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                job_id = request.url.path.rsplit("/", 1)[-1]
                url = jobs[job_id]
                return httpx.Response(200, json=completed(job_id, url, "youtube", "async content"))

            body = json.loads(request.content.decode())
            url = body["url"]
            key = urlparse(url).netloc
            counters[key] = counters.get(key, 0) + 1

            if key == "async.example":
                job_id = "66666666-6666-4666-8666-666666666666"
                jobs[job_id] = url
                return httpx.Response(
                    202,
                    json={"id": job_id, "job_id": job_id, "status": "processing", "retry_after_seconds": 0},
                )
            if key == "unsupported.example":
                return httpx.Response(
                    422,
                    json={
                        "status": "failed",
                        "error_code": "UNSUPPORTED_URL",
                        "message": "Unsupported",
                        "retryable": False,
                    },
                )
            if key == "failed.example":
                return httpx.Response(
                    422,
                    json={
                        "status": "failed",
                        "error_code": "EXTRACTION_FAILED",
                        "message": "Could not extract",
                        "retryable": False,
                    },
                )
            source_type = "web"
            content = "cached content" if key == "cache.example" else "immediate content"
            suffix = "77777777-7777-4777-8777-777777777777" if key == "cache.example" else "88888888-8888-4888-8888-888888888888"
            return httpx.Response(200, json=completed(suffix, url, source_type, content))

        lta = LTA(
            "test-key",
            base_url="https://lta.test",
            timeout=2,
            poll_interval=0.001,
            max_poll_interval=0.001,
            _transport=httpx.MockTransport(handler),
        )
        urls = [
            "https://immediate.example/a",
            "https://async.example/b",
            "https://cache.example/c",
            "https://unsupported.example/d",
            "https://failed.example/e",
        ]
        outcomes = await lta.read_many(urls, concurrency=3)

        self.assertEqual([item.url for item in outcomes], urls)
        self.assertEqual([item.ok for item in outcomes], [True, True, True, False, False])
        self.assertEqual(outcomes[0].result.content, "immediate content")
        self.assertEqual(outcomes[1].result.content, "async content")
        self.assertEqual(outcomes[2].result.content, "cached content")
        self.assertIsInstance(outcomes[3].error, LTAUnsupportedSource)
        self.assertIsInstance(outcomes[4].error, LTAExtractionFailed)


if __name__ == "__main__":
    unittest.main()
