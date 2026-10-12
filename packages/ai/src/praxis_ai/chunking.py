"""Heading-aware text chunker.

Input is (markdown-ish) text where headings are ``#``-prefixed lines — the extractors emit headings in that
form for DOCX heading styles, PPTX slide titles and HTML ``h1-h6``. Sections are packed paragraph by
paragraph into chunks of ~``target_tokens`` with ``overlap_tokens`` of trailing context carried into the next
chunk of the same section. Each chunk records its heading path, so retrieval can cite "Title — Heading".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from praxis_ai.pricing import estimate_tokens
from praxis_ai.text import sentences

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass
class Chunk:
    index: int
    text: str
    heading: str | None
    token_count: int


def _sections(text: str) -> list[tuple[str | None, str]]:
    sections: list[tuple[str | None, str]] = []
    path: list[tuple[int, str]] = []
    buf: list[str] = []
    current: str | None = None
    for line in (text or "").splitlines():
        m = _HEADING.match(line)
        if m:
            if buf and "".join(buf).strip():
                sections.append((current, "\n".join(buf).strip()))
            buf = []
            level, title = len(m.group(1)), m.group(2).strip()
            path = [(lv, t) for lv, t in path if lv < level] + [(level, title)]
            current = " › ".join(t for _, t in path)[:500]
        else:
            buf.append(line)
    if buf and "".join(buf).strip():
        sections.append((current, "\n".join(buf).strip()))
    return sections


def _split_long(paragraph: str, target: int) -> list[str]:
    """Split an over-long paragraph by sentences (then by words) to fit ``target`` tokens."""
    if estimate_tokens(paragraph) <= target:
        return [paragraph]
    pieces: list[str] = []
    cur: list[str] = []
    for s in sentences(paragraph) or [paragraph]:
        if estimate_tokens(s) > target:
            words = s.split()
            step = max(20, int(target * 0.75))
            for i in range(0, len(words), step):
                pieces.append(" ".join(words[i : i + step]))
            continue
        if cur and estimate_tokens(" ".join(cur + [s])) > target:
            pieces.append(" ".join(cur))
            cur = []
        cur.append(s)
    if cur:
        pieces.append(" ".join(cur))
    return pieces


def _tail(text: str, tokens: int) -> str:
    if tokens <= 0:
        return ""
    words = text.split()
    keep = max(1, int(tokens * 0.75))
    return " ".join(words[-keep:])


def chunk_text(
    text: str, *, target_tokens: int = 800, overlap_tokens: int = 100, min_tokens: int = 20
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for heading, body in _sections(text):
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        units: list[str] = []
        for p in paragraphs:
            units.extend(_split_long(p, target_tokens))
        cur: list[str] = []
        carry = ""
        for unit in units:
            candidate = "\n\n".join(([carry] if carry else []) + cur + [unit])
            if cur and estimate_tokens(candidate) > target_tokens:
                body_text = "\n\n".join(([carry] if carry else []) + cur)
                chunks.append(Chunk(len(chunks), body_text, heading, estimate_tokens(body_text)))
                carry = _tail("\n\n".join(cur), overlap_tokens)
                cur = []
            cur.append(unit)
        if cur:
            body_text = "\n\n".join(([carry] if carry else []) + cur)
            # Merge a tiny trailing piece into the previous chunk of the same section.
            if (
                chunks
                and chunks[-1].heading == heading
                and estimate_tokens("\n\n".join(cur)) < min_tokens
                and chunks[-1].token_count + estimate_tokens("\n\n".join(cur)) <= target_tokens * 1.2
            ):
                prev = chunks[-1]
                merged = prev.text + "\n\n" + "\n\n".join(cur)
                chunks[-1] = Chunk(prev.index, merged, heading, estimate_tokens(merged))
            else:
                chunks.append(Chunk(len(chunks), body_text, heading, estimate_tokens(body_text)))
    # Prefix the heading into the chunk text so embeddings capture section context.
    return [
        Chunk(c.index, (f"{c.heading}\n\n{c.text}" if c.heading else c.text), c.heading, c.token_count)
        for c in chunks
    ]
