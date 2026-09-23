from __future__ import annotations

import os
import time

from lta import LTA, LTAUnsupportedSource

from live_black_box import BASE_URL, temporary_reviewer_api_key


SUPPORTED_URL = os.environ.get(
    "LTA_BASIC_SUPPORTED_URL",
    f"https://example.com/?lta_live_basic={int(time.time())}",
)
UNSUPPORTED_URL = os.environ.get(
    "LTA_UNSUPPORTED_URL",
    "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
)


def main() -> None:
    with temporary_reviewer_api_key() as api_key:
        lta = LTA(api_key=api_key, base_url=BASE_URL, timeout=180, max_retries=2)

        result = lta.read(SUPPORTED_URL, refresh=True)
        assert result.content.strip(), "supported production read returned empty content"
        assert result.source_completeness in {"complete", "partial"}, result.source_completeness
        print(
            f"supported-read: completed source_type={result.source_type} "
            f"completeness={result.source_completeness}"
        )

        try:
            lta.read(UNSUPPORTED_URL)
        except LTAUnsupportedSource:
            print("unsupported-read: LTAUnsupportedSource")
        else:
            raise AssertionError("unsupported production URL unexpectedly succeeded")


if __name__ == "__main__":
    main()
