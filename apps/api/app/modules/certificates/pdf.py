"""Certificate PDF rendering (reportlab, landscape A4). Pure: data in, bytes out."""

from __future__ import annotations

import io
import math
import os
from dataclasses import dataclass, field
from datetime import datetime

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

DEFAULT_PRIMARY = "#4F46E5"
DEFAULT_SECONDARY = "#0EA5E9"
DEFAULT_ACCENT = "#F59E0B"

_FONT_CANDIDATES = {
    "sans": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    "sans-bold": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    "serif": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"],
    "serif-bold": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"],
    "serif-italic": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSerifCondensed-Italic.ttf"],
}
_FALLBACK = {"sans": "Helvetica", "sans-bold": "Helvetica-Bold", "serif": "Times-Roman",
             "serif-bold": "Times-Bold", "serif-italic": "Times-Italic"}
_fonts: dict[str, str] | None = None


def _load_fonts() -> dict[str, str]:
    """Prefer Unicode TTF fonts (non-Latin learner names); fall back to the PDF base-14 fonts."""
    global _fonts
    if _fonts is not None:
        return _fonts
    fonts: dict[str, str] = {}
    for role, paths in _FONT_CANDIDATES.items():
        name = _FALLBACK[role]
        for path in paths:
            if os.path.exists(path):
                try:
                    reg = f"Praxis-{role}"
                    pdfmetrics.registerFont(TTFont(reg, path))
                    name = reg
                    break
                except Exception:  # noqa: S112 - fall back to base fonts
                    continue
        fonts[role] = name
    _fonts = fonts
    return fonts


def _colour(value: str | None, default: str) -> colors.Color:
    v = (value or default).strip()
    if len(v) == 4 and v.startswith("#"):
        v = "#" + "".join(c * 2 for c in v[1:])
    try:
        return colors.HexColor(v)
    except (ValueError, TypeError):
        return colors.HexColor(default)


def _tint(c: colors.Color, amount: float) -> colors.Color:
    """Blend towards white (amount 0..1)."""
    return colors.Color(c.red + (1 - c.red) * amount, c.green + (1 - c.green) * amount,
                        c.blue + (1 - c.blue) * amount)


@dataclass
class CertificateData:
    certificate_number: str
    learner_name: str
    course_title: str
    organisation_name: str
    issued_at: datetime
    verify_url: str
    instructor_name: str | None = None
    score: float | None = None
    skills: list[str] = field(default_factory=list)
    expires_at: datetime | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    certificate_text: str | None = None


def _fit(c: canvas.Canvas, text: str, font: str, size: float, max_width: float, min_size: float = 10) -> float:
    while size > min_size and c.stringWidth(text, font, size) > max_width:
        size -= 1
    return size


def render_certificate_pdf(d: CertificateData) -> bytes:
    fonts = _load_fonts()
    buf = io.BytesIO()
    width, height = landscape(A4)
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setTitle(f"Certificate {d.certificate_number}")
    c.setAuthor(d.organisation_name)
    c.setSubject(f"{d.course_title} — {d.learner_name}")
    primary = _colour(d.primary_color, DEFAULT_PRIMARY)
    secondary = _colour(d.secondary_color, DEFAULT_SECONDARY)
    accent = _colour(d.accent_color, DEFAULT_ACCENT)
    ink = colors.HexColor("#1F2937")
    muted = colors.HexColor("#6B7280")

    # Background wash and decorative corner shapes
    c.setFillColor(_tint(primary, 0.95))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    c.setFillColor(primary)
    p = c.beginPath()
    p.moveTo(0, height)
    p.lineTo(230, height)
    p.lineTo(0, height - 160)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(secondary)
    p = c.beginPath()
    p.moveTo(width, 0)
    p.lineTo(width - 260, 0)
    p.lineTo(width, 170)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(_tint(accent, 0.35))
    c.circle(width - 40, height - 40, 70, stroke=0, fill=1)
    c.setFillColor(_tint(secondary, 0.55))
    c.circle(50, 40, 55, stroke=0, fill=1)

    # Card with double border
    margin = 36
    c.setFillColor(colors.white)
    c.setStrokeColor(primary)
    c.setLineWidth(3)
    c.roundRect(margin, margin, width - 2 * margin, height - 2 * margin, 14, stroke=1, fill=1)
    c.setStrokeColor(accent)
    c.setLineWidth(0.8)
    c.roundRect(margin + 8, margin + 8, width - 2 * margin - 16, height - 2 * margin - 16, 10, stroke=1, fill=0)

    cx = width / 2
    inner = width - 2 * margin - 120
    y = height - margin - 52
    c.setFillColor(primary)
    org = d.organisation_name.upper()
    c.setFont(fonts["sans-bold"], _fit(c, org, fonts["sans-bold"], 13, inner))
    c.drawCentredString(cx, y, org)

    y -= 50
    c.setFillColor(ink)
    c.setFont(fonts["serif-bold"], 38)
    c.drawCentredString(cx, y, "Certificate of Completion")
    c.setStrokeColor(accent)
    c.setLineWidth(2)
    c.line(cx - 90, y - 14, cx + 90, y - 14)

    y -= 46
    c.setFillColor(muted)
    c.setFont(fonts["serif-italic"], 14)
    c.drawCentredString(cx, y, "This certifies that")

    y -= 46
    c.setFillColor(primary)
    size = _fit(c, d.learner_name, fonts["serif-bold"], 34, inner, 16)
    c.setFont(fonts["serif-bold"], size)
    c.drawCentredString(cx, y, d.learner_name)
    name_w = min(inner, c.stringWidth(d.learner_name, fonts["serif-bold"], size) + 60)
    c.setStrokeColor(_tint(primary, 0.5))
    c.setLineWidth(0.8)
    c.line(cx - name_w / 2, y - 10, cx + name_w / 2, y - 10)

    y -= 34
    c.setFillColor(muted)
    c.setFont(fonts["serif-italic"], 14)
    c.drawCentredString(cx, y, "has successfully completed")
    y -= 30
    c.setFillColor(ink)
    size = _fit(c, d.course_title, fonts["sans-bold"], 22, inner, 12)
    c.setFont(fonts["sans-bold"], size)
    c.drawCentredString(cx, y, d.course_title)

    if d.score is not None:
        y -= 24
        c.setFillColor(secondary)
        c.setFont(fonts["sans"], 13)
        c.drawCentredString(cx, y, f"with a final score of {d.score:.0f}%")

    if d.certificate_text:
        y -= 22
        c.setFillColor(muted)
        text = d.certificate_text.strip().replace("\n", " ")
        c.setFont(fonts["serif-italic"], _fit(c, text, fonts["serif-italic"], 11, inner, 7))
        c.drawCentredString(cx, y, text)

    if d.skills:
        y -= 30
        _skill_chips(c, d.skills[:6], cx, y, fonts["sans"], primary, inner)

    # Footer: signature, seal, date, QR
    base = margin + 48
    left = margin + 70
    c.setStrokeColor(ink)
    c.setLineWidth(0.8)
    c.line(left, base + 18, left + 190, base + 18)
    c.setFillColor(ink)
    c.setFont(fonts["serif-italic"], 13)
    c.drawString(left + 4, base + 24, d.instructor_name or d.organisation_name)
    c.setFillColor(muted)
    c.setFont(fonts["sans"], 9)
    c.drawString(left, base + 4, "Instructor" if d.instructor_name else "Issued by")

    date_x = left + 240
    c.setStrokeColor(ink)
    c.line(date_x, base + 18, date_x + 140, base + 18)
    c.setFillColor(ink)
    c.setFont(fonts["sans"], 12)
    c.drawString(date_x + 4, base + 24, d.issued_at.strftime("%d %B %Y"))
    c.setFillColor(muted)
    c.setFont(fonts["sans"], 9)
    c.drawString(date_x, base + 4, "Date issued" + (f"  ·  valid until {d.expires_at:%d %b %Y}" if d.expires_at else ""))

    _seal(c, width - margin - 250, base + 30, 34, primary, accent, fonts["sans-bold"])

    qr_size = 92
    qx, qy = width - margin - 130, margin + 26
    widget = QrCodeWidget(d.verify_url)
    x1, y1, x2, y2 = widget.getBounds()
    drawing = Drawing(qr_size, qr_size, transform=[qr_size / (x2 - x1), 0, 0, qr_size / (y2 - y1), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, c, qx, qy + 12)
    c.setFillColor(muted)
    c.setFont(fonts["sans"], 7.5)
    c.drawCentredString(qx + qr_size / 2, qy + 4, "Scan to verify")
    c.setFillColor(ink)
    c.setFont(fonts["sans-bold"], 8.5)
    c.drawRightString(qx - 10, qy + 22, f"Certificate ID: {d.certificate_number}")
    c.setFillColor(muted)
    c.setFont(fonts["sans"], 7.5)
    c.drawRightString(qx - 10, qy + 10, d.verify_url)
    c.linkURL(d.verify_url, (qx, qy + 12, qx + qr_size, qy + 12 + qr_size), relative=0)

    c.showPage()
    c.save()
    return buf.getvalue()


def _skill_chips(c: canvas.Canvas, skills: list[str], cx: float, y: float, font: str, colour: colors.Color,
                 max_width: float) -> None:
    size = 9
    pad = 8
    labels = [s[:40] for s in skills]
    widths = [c.stringWidth(s, font, size) + 2 * pad for s in labels]
    while labels and sum(widths) + 6 * (len(widths) - 1) > max_width:
        labels.pop()
        widths.pop()
    x = cx - (sum(widths) + 6 * (len(widths) - 1)) / 2
    for label, w in zip(labels, widths, strict=True):
        c.setFillColor(_tint(colour, 0.85))
        c.setStrokeColor(_tint(colour, 0.5))
        c.roundRect(x, y - 5, w, 18, 9, stroke=1, fill=1)
        c.setFillColor(colour)
        c.setFont(font, size)
        c.drawString(x + pad, y + 1, label)
        x += w + 6


def _seal(c: canvas.Canvas, x: float, y: float, r: float, primary: colors.Color, accent: colors.Color,
          font: str) -> None:
    c.setFillColor(accent)
    points = []
    for i in range(32):
        ang = math.pi * 2 * i / 32
        rad = r + (5 if i % 2 == 0 else 0)
        points.append((x + rad * math.cos(ang), y + rad * math.sin(ang)))
    p = c.beginPath()
    p.moveTo(*points[0])
    for pt in points[1:]:
        p.lineTo(*pt)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(primary)
    c.circle(x, y, r - 6, stroke=0, fill=1)
    c.setStrokeColor(colors.white)
    c.setLineWidth(1)
    c.circle(x, y, r - 10, stroke=1, fill=0)
    c.setFillColor(colors.white)
    c.setFont(font, 8)
    c.drawCentredString(x, y + 2, "VERIFIED")
    c.setFont(font, 6.5)
    c.drawCentredString(x, y - 8, "CERTIFICATE")
