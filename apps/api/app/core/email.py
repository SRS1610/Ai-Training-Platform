"""Email delivery abstraction: console (dev), SMTP, AWS SES."""

from __future__ import annotations

import asyncio
import smtplib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.message import EmailMessage
from html import escape

import structlog

from app.core.config import settings

log = structlog.get_logger(__name__)


@dataclass
class Email:
    to: str
    subject: str
    text: str
    html: str | None = None


class EmailProvider(ABC):
    @abstractmethod
    async def send(self, email: Email) -> None: ...


class ConsoleEmailProvider(EmailProvider):
    """Development provider: logs emails and keeps an outbox (used by tests and the dev mailbox view)."""

    outbox: list[Email] = []

    async def send(self, email: Email) -> None:
        self.outbox.append(email)
        del self.outbox[:-200]
        log.info("email.console", to=email.to, subject=email.subject, body=email.text[:500])


class SMTPEmailProvider(EmailProvider):
    async def send(self, email: Email) -> None:
        msg = EmailMessage()
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = email.to
        msg["Subject"] = email.subject
        msg.set_content(email.text)
        if email.html:
            msg.add_alternative(email.html, subtype="html")

        def _send() -> None:
            with smtplib.SMTP(settings.SMTP_HOST or "localhost", settings.SMTP_PORT, timeout=20) as s:
                if settings.SMTP_USE_TLS:
                    s.starttls()
                if settings.SMTP_USERNAME:
                    s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
                s.send_message(msg)

        await asyncio.to_thread(_send)


class SESEmailProvider(EmailProvider):
    async def send(self, email: Email) -> None:
        import boto3

        client = boto3.client(
            "ses",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY,
            aws_secret_access_key=settings.AWS_SECRET_KEY,
        )
        body = {"Text": {"Data": email.text}}
        if email.html:
            body["Html"] = {"Data": email.html}
        await asyncio.to_thread(
            client.send_email,
            Source=settings.EMAIL_FROM,
            Destination={"ToAddresses": [email.to]},
            Message={"Subject": {"Data": email.subject}, "Body": body},
        )


def get_email_provider() -> EmailProvider:
    if settings.EMAIL_PROVIDER == "smtp":
        return SMTPEmailProvider()
    if settings.EMAIL_PROVIDER == "ses":
        return SESEmailProvider()
    return ConsoleEmailProvider()


def render_basic_html(
    title: str, paragraphs: list[str], action_url: str | None = None, action_label: str = "Open"
) -> str:
    parts = "".join(f"<p>{escape(p)}</p>" for p in paragraphs)
    button = (
        f'<p><a href="{escape(action_url)}" style="background:#4f46e5;color:#fff;padding:10px 16px;'
        f'border-radius:6px;text-decoration:none">{escape(action_label)}</a></p>'
        if action_url
        else ""
    )
    return (
        f'<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">'
        f"<h2>{escape(title)}</h2>{parts}{button}"
        f'<p style="color:#6b7280;font-size:12px">{escape(settings.APP_NAME)}</p></div>'
    )


async def send_email(
    to: str, subject: str, paragraphs: list[str], action_url: str | None = None, action_label: str = "Open"
) -> None:
    text = "\n\n".join(paragraphs + ([f"{action_label}: {action_url}"] if action_url else []))
    try:
        await get_email_provider().send(
            Email(
                to=to,
                subject=subject,
                text=text,
                html=render_basic_html(subject, paragraphs, action_url, action_label),
            )
        )
    except Exception:  # email failure must never break the business transaction
        log.exception("email.send_failed", to=to, subject=subject)
