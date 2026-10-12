"""Redis client + rate limiter (fixed-window counters) with an in-memory fallback for tests/dev."""

from __future__ import annotations

import time
from collections import defaultdict

import structlog
from redis.asyncio import Redis

from app.core.config import settings
from app.core.errors import TooManyRequests

log = structlog.get_logger(__name__)
_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=2)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


class _MemoryCounters:
    def __init__(self) -> None:
        self._data: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))

    def incr(self, key: str, window: int) -> int:
        count, expires = self._data[key]
        now = time.monotonic()
        if expires < now:
            count, expires = 0, now + window
        count += 1
        self._data[key] = (count, expires)
        return count

    def reset(self) -> None:
        self._data.clear()


memory_counters = _MemoryCounters()


async def hit(key: str, limit: int, window_seconds: int = 60) -> None:
    """Count a request against ``key``; raise 429 if over ``limit`` within the window."""
    if not settings.RATE_LIMIT_ENABLED:
        return
    bucket = f"rl:{key}:{int(time.time() // window_seconds)}"
    try:
        r = get_redis()
        pipe = r.pipeline()
        pipe.incr(bucket)
        pipe.expire(bucket, window_seconds + 1)
        count, _ = await pipe.execute()
    except Exception:  # Redis unavailable: degrade to per-process limiting rather than failing open entirely
        count = memory_counters.incr(bucket, window_seconds)
    if int(count) > limit:
        retry = window_seconds - int(time.time() % window_seconds)
        raise TooManyRequests(retry_after=max(retry, 1))
