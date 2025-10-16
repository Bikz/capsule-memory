"""Capsule Memory Python SDK (lightweight).

This module mirrors the Node client with a small subset of convenience helpers
so Python scripts can store, search, and review capture candidates.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import requests


@dataclass
class CaptureScoreResult:
    event_id: Optional[str]
    candidate_id: Optional[str]
    status: str
    recommended: bool
    score: float
    reasons: List[str]
    memory_id: Optional[str]


@dataclass
class CaptureScoreResponse:
    threshold: float
    results: List[CaptureScoreResult]


@dataclass
class CaptureCandidate:
    id: str
    role: str
    content: str
    status: str
    score: float
    threshold: float
    recommended: bool
    category: str
    reasons: List[str]
    metadata: Dict[str, Any]
    memory_id: Optional[str]
    auto_accepted: bool
    auto_decision_reason: Optional[str]
    created_at: str
    updated_at: str


class CapsuleMemoryClient:
    """Minimal HTTP client for Capsule Memory."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        org_id: str,
        project_id: str,
        default_subject_id: str,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._base = base_url.rstrip('/')
        self._api_key = api_key
        self._org = org_id
        self._project = project_id
        self._subject = default_subject_id
        self._session = session or requests.Session()

    # ------------------------------------------------------------------
    # Low-level HTTP helpers
    # ------------------------------------------------------------------
    def _headers(self, subject_id: Optional[str] = None) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Capsule-Key": self._api_key,
            "X-Capsule-Org": self._org,
            "X-Capsule-Project": self._project,
            "X-Capsule-Subject": subject_id or self._subject,
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        subject_id: Optional[str] = None,
    ) -> Any:
        url = f"{self._base}{path if path.startswith('/') else '/' + path}"
        response = self._session.request(
            method,
            url,
            headers=self._headers(subject_id),
            json=json,
            params=params,
            timeout=30,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Capsule request failed ({response.status_code}): {response.text}")
        payload = response.json()
        return payload.get('data') if isinstance(payload, dict) and 'data' in payload else payload

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------
    def store_memory(self, *, content: str, pinned: bool = False, **kwargs: Any) -> Dict[str, Any]:
        body = {"content": content, "pinned": pinned, **kwargs}
        return self._request("POST", "/v1/memories", json=body)

    def list_memories(self, *, limit: int = 50, subject_id: Optional[str] = None, **filters: Any) -> Dict[str, Any]:
        params: Dict[str, Any] = {"limit": limit, **filters}
        return self._request("GET", "/v1/memories", params=params, subject_id=subject_id)

    def search(self, *, query: str, subject_id: Optional[str] = None, **options: Any) -> Dict[str, Any]:
        body = {"query": query, **options}
        return self._request("POST", "/v1/memories/search", json=body, subject_id=subject_id)

    # ------------------------------------------------------------------
    # Capture pipeline helpers
    # ------------------------------------------------------------------
    def score_capture(
        self,
        *,
        events: Iterable[Dict[str, Any]],
        threshold: Optional[float] = None,
        subject_id: Optional[str] = None,
    ) -> CaptureScoreResponse:
        payload = self._request(
            "POST",
            "/v1/memories/capture",
            json={"events": list(events), "threshold": threshold},
            subject_id=subject_id,
        )
        results = [
            CaptureScoreResult(
                event_id=result.get("eventId"),
                candidate_id=result.get("candidateId"),
                status=result["status"],
                recommended=result["recommended"],
                score=result["score"],
                reasons=result.get("reasons", []),
                memory_id=result.get("memoryId"),
            )
            for result in payload.get("results", [])
        ]
        return CaptureScoreResponse(threshold=payload.get("threshold", threshold or 0.6), results=results)

    def list_capture_candidates(
        self,
        *,
        status: str = "pending",
        limit: int = 50,
        subject_id: Optional[str] = None,
    ) -> List[CaptureCandidate]:
        payload = self._request(
            "GET",
            "/v1/memories/capture",
            params={"status": status, "limit": limit},
            subject_id=subject_id,
        )
        return [
            CaptureCandidate(
                id=item["id"],
                role=item["role"],
                content=item["content"],
                status=item["status"],
                score=item["score"],
                threshold=item["threshold"],
                recommended=item["recommended"],
                category=item.get("category", ""),
                reasons=item.get("reasons", []),
                metadata=item.get("metadata", {}),
                memory_id=item.get("memoryId"),
                auto_accepted=item.get("autoAccepted", False),
                auto_decision_reason=item.get("autoDecisionReason"),
                created_at=item.get("createdAt", ""),
                updated_at=item.get("updatedAt", ""),
            )
            for item in payload.get("items", [])
        ]

    def approve_capture_candidate(
        self,
        candidate_id: str,
        *,
        overrides: Optional[Dict[str, Any]] = None,
        subject_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/v1/memories/capture/{candidate_id}/approve",
            json={"memory": overrides or None},
            subject_id=subject_id,
        )

    def reject_capture_candidate(
        self,
        candidate_id: str,
        *,
        reason: Optional[str] = None,
        subject_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/v1/memories/capture/{candidate_id}/reject",
            json={"reason": reason},
            subject_id=subject_id,
        )


__all__ = [
    "CapsuleMemoryClient",
    "CaptureScoreResponse",
    "CaptureScoreResult",
    "CaptureCandidate",
]
