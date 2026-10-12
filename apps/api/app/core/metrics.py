"""Lightweight in-process metrics (request latency/status, AI calls) exposed on the admin health dashboard
and in Prometheus text format at /api/v1/metrics. In production, OpenTelemetry/CloudWatch exporters
can be attached without changing call sites."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.requests: dict[str, int] = defaultdict(int)
        self.status: dict[str, int] = defaultdict(int)
        self.latencies: deque[float] = deque(maxlen=5000)
        self.route_latency: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=500))
        self.ai_calls: dict[str, int] = defaultdict(int)
        self.ai_errors: int = 0

    def observe_request(self, method: str, route: Any, status: int, ms: float) -> None:
        path = getattr(route, "path", "unmatched")
        key = f"{method} {path}"
        with self._lock:
            self.requests[key] += 1
            self.status[f"{status // 100}xx"] += 1
            self.latencies.append(ms)
            self.route_latency[key].append(ms)

    def observe_ai(self, feature: str, ok: bool) -> None:
        with self._lock:
            self.ai_calls[feature] += 1
            if not ok:
                self.ai_errors += 1

    @staticmethod
    def _pct(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        values = sorted(values)
        idx = min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))
        return round(values[idx], 1)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            lat = list(self.latencies)
            slow = sorted(
                ((k, self._pct(list(v), 95)) for k, v in self.route_latency.items()), key=lambda x: -x[1]
            )[:10]
            return {
                "uptime_seconds": int(time.time() - self.started_at),
                "requests_total": sum(self.requests.values()),
                "status_counts": dict(self.status),
                "latency_ms": {
                    "p50": self._pct(lat, 50),
                    "p95": self._pct(lat, 95),
                    "p99": self._pct(lat, 99),
                },
                "slowest_routes_p95": [{"route": k, "p95_ms": v} for k, v in slow],
                "ai_calls": dict(self.ai_calls),
                "ai_errors": self.ai_errors,
            }

    def prometheus(self) -> str:
        snap = self.snapshot()
        lines = [
            "# TYPE praxis_requests_total counter",
            f"praxis_requests_total {snap['requests_total']}",
            "# TYPE praxis_request_latency_ms summary",
        ]
        for q, v in snap["latency_ms"].items():
            lines.append(f'praxis_request_latency_ms{{quantile="{q}"}} {v}')
        for status, count in snap["status_counts"].items():
            lines.append(f'praxis_responses_total{{class="{status}"}} {count}')
        for feature, count in snap["ai_calls"].items():
            lines.append(f'praxis_ai_calls_total{{feature="{feature}"}} {count}')
        return "\n".join(lines) + "\n"


metrics = Metrics()
