"""Northwind knowledge base documents (ingested through the knowledge API, then approved)."""

from __future__ import annotations

from textwrap import dedent


def md(text: str) -> str:
    return dedent(text).strip() + "\n"


SERVICE_DESK_SOP = md(
    """
    # Northwind Service Desk Standard Operating Procedure

    Owner: Service Desk Manager · Version 3.2 · Applies to all Level 1 and Level 2 analysts.

    ## 1. Purpose

    This procedure defines how the Northwind Technologies service desk receives, records, prioritises,
    resolves and closes incidents and service requests so that every user receives a consistent, measurable
    service.

    ## 2. Channels and hours

    The service desk is staffed 07:00–19:00 AEST Monday to Friday by phone (1800 555 010), the self-service
    portal and Teams chat. Outside these hours, P1 incidents are handled by the on-call engineer via the
    after-hours line. Email to servicedesk@northwind.demo is accepted but is converted to a portal ticket.

    ## 3. Logging

    Every contact must be logged as a ticket before the call ends, including issues resolved immediately.
    A ticket must contain: the user's name, contact number and location; the device hostname; a one-line
    summary stating symptom and scope; the exact error message or a screenshot; when the issue started; what
    changed recently; steps already taken and their results; business impact; and the priority with a short
    justification. Never record passwords, MFA codes or recovery keys in a ticket.

    ## 4. Prioritisation

    Priority is calculated from impact and urgency using the matrix in the IT Service Management Policy.

    | Priority | Typical example | Response target | Resolution target | Update frequency |
    |---|---|---|---|---|
    | P1 Critical | Site, department or customer-facing service down | 15 minutes | 4 hours | Every 30 minutes |
    | P2 High | A team cannot work; no workaround | 30 minutes | 8 business hours | Every 2 hours |
    | P3 Medium | One user cannot work, or a team with a workaround | 4 business hours | 3 business days | Daily |
    | P4 Low | Minor fault with a workaround | 1 business day | 5 business days | On change |

    ## 5. Investigation

    Analysts follow the six-step troubleshooting methodology: identify the problem, establish a theory of
    probable cause, test the theory, implement the solution, verify full system functionality and document
    findings. Change one thing at a time and record each test and its result in the ticket work notes.
    Search the knowledge base before escalating; link any article used.

    ## 6. Remote assistance

    Remote sessions use Quick Assist or the managed remote support tool and always require the user's
    explicit consent at the start of the session. Tell the user what you are about to do before you do it.
    End the session and confirm it has closed before ending the call.

    ## 7. Resolution and closure

    A ticket may be marked Resolved only when the user confirms the service works, or after two documented
    contact attempts over two business days. The resolution notes must state the root cause (if known), the
    fix or workaround and how it was verified. Resolved tickets close automatically after three business days.
    If the same fault recurs for three or more users in a week, raise a problem record.
    """
)

DNS_RUNBOOK = md(
    """
    # DNS Troubleshooting Runbook

    Owner: Infrastructure – Network Services · Version 2.4 · Audience: Service Desk Level 1/2.

    ## Why DNS problems look like outages

    DNS translates names such as intranet.corp.local into IP addresses. When a client asks the wrong DNS
    server, or receives a wrong or stale answer, applications cannot find the server even though the network
    connection itself works perfectly. To the user this looks like "the intranet is down" or "Teams won't
    connect", but ping to an IP address still succeeds. That is why the first DNS test is always to compare
    access by name with access by IP address.

    Northwind's internal zones (corp.local and the internal view of northwind.com) exist only on the corporate
    DNS servers 10.20.1.10 and 10.20.1.11. Public resolvers such as 8.8.8.8 or a home router know nothing about
    them. A laptop configured to use a public or home DNS server will therefore load internet sites normally
    but fail to resolve every internal name with "Non-existent domain".

    ## Known cause: VPN client leaves a stale static DNS server

    The GlobalConnect VPN client version 5.2.1 can leave a static DNS server address on the Wi-Fi or Ethernet
    adapter after an update or crash. While the VPN is disconnected the laptop keeps asking that stale server,
    so internal names fail while internet browsing keeps working. Symptoms: intranet, file shares and Teams
    fail; ipconfig /all shows a DNS server that is not 10.20.1.10/11; DHCP Enabled is Yes but the DNS server is
    static.

    Fix: reset the adapter DNS to automatic with
    `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses` (or Network settings → Edit DNS
    → Automatic (DHCP)), then run `ipconfig /flushdns` and verify with `nslookup intranet.corp.local`.

    ## Diagnostic procedure

    1. Confirm it is DNS: can the user reach the server by IP but not by name?
    2. Run `ipconfig /all` and note the DNS servers. Corporate devices on site must use 10.20.1.10 and 10.20.1.11
       from DHCP.
    3. Run `nslookup intranet.corp.local` against the configured server.
    4. Run `nslookup intranet.corp.local 10.20.1.10`. If this succeeds and step 3 fails, the client is using
       the wrong DNS server.
    5. Check the hosts file (C:\\Windows\\System32\\drivers\\etc\\hosts) for stale entries; hosts entries
       override DNS.
    6. Clear the client cache with `ipconfig /flushdns` (stale and negative answers are cached for their TTL).
    7. Verify by name from the user's application, not only with nslookup.

    ## Do not

    * Do not set 8.8.8.8 or any public resolver on a corporate device: internal names will stop resolving.
    * Do not edit the hosts file to "fix" a DNS problem except as a documented, temporary workaround.
    * Do not restart DNS servers; escalate suspected server faults to Network Services (see Escalation Policy).
    """
)

NETWORK_STANDARDS = md(
    """
    # Northwind Network Standards

    Owner: Infrastructure – Network Services · Version 4.0

    ## Addressing

    | Site / network | VLAN | Subnet | Gateway | DHCP |
    |---|---|---|---|---|
    | Sydney user (wired) | 30 | 10.20.30.0/24 | 10.20.30.1 | Yes – relay on core switch |
    | Sydney Wi-Fi (corporate) | 40 | 10.20.40.0/23 | 10.20.40.1 | Yes |
    | Sydney servers | 5 | 10.20.5.0/24 | 10.20.5.1 | No – static |
    | Melbourne user | 130 | 10.30.30.0/24 | 10.30.30.1 | Yes |

    All corporate clients obtain addresses from DHCP. Static addressing on client devices is not permitted.
    DHCP leases are 8 hours on wired networks and 4 hours on Wi-Fi.

    ## Name resolution

    The authoritative internal DNS servers are 10.20.1.10 (primary) and 10.20.1.11 (secondary). They host the
    corp.local zone and the internal view of northwind.com (split-brain DNS), and forward all other queries to
    the secure web gateway resolvers. DHCP option 6 delivers these two servers to every client. Clients must
    never be configured with public resolvers. VPN clients receive the same DNS servers while connected and use
    a name resolution policy for *.corp.local.

    ## APIPA addresses

    A client showing a 169.254.x.x address has not received a DHCP lease. On wired networks this almost always
    means a physical link, switch port, VLAN or uplink problem between the client and the core switch where
    the DHCP relay is configured. Several users on one floor with APIPA addresses indicates an access switch or
    uplink fault: escalate to Network Services as P2 or higher.

    ## Change windows

    Switch firmware and configuration changes are made in the Saturday 22:00–02:00 window. After every change
    the implementer must verify each VLAN obtains DHCP leases and record the result in the change ticket.
    """
)

COMMUNICATION_GUIDELINES = md(
    """
    # Customer Communication Guidelines

    Owner: Service Desk Manager · Version 1.8

    ## Principles

    Be prompt, plain and honest. Users judge the service desk on how informed and respected they feel as much
    as on the fix itself.

    ## On every call

    * Greet the user, introduce yourself and confirm their name and contact number.
    * Listen without interrupting, then paraphrase the problem to confirm your understanding.
    * Acknowledge the business impact ("so you can't submit the invoices due today").
    * Set expectations: the ticket number, what you will do next and when they will next hear from you.
    * Explain technical causes in plain language. Avoid acronyms unless the user uses them first.
    * Before closing, confirm the issue is resolved from the user's point of view and ask if there is anything else.

    ## Frustrated or upset users

    Use the HEARD model: Hear, Empathize, Apologize, Resolve, Diagnose. Never tell a user to "calm down".
    Offer options so the user regains a sense of control. If a user becomes abusive, state the boundary once,
    and if it continues end the call politely and notify your team leader. Record the interaction factually.

    ## Major incident updates

    For P1 and P2 incidents the incident coordinator posts updates to the affected teams' Teams channel and
    the IT status page at the frequency defined in the Service Desk SOP. Each update states what is affected,
    what is being done, any workaround and the time of the next update. Send a plain-language all-clear that
    explains the cause and any action users need to take (for example restarting or renewing their connection).

    ## Written messages

    Closing emails should thank the user, explain what was wrong and what was done in plain language, confirm
    it is working, explain how to get help if it recurs and quote the ticket number.
    """
)

ESCALATION_POLICY = md(
    """
    # IT Escalation Policy

    Owner: Head of IT Operations · Version 2.1

    ## Functional escalation

    Escalate to a Level 2 or Level 3 team when the fix requires access, skills or tools the service desk does
    not have, or when the Level 1 time limit is reached: 20 minutes for P3/P4 tickets and immediately for P1/P2
    once evidence is collected. Every escalation must include the evidence gathered, the tests performed and
    their results, the current theory and the business impact. Tickets escalated without evidence may be
    returned to the service desk.

    | Issue | Escalate to |
    |---|---|
    | Switches, Wi-Fi, firewalls, DNS/DHCP servers, VPN infrastructure | Network Services |
    | Server, storage and backup faults | Infrastructure Platforms |
    | Accounts, groups, MFA and SSO | Identity & Access |
    | Business application faults | Application Support |
    | Suspected security incident or phishing | Cyber Security (SOC) – immediately, any priority |

    ## Hierarchical escalation

    Notify the Service Desk Team Leader when an SLA is at 75% of its resolution target, when a P1 is declared,
    or when a user or manager requests escalation. The Team Leader decides whether to invoke the major incident
    process. Executive requests follow the same priority rules; the VIP process allows a named analyst to be
    assigned but does not change priority.

    ## Do not escalate when

    * A documented knowledge base fix exists and has not yet been tried.
    * The fault affects a single device and has a working workaround (log as P3/P4 and continue).
    * The only reason is that the user is unhappy: use the Customer Communication Guidelines and involve
      your team leader instead.
    """
)

DOCUMENTS = [
    {"title": "Northwind Service Desk SOP", "category": "sop", "text": SERVICE_DESK_SOP},
    {"title": "DNS Troubleshooting Runbook", "category": "manual", "text": DNS_RUNBOOK},
    {"title": "Northwind Network Standards", "category": "policy", "text": NETWORK_STANDARDS},
    {"title": "Customer Communication Guidelines", "category": "policy", "text": COMMUNICATION_GUIDELINES},
    {"title": "IT Escalation Policy", "category": "policy", "text": ESCALATION_POLICY},
]

MINIMAL_DOCUMENTS = DOCUMENTS[:2]
