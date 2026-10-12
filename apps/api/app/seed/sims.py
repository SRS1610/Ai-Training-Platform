"""Simulation play-throughs at different skill levels (played through the real session action endpoints).

A step is ``("act", action_id, input)``, ``("term", text)`` (terminal tool) or ``("chat", character, text)``.
"""

from __future__ import annotations

from typing import Any

Step = tuple[Any, ...]

HELPDESK_NOTES = (
    "Root cause: the GlobalConnect VPN 5.2.1 update left a stale static DNS server on the Wi-Fi adapter, so "
    "internal names failed while internet browsing worked. Fix: reset adapter DNS to automatic (DHCP) and ran "
    "ipconfig /flushdns. Verified with nslookup intranet.corp.local and the user confirmed the intranet loads."
)

HELPDESK = {
    "expert": [
        ("act", "review_ticket", None),
        ("act", "acknowledge_ticket", None),
        (
            "chat",
            "priya",
            "Hi Priya, this is the IT service desk. I've picked up your ticket about the intranet.",
        ),
        ("chat", "priya", "Is it ok if I connect remotely to your laptop with Quick Assist?"),
        ("chat", "priya", "What error message do you see when you open a website?"),
        ("chat", "priya", "When did this start?"),
        ("chat", "priya", "Does your phone or anyone else around you have the same problem?"),
        ("chat", "priya", "Have there been any recent changes or updates on the laptop?"),
        ("chat", "priya", "Are you on Wi-Fi or plugged in with a cable?"),
        ("term", "ipconfig /all"),
        ("term", "ping 10.20.30.1"),
        ("term", "ping 8.8.8.8"),
        ("term", "nslookup intranet.corp.local"),
        ("term", "nslookup intranet.corp.local 10.20.1.10"),
        ("act", "read_kb_vpn", None),
        ("act", "open_system_info", None),
        ("act", "record_diagnosis", {"choice": "stale_static_dns"}),
        ("term", 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses'),
        ("term", "ipconfig /flushdns"),
        ("term", "nslookup intranet.corp.local"),
        ("chat", "priya", "Could you try opening the intranet now?"),
        (
            "chat",
            "priya",
            "The problem was an old DNS server setting left behind by the VPN update; I've reset it.",
        ),
        ("act", "write_resolution_notes", {"text": HELPDESK_NOTES}),
        ("chat", "priya", "Is there anything else, or are you happy for me to close the ticket?"),
        ("act", "close_ticket", None),
    ],
    "advanced": [
        ("act", "review_ticket", None),
        ("chat", "priya", "Hi Priya, it's the service desk about your network ticket."),
        ("chat", "priya", "What error message do you see?"),
        ("chat", "priya", "Have there been any recent changes or updates on the laptop?"),
        ("term", "ipconfig /all"),
        ("term", "ping 8.8.8.8"),
        ("term", "nslookup intranet.corp.local"),
        ("term", "nslookup intranet.corp.local 10.20.1.10"),
        ("act", "record_diagnosis", {"choice": "stale_static_dns"}),
        ("term", 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses'),
        ("term", "ipconfig /flushdns"),
        ("term", "nslookup intranet.corp.local"),
        ("chat", "priya", "Could you try opening the intranet now?"),
        (
            "act",
            "write_resolution_notes",
            {"text": "Reset the DNS server to automatic and flushed DNS. Intranet works now."},
        ),
        ("act", "close_ticket", None),
    ],
    "competent": [
        ("act", "review_ticket", None),
        ("chat", "priya", "Hi Priya, it's the service desk about your network ticket."),
        ("chat", "priya", "What error message do you see?"),
        ("chat", "priya", "Have there been any recent changes or updates on the laptop?"),
        ("term", "ipconfig /all"),
        ("term", "ping 8.8.8.8"),
        ("term", "nslookup intranet.corp.local"),
        ("act", "record_diagnosis", {"choice": "stale_static_dns"}),
        ("term", 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses'),
        ("term", "nslookup intranet.corp.local"),
        ("chat", "priya", "Could you try opening the intranet now?"),
        ("act", "write_resolution_notes", {"text": "Reset the DNS server to automatic. Intranet works now."}),
        ("act", "close_ticket", None),
    ],
    "needs_improvement": [
        ("act", "review_ticket", None),
        ("term", "ipconfig"),
        ("act", "restart_computer", None),
        ("term", "ping google.com"),
        ("term", "nslookup intranet.corp.local"),
        ("act", "record_diagnosis", {"choice": "driver_fault"}),
        ("act", "open_system_info", None),
        ("act", "gui_set_dns_automatic", None),
        ("term", "nslookup intranet.corp.local"),
        ("chat", "priya", "Can you try again now?"),
        (
            "act",
            "write_resolution_notes",
            {
                "text": "User could not reach the intranet. Changed the DNS setting back to automatic in network settings and the intranet works again."
            },
        ),
        ("act", "close_ticket", None),
    ],
    "escalated": [
        ("act", "review_ticket", None),
        ("term", "ipconfig"),
        ("act", "restart_computer", None),
        ("term", "ping google.com"),
        ("term", "ipconfig /release"),
        ("term", "nslookup intranet.corp.local"),
        ("act", "record_diagnosis", {"choice": "driver_fault"}),
        ("term", "Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ServerAddresses 8.8.8.8"),
        ("term", "nslookup intranet.corp.local"),
        ("chat", "priya", "Can you try again now?"),
        ("act", "escalate_ticket", None),
    ],
    "fail": [
        ("act", "review_ticket", None),
        ("act", "reinstall_driver", None),
        ("act", "reset_password", None),
        ("term", "netsh int ip reset"),
        ("act", "close_ticket", None),
    ],
}

PHISHING = {
    "expert": [
        ("act", "open_report", None),
        ("act", "view_headers", None),
        ("act", "sandbox_url", None),
        ("act", "query_siem", None),
        ("act", "search_mailboxes", None),
        ("act", "classify", {"choice": "phishing"}),
        (
            "chat",
            "tom",
            "Quick update: credential phishing campaign, 47 recipients, one account compromised.",
        ),
        ("act", "quarantine_all", None),
        ("act", "block_sender", None),
        ("act", "reset_jnguyen", None),
        ("chat", "jasmine", "Did you enter your password on that page?"),
        ("chat", "jasmine", "Did you get an MFA push notification and approve it?"),
        ("act", "notify_ir", None),
        ("chat", "jasmine", "You did the right thing reporting it, you're not in trouble."),
        (
            "act",
            "send_awareness",
            {
                "text": "A phishing email impersonating Microsoft was quarantined. If you clicked the link or entered your password, report it to the service desk."
            },
        ),
        ("act", "close_incident", None),
    ],
    "advanced": [
        ("act", "open_report", None),
        ("act", "view_headers", None),
        ("act", "sandbox_url", None),
        ("act", "search_mailboxes", None),
        ("act", "query_siem", None),
        ("act", "classify", {"choice": "phishing"}),
        ("chat", "tom", "Update: phishing campaign confirmed, containing now."),
        ("act", "quarantine_all", None),
        ("act", "block_sender", None),
        ("act", "reset_jnguyen", None),
        ("act", "notify_ir", None),
        ("act", "close_incident", None),
    ],
    "needs_improvement": [
        ("act", "open_report", None),
        ("act", "view_headers", None),
        ("act", "sandbox_url", None),
        ("act", "search_mailboxes", None),
        ("act", "classify", {"choice": "phishing"}),
        ("chat", "tom", "Update: phishing campaign confirmed, containing now."),
        ("act", "quarantine_all", None),
        ("act", "block_sender", None),
        ("act", "reset_jnguyen", None),
        ("act", "notify_ir", None),
        ("act", "close_incident", None),
    ],
    "fail": [
        ("act", "open_report", None),
        ("act", "classify", {"choice": "phishing"}),
        ("act", "block_sender", None),
        ("act", "close_incident", None),
    ],
}

RESTAURANT = {
    "expert": [
        ("chat", "daniel", "Are you OK? How are you feeling, any trouble breathing?"),
        ("chat", "daniel", "I'm calling first aid and an ambulance now. Where is your EpiPen?"),
        ("chat", "daniel", "I'm so sorry, this is unacceptable and we take it very seriously."),
        ("chat", "mia", "Mia, what happened with the order?"),
        ("chat", "luca", "Luca, how was the garnish plated?"),
        ("act", "check_kitchen_log", None),
        ("act", "check_allergen_chart", None),
        ("act", "remove_hazard", None),
        ("chat", "daniel", "Tonight's meal is on the house, no charge."),
        ("act", "notify_supervisor", None),
        (
            "act",
            "write_incident_report",
            {
                "text": "Peanut allergy declared on docket by Mia; garnish taken from satay tray at 19:42. First aid given, ambulance called."
            },
        ),
        ("act", "close_case", None),
    ],
    "advanced": [
        ("chat", "daniel", "Are you OK? How are you feeling, any trouble breathing?"),
        ("chat", "daniel", "I'm calling first aid and an ambulance now. Where is your EpiPen?"),
        ("chat", "daniel", "I'm so sorry, this is unacceptable."),
        ("chat", "mia", "Mia, what happened with the order?"),
        ("act", "check_kitchen_log", None),
        ("act", "remove_hazard", None),
        ("chat", "daniel", "Tonight's meal is on the house, no charge."),
        ("act", "notify_supervisor", None),
        (
            "act",
            "write_incident_report",
            {
                "text": "Guest with peanut allergy had a reaction; first aid and ambulance called; garnish contamination suspected."
            },
        ),
        ("act", "close_case", None),
    ],
    "competent": [
        ("chat", "daniel", "Are you OK? How are you feeling?"),
        ("chat", "daniel", "I'm calling first aid now."),
        ("chat", "daniel", "I'm sorry about this."),
        ("act", "check_kitchen_log", None),
        ("act", "notify_supervisor", None),
        (
            "act",
            "write_incident_report",
            {"text": "Guest had an allergic reaction at dinner. First aid called."},
        ),
        ("act", "close_case", None),
    ],
}

PATHS = {
    "it-helpdesk-network": HELPDESK,
    "phishing-email-investigation": PHISHING,
    "restaurant-food-safety-complaint": RESTAURANT,
}


def as_request(step: Step, seq: int) -> dict[str, Any]:
    """Map a step to ``POST /simulation-sessions/{id}/actions``."""
    kind = step[0]
    if kind == "act":
        body: dict[str, Any] = {"action_id": step[1], "client_seq": seq}
        if step[2] is not None:
            body["input"] = step[2]
        return body
    if kind == "term":
        return {"tool": "terminal", "input": {"text": step[1]}, "client_seq": seq}
    return {"character": step[1], "input": {"text": step[2]}, "client_seq": seq}
