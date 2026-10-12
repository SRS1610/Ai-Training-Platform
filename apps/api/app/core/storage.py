"""Object storage abstraction (local filesystem for dev/test, S3 for staging/production) and
secure upload validation (size, extension/content-type allow-list, magic-byte sniffing, malware scan)."""

from __future__ import annotations

import asyncio
import hashlib
import os
import socket
import struct
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings
from app.core.errors import BadRequest

ALLOWED_TYPES: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
    ".csv": {"text/csv", "text/plain", "application/vnd.ms-excel"},
    ".json": {"application/json", "text/plain"},
    ".log": {"text/plain"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".gif": {"image/gif"},
    ".webp": {"image/webp"},
    ".mp4": {"video/mp4"},
    ".webm": {"video/webm", "audio/webm"},
    ".mp3": {"audio/mpeg"},
    ".wav": {"audio/wav", "audio/x-wav"},
    ".m4a": {"audio/mp4", "audio/x-m4a"},
    ".py": {"text/x-python", "text/plain"},
    ".js": {"text/javascript", "application/javascript", "text/plain"},
    ".ts": {"text/plain", "video/mp2t", "application/typescript"},
    ".sql": {"text/plain", "application/sql"},
    ".zip": {"application/zip", "application/x-zip-compressed"},
}

MAGIC: dict[str, list[bytes]] = {
    ".pdf": [b"%PDF"],
    ".png": [b"\x89PNG"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".gif": [b"GIF87a", b"GIF89a"],
    ".docx": [b"PK\x03\x04"],
    ".pptx": [b"PK\x03\x04"],
    ".xlsx": [b"PK\x03\x04"],
    ".zip": [b"PK\x03\x04"],
}

BLOCKED_EXTENSIONS = {".exe", ".dll", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".jar", ".scr", ".com", ".vbs", ".html", ".htm", ".svg"}


def validate_upload(filename: str, content_type: str, data: bytes) -> str:
    """Return a normalised extension or raise BadRequest."""
    if len(data) == 0:
        raise BadRequest("File is empty")
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise BadRequest(f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")
    name = os.path.basename(filename or "").strip()
    ext = Path(name).suffix.lower()
    if not name or ext in BLOCKED_EXTENSIONS or ext not in ALLOWED_TYPES:
        raise BadRequest(f"File type '{ext or 'unknown'}' is not allowed")
    base_ct = (content_type or "").split(";")[0].strip().lower()
    if base_ct and base_ct != "application/octet-stream" and base_ct not in ALLOWED_TYPES[ext]:
        raise BadRequest("File content type does not match its extension")
    signatures = MAGIC.get(ext)
    if signatures and not any(data.startswith(sig) for sig in signatures):
        raise BadRequest("File contents do not match its type")
    return ext


def sanitize_filename(filename: str) -> str:
    name = os.path.basename(filename or "file")
    keep = "".join(c if c.isalnum() or c in "._- " else "_" for c in name).strip()
    return keep[:200] or "file"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def scan_bytes(data: bytes) -> tuple[str, str | None]:
    """Scan with ClamAV (clamd INSTREAM) when configured. Returns (status, detail)."""
    if not settings.CLAMAV_HOST:
        return "skipped", "No malware scanner configured"

    def _scan() -> tuple[str, str | None]:
        with socket.create_connection((settings.CLAMAV_HOST, settings.CLAMAV_PORT), timeout=30) as s:
            s.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 65536):
                chunk = data[i : i + 65536]
                s.sendall(struct.pack("!L", len(chunk)) + chunk)
            s.sendall(struct.pack("!L", 0))
            reply = s.recv(4096).decode(errors="replace").strip("\0\n ")
        if reply.endswith("OK"):
            return "clean", None
        return "infected", reply[:255]

    try:
        return await asyncio.to_thread(_scan)
    except OSError as exc:
        return "pending", f"Scanner unavailable: {exc}"[:255]


class StorageBackend(ABC):
    @abstractmethod
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    async def get(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    async def presigned_url(self, key: str, expires: int = 300) -> str | None:
        return None


class LocalStorage(StorageBackend):
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise BadRequest("Invalid storage key")
        return p

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(p.write_bytes, data)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            await asyncio.to_thread(p.unlink)


class S3Storage(StorageBackend):
    def __init__(self) -> None:
        import boto3

        self.bucket = settings.AWS_BUCKET
        self.client = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY,
            aws_secret_access_key=settings.AWS_SECRET_KEY,
            endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self.client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )

    async def get(self, key: str) -> bytes:
        obj = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def presigned_url(self, key: str, expires: int = 300) -> str | None:
        return await asyncio.to_thread(
            self.client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires,
        )


_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        _storage = S3Storage() if settings.STORAGE_BACKEND == "s3" else LocalStorage(settings.LOCAL_STORAGE_PATH)
    return _storage
