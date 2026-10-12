"""Reference play-throughs used by the engine tests."""

from __future__ import annotations

from typing import Any

from simulation_engine import start, step

# (action_id, input, tool, character)
Step = tuple[str | None, Any, str | None, str | None]


def chat(text: str, who: str = "priya") -> Step:
    return (None, text, None, who)


def term(text: str) -> Step:
    return (None, text, "terminal", None)


def act(action_id: str, inp: Any = None) -> Step:
    return (action_id, inp, None, None)


HELPDESK_NOTES = (
    "Root cause: GlobalConnect VPN 5.2.1 update left a stale static DNS server on the adapter. "
    "Fix: reset DNS to DHCP (automatic) and ipconfig /flushdns. Verified with nslookup "
    "intranet.corp.local; user confirmed."
)

HELPDESK_OPTIMAL: list[Step] = [
    act("review_ticket"),
    act("acknowledge_ticket"),
    chat("Hi Priya, this is Sam from the IT service desk."),
    chat("Is it ok if I connect remotely to your laptop with Quick Assist?"),
    chat("What error message do you see when you open a website?"),
    chat("When did this start?"),
    chat("Does your phone or anyone else around you have the same problem?"),
    chat("Have there been any recent changes or updates on the laptop?"),
    chat("Are you on Wi-Fi or plugged in with a cable?"),
    term("ipconfig /all"),
    term("ping 10.20.30.1"),
    term("ping 8.8.8.8"),
    term("nslookup intranet.corp.local"),
    term("nslookup intranet.corp.local 10.20.1.10"),
    act("read_kb_vpn"),
    act("open_system_info"),
    act("record_diagnosis", {"choice": "stale_static_dns"}),
    term('Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses'),
    term("ipconfig /flushdns"),
    term("nslookup intranet.corp.local"),
    chat("Could you try opening the intranet now?"),
    chat("The problem was an old DNS server setting left behind by the VPN update; I've reset it."),
    act("write_resolution_notes", {"text": HELPDESK_NOTES}),
    chat("Is there anything else, or are you happy for me to close the ticket?"),
    act("close_ticket"),
]

PHISHING_OPTIMAL: list[Step] = [
    act("open_report"),
    act("view_headers"),
    act("sandbox_url"),
    act("query_siem"),
    act("search_mailboxes"),
    act("classify", {"choice": "phishing"}),
    chat("Quick update: credential phishing campaign, 47 recipients, one account compromised.", "tom"),
    act("quarantine_all"),
    act("block_sender"),
    act("reset_jnguyen"),
    chat("Did you enter your password on that page?", "jasmine"),
    chat("Did you get an MFA push notification and approve it?", "jasmine"),
    act("notify_ir"),
    chat("You did the right thing reporting it, you're not in trouble.", "jasmine"),
    act(
        "send_awareness",
        {
            "text": "A phishing email impersonating Microsoft was quarantined. If you clicked the "
            "link or entered your password, report it to the service desk."
        },
    ),
    act("close_incident"),
]

RESTAURANT_OPTIMAL: list[Step] = [
    chat("Are you OK? How are you feeling, any trouble breathing?", "daniel"),
    chat("I'm calling first aid and an ambulance now. Where is your EpiPen?", "daniel"),
    chat("I'm so sorry, this is unacceptable and we take it very seriously.", "daniel"),
    chat("Mia, what happened with the order?", "mia"),
    chat("Luca, how was the garnish plated?", "luca"),
    act("check_kitchen_log"),
    act("check_allergen_chart"),
    act("remove_hazard"),
    chat("Tonight's meal is on the house, no charge.", "daniel"),
    act("notify_supervisor"),
    act(
        "write_incident_report",
        {
            "text": "Peanut allergy declared on docket by Mia; garnish taken from satay tray "
            "at 19:42. First aid given, ambulance called."
        },
    ),
    act("close_case"),
]


def play(definition: dict[str, Any], steps: list[Step], seed: int = 0, state: dict[str, Any] | None = None):
    """Run steps; returns (final_state, outcomes)."""
    s = state or start(definition, seed)
    outcomes = []
    for action_id, inp, tool, character in steps:
        if action_id is None:
            r = step(definition, s, None, {"text": inp}, tool=tool, character=character)
        else:
            r = step(definition, s, action_id, inp)
        s = r.state
        outcomes.append(r.outcome)
    return s, outcomes
