"""Flagship course: IT Support Troubleshooting Fundamentals (7 modules, banks, assignment, simulation, final).

Lesson dicts use the course-builder API payload format (``POST /courses/{id}/modules/{id}/lessons``) plus
seeder keys: ``kind`` (quiz | simulation | assignment | final) for linked lessons, ``skills`` (names) and
``activities`` (``POST .../activities`` payloads).
"""

from __future__ import annotations

from textwrap import dedent

from app.seed.qb import fill, long, match, mc, ms, order, sa, tf

PLACEHOLDER_MEDIA = "https://example.com/praxis-demo-placeholder"


def md(text: str) -> str:
    return dedent(text).strip() + "\n"


SKILLS = [
    (
        "Troubleshooting Methodology",
        "Structured fault isolation: identify, theorise, test, fix, verify, document.",
    ),
    (
        "Windows Administration",
        "Event Viewer, Device Manager, services and PowerShell diagnostics on Windows.",
    ),
    ("Networking Fundamentals", "IP addressing, DHCP, gateways and command-line network diagnostics."),
    ("DNS", "Name resolution order, caching, record types and DNS diagnostics."),
    ("Hardware Diagnostics", "POST, boot failures and component-level fault finding."),
    ("Customer Communication", "Active listening, plain-language explanations and de-escalation."),
]

COURSE = {
    "title": "IT Support Troubleshooting Fundamentals",
    "subtitle": "A structured, evidence-based approach to the tickets every service desk sees",
    "description": md(
        """
        This course teaches the troubleshooting habits that separate a confident service desk analyst from a
        guesser. You will learn a repeatable methodology, use the OSI model to isolate faults, and practise
        with the real tools you will use on the job: Event Viewer, Device Manager, PowerShell, `ipconfig`,
        `ping`, `tracert` and `nslookup`.

        Along the way you will diagnose DHCP and APIPA problems, untangle DNS resolution (cache, hosts file,
        split-brain DNS), work through boot and hardware failures, and practise the communication skills that
        keep frustrated users on side. The course finishes with a live helpdesk simulation, a practical
        write-up assessed against a rubric, and a final assessment.
        """
    ),
    "category": "IT Support",
    "difficulty": "beginner",
    "duration_minutes": 480,
    "learning_objectives": [
        "Apply a six-step troubleshooting methodology and document findings, actions and outcomes",
        "Use the OSI model to isolate network faults layer by layer",
        "Diagnose Windows faults with Event Viewer, Device Manager and PowerShell",
        "Recognise DHCP, APIPA and gateway problems from IP configuration output",
        "Explain the Windows name-resolution order and troubleshoot DNS with nslookup and Resolve-DnsName",
        "Work through no-power, no-POST and no-boot hardware failures safely",
        "Use active listening and de-escalation to keep users informed and confident",
    ],
    "prerequisites": ["Basic familiarity with Windows 10/11", "No prior networking knowledge required"],
    "target_audience": "New and aspiring Level 1 service desk analysts, desktop support technicians and "
    "anyone who supports colleagues' devices.",
    "tags": ["it-support", "troubleshooting", "windows", "networking", "dns", "service-desk"],
    "visibility": "organisation",
    "certificate_enabled": True,
    "pass_threshold": 70,
    "ai_tutor_enabled": True,
    "sequential": False,
}

# =============================================================================================== module 1

M1_SERVICE_DESK = md(
    """
    ## What the service desk is for

    The service desk is the **single point of contact** between IT and the people it supports. Every call,
    chat and portal request lands here first, so the quality of the first conversation shapes the whole
    ticket. A good first-line analyst does three things well: *captures* the right information, *restores*
    service quickly where a known fix exists, and *routes* everything else to the right team with enough
    detail that nobody has to ask the user the same questions again.

    ## Incidents, service requests and problems

    ITIL 4 uses precise terms, and your ticketing tool almost certainly does too:

    | Term | Definition | Example |
    |---|---|---|
    | **Incident** | An unplanned interruption to a service, or a reduction in its quality | "Outlook won't open", "the VPN keeps dropping" |
    | **Service request** | A request for something standard and pre-approved | Password reset, new monitor, access to a shared mailbox |
    | **Problem** | The underlying cause of one or more incidents | A faulty driver that causes laptops to lose Wi-Fi after sleep |
    | **Change** | Adding, modifying or removing anything that could affect services | Deploying a new VPN client version |

    > **Why it matters:** incidents are measured on how quickly service is *restored*; problems are measured
    > on whether the *cause* is removed. A workaround closes the incident, but the problem stays open until
    > the root cause is fixed.

    ## Priority = impact × urgency

    Priority is not how loudly the user asks. It is derived from **impact** (how many people or how much of
    the business is affected) and **urgency** (how quickly the impact grows or a deadline hits).

    | | **High urgency** | **Medium urgency** | **Low urgency** |
    |---|---|---|---|
    | **High impact** (department / site / customer-facing) | P1 – Critical | P2 – High | P3 – Medium |
    | **Medium impact** (team or several users) | P2 – High | P3 – Medium | P4 – Low |
    | **Low impact** (one user, workaround available) | P3 – Medium | P4 – Low | P5 – Planning |

    At Northwind, P1 tickets require a response within 15 minutes and an update to stakeholders every 30
    minutes until service is restored. Always check your own organisation's SLA targets.

    ## The ticket lifecycle

    1. **Logged** – every contact gets a ticket, even quick fixes. Unlogged work is invisible work.
    2. **Categorised and prioritised** – category drives routing; priority drives the SLA clock.
    3. **Investigated and diagnosed** – gather evidence, test theories, consult the knowledge base.
    4. **Resolved** – service is restored (fix or workaround) and the resolution is recorded.
    5. **Closed** – after the user confirms, or automatically after the agreed waiting period.

    Tickets may sit in **Pending** while waiting for the user or a vendor; most tools pause the SLA clock in
    this state, so never use it to hide a ticket you are simply not working on.

    ## Support tiers and escalation

    * **Level 0** – self-service: the portal, knowledge base articles and automated password resets.
    * **Level 1** – the service desk: logging, triage, known fixes, remote assistance.
    * **Level 2** – specialist teams (desktop engineering, network, identity) for deeper investigation.
    * **Level 3** – engineering and vendors for design- or code-level fixes.

    **Functional escalation** moves a ticket to a team with more expertise. **Hierarchical escalation**
    involves managers, for example when an SLA is about to be breached or a VIP is affected. Escalating is
    not failing: escalating *late* or *without evidence* is.
    """
)

M1_TICKETS_TRANSCRIPT = md(
    """
    [00:00] Hi, I'm Priya from the Northwind service desk team. In this short video we'll look at what makes
    a ticket genuinely useful to the next person who reads it.

    [00:12] Picture a Level 2 engineer picking up your ticket at 7pm. They can't call the user, so everything
    they know comes from what you wrote. Start with a summary line that states the symptom and scope, for
    example "Single user – Outlook crashes on launch since the 9 March Office update".

    [00:35] Next, record the facts: the user's name, device hostname, location and contact number; the exact
    error message, ideally as a screenshot; when it started; and whether anyone else is affected.

    [00:58] Then record what you've already tried and what happened. "Restarted Outlook in safe mode –
    launches fine" saves the next engineer twenty minutes and points straight at an add-in.

    [01:20] Finally, record the business impact and the priority you assigned, and why. "Finance month-end
    close blocked for one user, workaround: webmail" justifies a P3 instead of a P1.

    [01:40] What should never go in a ticket? Passwords, personal opinions about the user, and guesses
    presented as facts. If it's a theory, label it as a theory.

    [01:55] A good test: could someone who has never met the user resolve this ticket from what you wrote?
    If the answer is yes, you've written a great ticket.
    """
)

M1_FLASHCARDS = [
    ("Incident", "An unplanned interruption to an IT service or a reduction in its quality."),
    (
        "Service request",
        "A formal request for something standard and pre-approved, such as a password reset.",
    ),
    ("Problem", "The underlying cause of one or more incidents."),
    ("Workaround", "A way to reduce or remove the impact of an incident without fixing the root cause."),
    ("SLA", "Service Level Agreement: targets agreed between the IT provider and the customer."),
    ("OLA", "Operational Level Agreement: internal targets between IT teams that support the SLA."),
    ("Priority", "Derived from impact (how much is affected) and urgency (how fast the impact grows)."),
    ("Functional escalation", "Transferring a ticket to a team with more specialist knowledge."),
    ("Hierarchical escalation", "Involving management, e.g. when an SLA is at risk or a VIP is affected."),
    ("Known error", "A problem with a documented root cause and workaround."),
    ("First contact resolution (FCR)", "Resolving the issue during the user's first contact with the desk."),
    (
        "Knowledge base (KB)",
        "The library of articles with fixes and procedures; update it when you learn something.",
    ),
]

M1_BANK = [
    mc(
        "Which statement best describes an *incident* in ITIL 4?",
        [
            "An unplanned interruption to a service or a reduction in its quality",
            "A request from a user for something standard, such as a password reset",
            "The underlying cause of one or more problems",
            "A planned addition or modification to a service",
        ],
        0,
        "An incident is unplanned and about restoring service. A standard request is a service request; the "
        "cause of incidents is a problem; a planned modification is a change.",
        difficulty=1,
        tags=["itil", "terminology"],
        skills=["Troubleshooting Methodology"],
    ),
    mc(
        "The payroll application is down for the entire finance department on pay day. Using an impact × "
        "urgency matrix, which priority should the ticket receive?",
        ["P1 – Critical", "P2 – High", "P3 – Medium", "P4 – Low"],
        0,
        "High impact (a whole department) and high urgency (pay day deadline) give the highest priority.",
        difficulty=2,
        tags=["priority", "sla"],
        skills=["Troubleshooting Methodology"],
        distractor=1,
    ),
    ms(
        "Which details belong in a well-written incident ticket? Select all that apply.",
        [
            "The exact error message or a screenshot of it",
            "Steps already tried and their results",
            "Business impact and how many users are affected",
            "The user's password so Level 2 can log in as them",
            "The device hostname and the user's location",
            "Your personal opinion of the user's technical skills",
        ],
        {0, 1, 2, 4},
        "Facts, evidence and impact help the next engineer. Passwords must never be recorded, and opinions "
        "about people do not belong in a ticket.",
        difficulty=1,
        tags=["tickets", "documentation"],
        skills=["Customer Communication"],
    ),
    tf(
        "A password reset is normally logged as a service request rather than an incident.",
        True,
        "Password resets are standard, pre-approved and predictable: the definition of a service request.",
        difficulty=1,
        tags=["itil", "terminology"],
        skills=["Troubleshooting Methodology"],
    ),
    order(
        "Put the stages of the ticket lifecycle in order.",
        [
            "Logged",
            "Categorised and prioritised",
            "Investigated and diagnosed",
            "Resolved",
            "Closed after user confirmation",
        ],
        "Every contact is logged first; categorisation and priority drive routing and SLAs; the ticket is "
        "closed only after resolution is confirmed.",
        difficulty=2,
        tags=["lifecycle"],
        skills=["Troubleshooting Methodology"],
    ),
    match(
        "Match each support tier to its typical responsibility.",
        [
            ("Level 0", "Self-service portal and knowledge base articles"),
            ("Level 1", "First contact: logging, triage and known fixes"),
            ("Level 2", "Deeper technical investigation by specialist teams"),
            ("Level 3", "Engineering or vendor fixes at design or code level"),
        ],
        "Tiered support routes work to the cheapest level that can resolve it while keeping specialists free "
        "for complex issues.",
        difficulty=2,
        tags=["tiers", "escalation"],
        skills=["Troubleshooting Methodology"],
    ),
    fill(
        "Complete the sentence.",
        "Targets agreed between IT and its customers are defined in an {{b1}}, while internal targets between "
        "IT teams are defined in an {{b2}}.",
        {"b1": ["SLA", "service level agreement"], "b2": ["OLA", "operational level agreement"]},
        "SLAs face the customer; OLAs are the internal agreements that make the SLA achievable.",
        difficulty=2,
        tags=["sla", "terminology"],
        skills=["Troubleshooting Methodology"],
    ),
    sa(
        "What ITIL term describes the underlying cause of one or more incidents?",
        ["problem", "a problem"],
        "A problem is the cause; incidents are its symptoms. Problem management aims to remove the cause.",
        wrong="root incident",
        difficulty=2,
        tags=["itil", "terminology"],
        skills=["Troubleshooting Methodology"],
    ),
    long(
        'A user calls and says "the internet is down". Describe the questions you would ask and what you '
        "would record in the ticket *before* you start troubleshooting.",
        "Clarify the symptom (exact error, which sites/apps), scope (just them or others, which location), "
        "when it started and what changed (updates, moves, new equipment), the device and connection type "
        "(Wi-Fi or wired, VPN), and the business impact. Record user and device details, the exact error or a "
        "screenshot, steps already tried, impact and the priority with justification.",
        ["error", "scope", "others", "when", "changed", "device", "wi-fi", "impact", "priority", "tried"],
        "Good answers establish scope and recent changes before touching anything, and record evidence so the "
        "ticket stands on its own.",
        good=(
            "First I would clarify what 'the internet is down' actually means: what exact error do they see, "
            "is it every website or only some, and do Teams and email work? Then I'd establish scope: does "
            "anyone else nearby have the same problem, and are they on Wi-Fi, wired or VPN? I'd ask when it "
            "started and what changed recently, for example Windows or VPN updates, a new dock or moving desks. "
            "In the ticket I'd record the user, device hostname and location, the exact error with a screenshot, "
            "the scope, anything they already tried, the business impact and the priority I assigned with the "
            "reason, so anyone picking up the ticket can continue without calling them again."
        ),
        weak=(
            "I would ask them to restart the computer and the router and see if it works. If it still does "
            "not work I would log a ticket and send it to the network team."
        ),
        tags=["questioning", "tickets"],
        skills=["Customer Communication", "Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 2

M2_METHOD = md(
    """
    ## Why a methodology?

    Under pressure it is tempting to start changing settings until something works. That approach (often
    called *shotgun troubleshooting*) wastes time, creates new faults and leaves you unable to explain what
    fixed the problem. A methodology gives you a repeatable path and makes your work easy to hand over.

    The six-step process below is the one used in the CompTIA A+ objectives and most service desks.

    | Step | What you do | Questions to ask yourself |
    |---|---|---|
    | 1. Identify the problem | Gather information, question the user, identify recent changes, reproduce the issue, back up data if anything risky follows | What exactly is failing? For whom? Since when? What changed? |
    | 2. Establish a theory of probable cause | Start with the simple and obvious; consider several possibilities | What is the *most likely* cause given the evidence? |
    | 3. Test the theory | Run a check that confirms or rules it out | If confirmed: what is the fix? If not: what is the next theory, or do I escalate? |
    | 4. Plan and implement the solution | Consider side effects, follow change procedures, apply the fix | Who else could this affect? Do I need approval? |
    | 5. Verify full system functionality | Have the user confirm; apply preventive measures | Does *everything* work, not just the thing I fixed? |
    | 6. Document findings, actions and outcomes | Update the ticket and, where useful, the knowledge base | Could someone else reproduce my reasoning? |

    ## A worked example

    *"Since this morning I can't print to the Level 2 printer."*

    1. **Identify**: only this user; the printer works for colleagues; she was moved to a new desk yesterday.
    2. **Theory**: the laptop is on a different network segment, or the print queue was mapped by desk.
    3. **Test**: `Test-NetConnection prn-l2-01 -Port 9100` succeeds, but the printer is missing from
       *Printers & scanners*. Theory confirmed: the queue mapping is assigned by location group.
    4. **Implement**: add the user to the Level 2 printing group and run `gpupdate /force`.
    5. **Verify**: the user prints a test page *and* a document from Word; scanning to email still works.
    6. **Document**: record the root cause (location-based group not updated after a desk move) and suggest
       the facilities move checklist includes printer groups.

    ## Pitfalls to avoid

    * **Changing several things at once.** If it starts working you won't know why, and you may have broken
      something else.
    * **Skipping verification.** "It should work now" is not verification; get the user to confirm.
    * **Escalating without evidence.** Always include what you tested and what you observed.
    * **Forgetting the user.** Keep them informed: what you are doing, how long it should take, what's next.
    """
)

M2_OSI = md(
    """
    ## Using layers to narrow the search

    The OSI model splits networking into seven layers. You don't need to recite every detail to use it:
    its value in troubleshooting is that **each layer depends on the ones below it**. If Layer 3 (IP) is
    broken, nothing above it can work, so testing layer by layer quickly halves the search space.

    | Layer | What lives here | Typical symptoms | Quick checks |
    |---|---|---|---|
    | 7–5 Application / Presentation / Session | HTTP, DNS, TLS, SMB, authentication | Certificate errors, "can't find server", one app fails while others work | Browser developer tools, application logs, `nslookup`, `Resolve-DnsName` |
    | 4 Transport | TCP/UDP ports, firewalls | A service is unreachable but ping works | `Test-NetConnection host -Port 443`, `netstat -ano` |
    | 3 Network | IP addresses, subnet masks, default gateway, routing | 169.254.x.x address, can reach local devices but nothing remote | `ipconfig /all`, `ping` gateway, `tracert` |
    | 2 Data link | MAC addresses, switch ports, VLANs, Wi-Fi association | Connected but no IP, wrong network after a desk move | Switch port status, `arp -a`, Wi-Fi adapter status |
    | 1 Physical | Cables, connectors, radio signal, NIC hardware | No link light, "network cable unplugged" | Link LEDs, swap cable/port, check Wi-Fi signal |

    ## Three approaches

    * **Bottom-up**: start at the cable and work upwards. Thorough; best when the fault is physical or you
      have no idea where to start.
    * **Top-down**: start with the application and work down. Efficient when one application fails but
      others work.
    * **Divide and conquer**: start in the middle, usually with `ping` (Layer 3). If you can ping the
      default gateway, Layers 1–3 on the local segment are fine, so look up; if you can't, look down.

    ### Example: divide and conquer in four commands

    ```text
    ipconfig /all            # Valid IP, mask, gateway and DNS servers? (L3 configuration)
    ping 10.20.30.1          # Reach the default gateway? (L1-L3 locally)
    ping 8.8.8.8             # Reach beyond the gateway? (routing, internet edge)
    nslookup intranet.corp.local   # Can names be resolved? (DNS, L7)
    ```

    If the first three succeed and the last fails, you have just proved the network path is healthy and the
    fault is in name resolution, in under a minute.

    ## Substitution and comparison

    Two quick techniques that work at every layer: **substitute** a known-good component (cable, port,
    dock, user profile) and **compare** against a working device on the same network. If a colleague's
    laptop in the next desk works, the fault is almost certainly local to the failing device.
    """
)

M2_SCENARIO = md(
    """
    **Monday 09:05.** Kai from Accounts calls: *"The printer is broken, nobody can print!"* You check the
    monitoring console: the printer `PRN-ACC-02` responds to ping and reports **Ready**. Three other
    tickets about the same printer arrived in the last ten minutes, all from staff who returned from leave
    today. Everyone else in Accounts printed successfully this morning.
    """
)

M2_SCENARIO_CHOICES = [
    {
        "id": "a",
        "text": "Restart the printer and the print server straight away",
        "feedback": "The printer is healthy and most of the team can print, so restarting it interrupts "
        "everyone else without testing a theory. This is shotgun troubleshooting.",
        "outcome": "Printing stops for the whole floor for 10 minutes and the problem returns.",
    },
    {
        "id": "b",
        "text": "Identify what the affected users have in common, then test one theory",
        "feedback": "Correct. The common factor is that all four were on leave. Their cached passwords "
        "expired during leave, so the print server rejects their sessions. Signing out and in with the new "
        "password fixes it.",
        "outcome": "Root cause found in five minutes; you add a KB note for returning staff.",
    },
    {
        "id": "c",
        "text": "Escalate to the print team as a P1 outage",
        "feedback": "The evidence shows it is not an outage: most users can print. Escalating without "
        "investigation wastes specialist time and inflates the priority.",
        "outcome": "The print team bounces the ticket back asking what you have tested.",
    },
]

M2_BANK = [
    mc(
        "What is the first step of the six-step troubleshooting methodology?",
        [
            "Identify the problem",
            "Establish a theory of probable cause",
            "Implement the most likely fix",
            "Document findings, actions and outcomes",
        ],
        0,
        "Everything else depends on understanding the problem: symptoms, scope and recent changes.",
        difficulty=1,
        tags=["methodology"],
        skills=["Troubleshooting Methodology"],
        distractor=1,
    ),
    order(
        "Arrange the troubleshooting steps in the correct order.",
        [
            "Identify the problem",
            "Establish a theory of probable cause",
            "Test the theory to determine the cause",
            "Establish a plan of action and implement the solution",
            "Verify full system functionality",
            "Document findings, actions and outcomes",
        ],
        "Testing comes before implementing, and documentation closes the loop.",
        difficulty=2,
        tags=["methodology"],
        skills=["Troubleshooting Methodology"],
    ),
    mc(
        "A user can ping their default gateway but cannot ping any server on another subnet. Which OSI "
        "layer is the most likely location of the fault?",
        ["Layer 1 – Physical", "Layer 2 – Data link", "Layer 3 – Network", "Layer 7 – Application"],
        2,
        "Reaching the gateway proves Layers 1–3 on the local segment work. Failure beyond it points to "
        "routing, a Layer 3 function.",
        difficulty=3,
        tags=["osi", "networking"],
        skills=["Networking Fundamentals"],
        distractor=1,
    ),
    tf(
        "Changing several settings at once is good practice because it fixes problems faster.",
        False,
        "Change one thing at a time. Otherwise you can't tell what fixed the problem and may introduce new "
        "faults.",
        difficulty=1,
        tags=["methodology"],
        skills=["Troubleshooting Methodology"],
    ),
    match(
        "Match each OSI layer to a typical fault found there.",
        [
            ("Physical", "No link light on the network adapter"),
            ("Data link", "The switch port is assigned to the wrong VLAN"),
            ("Network", "The default gateway is configured incorrectly"),
            ("Application", "A website name cannot be resolved by DNS"),
        ],
        "DNS is an application-layer protocol; gateways and routing live at Layer 3; VLANs at Layer 2.",
        difficulty=3,
        tags=["osi"],
        skills=["Networking Fundamentals", "Troubleshooting Methodology"],
    ),
    ms(
        "Which questions help you *identify the problem*? Select all that apply.",
        [
            "What has changed since it last worked?",
            "Does this affect anyone else?",
            "Can you show me the exact error message?",
            "Why did you break it?",
            "Can you reinstall Windows for me?",
        ],
        {0, 1, 2},
        "Good questions establish changes, scope and evidence without blaming the user.",
        difficulty=1,
        tags=["questioning"],
        skills=["Customer Communication", "Troubleshooting Methodology"],
    ),
    fill(
        "Complete the sentence.",
        "Starting at the physical layer and working upwards is the {{b1}} approach; starting at the application "
        "and working down is the {{b2}} approach.",
        {"b1": ["bottom-up", "bottom up"], "b2": ["top-down", "top down"]},
        "Divide and conquer, the third approach, usually starts at Layer 3 with ping.",
        difficulty=2,
        tags=["osi"],
        skills=["Troubleshooting Methodology"],
    ),
    sa(
        "After implementing a fix, what must you do before documenting and closing the ticket?",
        [
            "verify full system functionality",
            "verify",
            "verify the fix",
            "test the fix",
            "confirm with the user",
        ],
        "Step 5 is to verify full system functionality, ideally with the user, and apply preventive measures.",
        regex=r"(?i).*\b(verif\w*|confirm\w*|test\w*)\b.*",
        wrong="close the ticket",
        difficulty=2,
        tags=["methodology"],
        skills=["Troubleshooting Methodology"],
    ),
    long(
        "Explain why documenting findings, actions and outcomes matters. Give at least two concrete benefits.",
        "Documentation lets another analyst continue or reopen the ticket without repeating work, builds the "
        "knowledge base so the next occurrence is fixed faster, reveals trends that feed problem management, "
        "supports audits and SLA reporting, and protects you by showing what was changed and why.",
        [
            "handover",
            "knowledge base",
            "repeat",
            "trend",
            "problem management",
            "audit",
            "evidence",
            "faster",
        ],
        "Strong answers link documentation to faster future fixes, problem management and accountability.",
        good=(
            "Documentation turns one fix into team knowledge. If the same fault happens again, the next analyst "
            "finds the root cause and fix in the ticket history or knowledge base and resolves it faster. It also "
            "makes handover possible: if I go home or escalate, Level 2 can see exactly what I tested and the "
            "evidence, so the user isn't asked the same questions twice. Over time, consistent records reveal "
            "trends, for example many tickets after a VPN update, which feeds problem management. Finally it "
            "supports audits and change reviews by showing what was changed, when and why."
        ),
        weak="Documenting is important because managers want to see that we did our job and it is required.",
        tags=["documentation"],
        skills=["Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 3

M3_EVENTVIEWER = md(
    """
    ## Event Viewer in two minutes

    Open **Event Viewer** with `eventvwr.msc`. The logs you will use most live under **Windows Logs**:

    | Log | What it records | Look here when… |
    |---|---|---|
    | **System** | Windows components, drivers and services | Unexpected restarts, services failing to start, driver errors |
    | **Application** | Applications and some Windows features | An application crashes or hangs |
    | **Security** | Audited events such as logons | Failed sign-ins, account lockouts (on domain controllers) |
    | **Setup** | Windows installation and update servicing | Feature or cumulative updates failing |

    Events have a **level** (Critical, Error, Warning, Information; Security uses Audit Success/Failure), a
    **source**, an **Event ID** and a timestamp. The timestamp is your best friend: ask the user *when*
    the problem happened and filter to that window.

    ## Event IDs worth recognising

    | Event ID | Source / log | Meaning |
    |---|---|---|
    | 41 | Kernel-Power (System) | The system rebooted without cleanly shutting down first (power loss, hard hang, crash) |
    | 6008 | EventLog (System) | The previous system shutdown was unexpected |
    | 1074 | User32 (System) | A process or user initiated a restart or shutdown, and why (e.g. Windows Update) |
    | 1001 | BugCheck (System) | Windows recovered from a stop error (blue screen); includes the stop code |
    | 7000 / 7001 | Service Control Manager (System) | A service failed to start / a dependency failed |
    | 7034 | Service Control Manager (System) | A service terminated unexpectedly |
    | 1000 | Application Error (Application) | An application crashed; shows the faulting module |
    | 4625 | Microsoft-Windows-Security-Auditing (Security) | An account failed to log on |
    | 4740 | Security (domain controller) | A user account was locked out |

    > **Not every red error is a problem.** Some events (for example DistributedCOM 10016) appear on healthy
    > machines. Correlate errors with the *time* and *symptom* the user reported before acting on them.

    ## Filtering instead of scrolling

    Right-click a log and choose **Filter Current Log** to filter by level, Event ID or time range, or
    create a **Custom View** you can reuse. The PowerShell equivalent is faster for repeat checks:

    ```powershell
    # Unexpected shutdowns and crashes in the last 7 days
    Get-WinEvent -FilterHashtable @{
        LogName = 'System'
        Id = 41, 6008, 1001
        StartTime = (Get-Date).AddDays(-7)
    } | Select-Object TimeCreated, Id, ProviderName, Message
    ```

    ## Reading an event like an investigator

    For the event *1000 Application Error*, note the **faulting application**, **faulting module** and
    **exception code**. A crash in `outlook.exe` with faulting module `contosoaddin.dll` points straight to
    an add-in, not Outlook itself: test by starting Outlook with `outlook.exe /safe`.
    """
)

M3_DEVMGR_TRANSCRIPT = md(
    """
    [00:00] Device Manager shows every hardware device Windows knows about and the driver it's using. Open
    it with devmgmt.msc, or right-click Start and choose Device Manager.

    [00:15] Scan for icons. A yellow triangle means the device has a problem. A down-pointing arrow means
    it's disabled. An "Unknown device" usually means no driver is installed.

    [00:32] Double-click the device and read the Device status box. Code 10 means the device cannot start.
    Code 28 means its drivers aren't installed. Code 43 means Windows stopped the device because it reported
    problems – common with USB devices and graphics adapters after a bad driver update.

    [00:55] On the Driver tab, check the driver provider, date and version. If the problem started after an
    update, Roll Back Driver is your first, lowest-risk step.

    [01:12] If there's nothing to roll back, uninstall the device, then use Action, Scan for hardware
    changes so Windows reinstalls it. For business laptops, prefer the manufacturer's driver package over a
    generic one.

    [01:32] Always record the driver version before and after you change it. If the fix works, that version
    detail is exactly what problem management needs to spot a bad driver across the fleet.
    """
)

M3_POWERSHELL = md(
    """
    # First-line diagnostics: run as the signed-in user unless noted.

    # 1. What is this machine, and when did it last boot?
    Get-ComputerInfo -Property CsName, OsName, OsVersion, OsArchitecture
    (Get-CimInstance Win32_OperatingSystem).LastBootUpTime

    # 2. Is there enough free disk space on C:?
    Get-PSDrive -Name C | Select-Object Used, Free

    # 3. Is a key service running? (Print Spooler as an example)
    Get-Service -Name Spooler | Select-Object Name, Status, StartType

    # 4. Recent errors in the System log (last 24 hours)
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 2; StartTime = (Get-Date).AddDays(-1) } |
        Select-Object -First 20 TimeCreated, Id, ProviderName, Message

    # 5. Network adapters and IP configuration
    Get-NetAdapter | Select-Object Name, Status, LinkSpeed, MacAddress
    Get-NetIPConfiguration | Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer

    # 6. Can we reach a service on a specific port?
    Test-NetConnection -ComputerName intranet.corp.local -Port 443

    # 7. Does the name resolve, and to what?
    Resolve-DnsName -Name intranet.corp.local -Type A
    """
)

M3_BANK = [
    mc(
        "In the System log you find Event ID 41 from Kernel-Power. What does it indicate?",
        [
            "The system rebooted without cleanly shutting down first",
            "A user initiated a normal restart from the Start menu",
            "Windows Update installed successfully",
            "A user account was locked out",
        ],
        0,
        "Event 41 is logged at the next boot when the previous shutdown wasn't clean: power loss, a hard "
        "hang or a crash. Event 1074 records deliberate restarts.",
        difficulty=2,
        tags=["event-viewer"],
        skills=["Windows Administration"],
        distractor=1,
    ),
    mc(
        "A service fails to start every morning at boot. Which log should you check first?",
        ["System", "Application", "Security", "Setup"],
        0,
        "The Service Control Manager writes service start failures (7000, 7001, 7034) to the System log.",
        difficulty=2,
        tags=["event-viewer", "services"],
        skills=["Windows Administration"],
        distractor=1,
    ),
    ms(
        "A USB headset shows Code 43 in Device Manager after a driver update. Which actions are reasonable? "
        "Select all that apply.",
        [
            "Roll back the driver",
            "Uninstall the device, then scan for hardware changes",
            "Install the manufacturer's current driver package",
            "Delete files from C:\\Windows\\System32\\drivers by hand",
            "Disable Windows Update permanently",
        ],
        {0, 1, 2},
        "Roll back first (lowest risk), then reinstall or use the vendor driver. Never delete system files "
        "manually or disable updates as a 'fix'.",
        difficulty=2,
        tags=["device-manager", "drivers"],
        skills=["Windows Administration", "Hardware Diagnostics"],
    ),
    tf(
        "Event ID 4625 in the Security log records a failed logon attempt.",
        True,
        "4625 is 'An account failed to log on'. On domain controllers, 4740 records account lockouts.",
        difficulty=2,
        tags=["event-viewer", "security"],
        skills=["Windows Administration"],
    ),
    match(
        "Match each Windows console to its purpose.",
        [
            ("eventvwr.msc", "View system, application and security logs"),
            ("devmgmt.msc", "Manage hardware devices and their drivers"),
            ("services.msc", "Start, stop and configure Windows services"),
            ("msinfo32", "Show a summary of hardware resources and components"),
        ],
        "Knowing the shortcut names saves time when guiding a user over the phone.",
        difficulty=1,
        tags=["tools"],
        skills=["Windows Administration"],
    ),
    fill(
        "Complete the PowerShell commands.",
        "{{b1}} -Name Spooler shows whether the Print Spooler service is running, and {{b2}} -FilterHashtable "
        "queries event logs.",
        {"b1": ["Get-Service"], "b2": ["Get-WinEvent"]},
        "Get-Service and Get-WinEvent are the PowerShell building blocks for service and log checks.",
        difficulty=3,
        tags=["powershell"],
        skills=["Windows Administration"],
    ),
    sa(
        'Which Device Manager error code means "Windows has stopped this device because it has reported '
        'problems"? (Give the number.)',
        ["43", "code 43"],
        "Code 43 is common with USB and graphics devices after a failed driver update or hardware fault.",
        regex=r"(?i)\s*(code\s*)?43\s*",
        wrong="10",
        difficulty=3,
        tags=["device-manager"],
        skills=["Windows Administration", "Hardware Diagnostics"],
    ),
    mc(
        "Event 1000 shows outlook.exe crashing with faulting module contosoaddin.dll. What is the best next "
        "test?",
        [
            "Start Outlook in safe mode (outlook.exe /safe) to rule add-ins in or out",
            "Reinstall Windows",
            "Replace the laptop's memory",
            "Reset the user's password",
        ],
        0,
        "The faulting module points to an add-in. Safe mode loads Outlook without add-ins and tests that theory "
        "directly.",
        difficulty=2,
        tags=["event-viewer", "applications"],
        skills=["Windows Administration", "Troubleshooting Methodology"],
    ),
    long(
        "A user's PC restarted unexpectedly overnight and they lost unsaved work. Describe how you would use "
        "Event Viewer (or PowerShell) to work out why.",
        "Open the System log and filter to the night's time window. Look for 1074 (planned restart, e.g. "
        "Windows Update, and which process requested it), 41 Kernel-Power and 6008 (unclean shutdown: power or "
        "hang), and 1001 BugCheck (blue screen with stop code). Correlate with Setup/Windows Update history and "
        "check for driver or hardware warnings beforehand. PowerShell Get-WinEvent with a FilterHashtable for "
        "IDs 41, 6008, 1074, 1001 gives the same view.",
        ["system log", "filter", "1074", "41", "6008", "1001", "windows update", "get-winevent", "time"],
        "Distinguishing a planned restart (1074) from a crash (41/6008/1001) is the key insight.",
        good=(
            "I'd open eventvwr.msc, go to the System log and use Filter Current Log for the overnight time "
            "window. First I'd look for Event 1074, which records a planned restart and the process that "
            "requested it, for example Windows Update with the reason code. If instead I find Event 41 Kernel-Power "
            "and 6008, the shutdown was unexpected, so power or a hang; Event 1001 BugCheck would mean a blue "
            "screen and give the stop code. I'd check the Setup log and update history and look for driver or "
            "disk warnings before the restart. To do it quickly I could run Get-WinEvent -FilterHashtable with "
            "LogName System and Id 41, 6008, 1074, 1001 for the last day."
        ),
        weak="I would look in Event Viewer for red errors around that time and see if there is anything.",
        tags=["event-viewer"],
        skills=["Windows Administration", "Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 4

M4_DHCP = md(
    """
    ## What a client needs to talk on an IP network

    | Setting | Purpose | Example |
    |---|---|---|
    | IP address | Identifies the device on the network | 10.20.30.57 |
    | Subnet mask | Defines which addresses are "local" | 255.255.255.0 (/24) |
    | Default gateway | Router used for anything not local | 10.20.30.1 |
    | DNS servers | Resolve names to addresses | 10.20.1.10, 10.20.1.11 |

    On almost every corporate network these values come from **DHCP**. Run `ipconfig /all` and you'll see
    them, plus *DHCP Enabled*, the DHCP server and when the lease was obtained and expires.

    ## How DHCP hands out an address (DORA)

    1. **Discover** – the client broadcasts "is there a DHCP server?"
    2. **Offer** – a server offers an address and options.
    3. **Request** – the client requests the offered address.
    4. **Acknowledge** – the server confirms; the lease starts.

    Clients try to renew at 50% of the lease and rebind at 87.5%. Because Discover is a broadcast, it does
    not cross routers by itself: on multi-subnet networks a **DHCP relay** (IP helper) on the router forwards
    it to the server. A missing relay or a switch port in the wrong VLAN looks exactly like "DHCP is down".

    ## Reading the clues in an IP address

    | What `ipconfig` shows | What it usually means | Next step |
    |---|---|---|
    | 169.254.x.x | **APIPA**: no DHCP server answered | Check link/cable/Wi-Fi association, VLAN, DHCP scope exhaustion, relay |
    | 0.0.0.0 or no IPv4 address | Adapter not bound / media disconnected | Check physical link, adapter enabled, driver |
    | Correct range, no default gateway | Incomplete static config or DHCP option missing | Compare with a working device |
    | Address in the wrong subnet | Wrong VLAN, or a rogue DHCP server (e.g. a home router plugged in) | Check the DHCP server field and switch port |
    | Duplicate address warning | Static IP collides with a DHCP lease | Remove static config or reserve the address |

    **APIPA** (Automatic Private IP Addressing) is Windows' fallback: if no DHCP server responds, it picks an
    address in **169.254.0.0/16** so the machine can talk to other APIPA devices on the same link. It is a
    *symptom*, never the fix.

    ## Renewing a lease

    ```text
    ipconfig /release    # give the current lease back (drops connectivity)
    ipconfig /renew      # run DORA again
    ```

    Remote support tip: never run `/release` on a machine you are connected to remotely unless you are sure
    `/renew` will run too, for example `ipconfig /release && ipconfig /renew` in one line.
    """
)

M4_TOOLS_INTRO = md(
    """
    Command-line tools give you fast, objective evidence. This lesson walks through the core toolkit and
    how to read its output. Try each command on your own machine as you go.
    """
)

M4_TOOLS_TEXT = md(
    """
    ### `ping`: is the host reachable?

    `ping` sends ICMP echo requests. Success proves Layers 1–3 work end to end. **Failure does not prove
    the host is down**: many firewalls block ICMP. Always test the default gateway first, then a known-good
    remote address, then the target.

    ### `tracert`: where does the path stop?

    `tracert` lists each router (hop) on the path. If it stops at hop 2 for every destination, the problem is
    close to you; if it reaches the internet edge and stops, look at the destination's network or firewall.
    `pathping` combines both and measures loss per hop over a few minutes.

    ### `netstat -ano` and `Test-NetConnection`

    `netstat -ano` lists connections and listening ports with process IDs: useful to prove an application is
    actually listening. `Test-NetConnection host -Port 443` tests a TCP port directly, which is often more
    meaningful than ping because it tests the service the user actually needs.
    """
)

M4_TOOLS_CODE = md(
    """
    C:\\> ipconfig /all
       IPv4 Address. . . . . . . . . . . : 10.20.30.57(Preferred)
       Subnet Mask . . . . . . . . . . . : 255.255.255.0
       Default Gateway . . . . . . . . . : 10.20.30.1
       DHCP Server . . . . . . . . . . . : 10.20.1.5
       DNS Servers . . . . . . . . . . . : 10.20.1.10
                                           10.20.1.11

    C:\\> ping 10.20.30.1
    Reply from 10.20.30.1: bytes=32 time=1ms TTL=255

    C:\\> tracert -d 8.8.8.8
      1    <1 ms    <1 ms    <1 ms  10.20.30.1
      2     2 ms     1 ms     1 ms  10.20.0.1
      3     9 ms     8 ms     9 ms  203.0.113.1
      ...

    PS C:\\> Test-NetConnection intranet.corp.local -Port 443
    ComputerName     : intranet.corp.local
    RemoteAddress    : 10.20.5.20
    TcpTestSucceeded : True
    """
)

M4_BANK = [
    mc(
        "A laptop's IPv4 address is 169.254.23.7. What does this most likely indicate?",
        [
            "The laptop could not obtain an address from a DHCP server",
            "The laptop has a valid corporate DHCP lease",
            "The DNS server is unreachable",
            "The laptop is connected to the VPN",
        ],
        0,
        "169.254.0.0/16 is the APIPA range Windows self-assigns when no DHCP server answers.",
        difficulty=1,
        tags=["dhcp", "apipa"],
        skills=["Networking Fundamentals"],
        distractor=2,
    ),
    order(
        "Put the DHCP lease process (DORA) in order.",
        ["Discover", "Offer", "Request", "Acknowledge"],
        "The client discovers, the server offers, the client requests, the server acknowledges.",
        difficulty=1,
        tags=["dhcp"],
        skills=["Networking Fundamentals"],
    ),
    mc(
        'You can ping 8.8.8.8 successfully but `ping www.northwind.com` fails with "could not find host". '
        "What is the most likely cause?",
        [
            "A DNS resolution problem",
            "A faulty network cable",
            "An APIPA address",
            "A failed default gateway",
        ],
        0,
        "Reaching an internet IP proves the cable, IP configuration and gateway work. Failing only by name "
        "points to DNS.",
        difficulty=2,
        tags=["dns", "ping"],
        skills=["Networking Fundamentals", "DNS"],
        distractor=3,
    ),
    ms(
        "Which settings does a DHCP server typically provide to a client? Select all that apply.",
        [
            "IP address and subnet mask",
            "Default gateway",
            "DNS server addresses",
            "Lease duration",
            "The user's Active Directory password",
            "The client's own MAC address",
        ],
        {0, 1, 2, 3},
        "DHCP delivers addressing and options; the MAC address belongs to the client's network adapter.",
        difficulty=2,
        tags=["dhcp"],
        skills=["Networking Fundamentals"],
    ),
    tf(
        "If a ping to a server fails, the server must be down.",
        False,
        "Firewalls often block ICMP. Test the actual service, e.g. Test-NetConnection -Port 443.",
        difficulty=2,
        tags=["ping"],
        skills=["Networking Fundamentals"],
    ),
    match(
        "Match each command to what it tells you.",
        [
            ("ipconfig /all", "Full adapter configuration including DNS servers and DHCP lease"),
            ("tracert", "Each router (hop) on the path to a destination"),
            ("netstat -ano", "Active connections and listening ports with process IDs"),
            ("ipconfig /renew", "Requests a new DHCP lease"),
        ],
        "Pick the tool that answers the question you are asking.",
        difficulty=2,
        tags=["tools"],
        skills=["Networking Fundamentals"],
    ),
    fill(
        "Complete the sentence.",
        "To test whether TCP port 443 is reachable use {{b1}} -Port 443; to request a new DHCP lease run "
        "ipconfig {{b2}}.",
        {"b1": ["Test-NetConnection", "tnc"], "b2": ["/renew", "renew"]},
        "Test-NetConnection tests the real service port; /renew repeats the DORA process.",
        difficulty=3,
        tags=["tools", "powershell"],
        skills=["Networking Fundamentals", "Windows Administration"],
    ),
    sa(
        "Which IPv4 address range does APIPA use? (Write it in CIDR notation or as 169.254.x.x.)",
        ["169.254.0.0/16", "169.254.x.x", "169.254.0.0"],
        "APIPA addresses are always in 169.254.0.0/16.",
        regex=r"(?i)\s*169\.254(\.0\.0(/16)?|\.x\.x|\.\*\.\*)?\s*",
        wrong="192.168.0.0/16",
        difficulty=2,
        tags=["apipa"],
        skills=["Networking Fundamentals"],
    ),
    long(
        "Every wired user on one floor reports no network access, while Wi-Fi users and other floors are fine. "
        "Outline a structured approach to isolate the fault.",
        "Confirm scope (wired only, one floor), check what changed. Collect ipconfig /all from an affected "
        "device: 169.254 APIPA suggests DHCP isn't reached; check link lights. Ping the gateway. Because only "
        "wired users on one floor are affected the shared component is the floor's access switch, its uplink or "
        "VLAN/trunk configuration, or DHCP relay for that VLAN. Engage the network team with evidence, verify "
        "after the fix (ipconfig /renew) and document.",
        [
            "scope",
            "changed",
            "ipconfig",
            "169.254",
            "apipa",
            "switch",
            "uplink",
            "vlan",
            "dhcp",
            "gateway",
            "verify",
        ],
        "Strong answers use the scope to point at the shared component rather than individual PCs.",
        good=(
            "I'd start by confirming the scope: only wired devices on one floor, so the fault is in something "
            "they share. I'd ask what changed, for example switch maintenance overnight. On one affected PC I'd "
            "run ipconfig /all: a 169.254 APIPA address means DHCP isn't being reached, which together with "
            "the scope points at the floor's access switch, its uplink, the VLAN trunk or the DHCP relay for "
            "that VLAN rather than the PCs. I'd check link lights and try to ping the default gateway, then "
            "escalate to the network team with that evidence. After their fix I'd verify with ipconfig /renew "
            "and a ping, confirm with users and document the root cause."
        ),
        weak="I would go to each computer and restart it, then check the cables one by one until it works.",
        tags=["networking", "methodology"],
        skills=["Networking Fundamentals", "Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 5

M5_RESOLUTION_V1 = md(
    """
    ## From name to address

    People use names (`intranet.corp.local`); networks use IP addresses (`10.20.5.20`). When an application
    asks Windows to resolve a name, the DNS Client service works through these sources **in order**:

    1. **Is it this computer's own name?**
    2. **The DNS client resolver cache.** Recent answers are kept for their **TTL** (time to live). Entries
       from the **hosts file** (`C:\\Windows\\System32\\drivers\\etc\\hosts`) are preloaded into the cache,
       which is why a hosts entry **overrides** DNS.
    3. **The configured DNS servers.** The preferred server first, then alternates if it doesn't respond.
       The client sends a *recursive* query: "give me the final answer". The DNS server either answers from its
       own zones or cache, or forwards/iterates through the root, top-level domain and authoritative servers.
    4. **Legacy fallbacks for single-label names** (e.g. `fileserver`): LLMNR and NetBIOS name resolution.
       Many organisations disable these for security reasons.

    ```text
    C:\\> ipconfig /displaydns          # show what's in the resolver cache
    C:\\> ipconfig /flushdns            # empty it
    PS> Get-DnsClientCache             # PowerShell equivalent of /displaydns
    PS> Clear-DnsClientCache           # PowerShell equivalent of /flushdns
    ```

    ## Caching and TTLs

    Caching makes DNS fast, but it also means **a fix doesn't always take effect immediately**. If a record
    changed, clients and servers may keep the old answer until its TTL expires. Failed lookups are cached
    too (*negative caching*), so a name that briefly didn't exist can keep failing for a few minutes.
    Flushing the client cache rules out stale local answers; server caches may still need to expire.

    ## Record types you'll meet

    | Type | Purpose | Example |
    |---|---|---|
    | A | Name → IPv4 address | `intranet.corp.local → 10.20.5.20` |
    | AAAA | Name → IPv6 address | `www → 2001:db8::20` |
    | CNAME | Alias to another name | `helpdesk → servicenow-prod.corp.local` |
    | MX | Mail servers for a domain | `northwind.com → mail.protection.outlook.com` |
    | PTR | Reverse lookup: IP → name | `10.20.5.20 → intranet.corp.local` |
    | SRV | Location of a service | `_ldap._tcp.dc._msdcs.corp.local` (domain controllers) |
    | TXT | Free text: SPF, domain verification | `v=spf1 include:spf.protection.outlook.com -all` |

    ## Internal versus public names

    Internal names such as `corp.local` exist **only** on the organisation's own DNS servers. A public
    resolver (8.8.8.8, 1.1.1.1) has never heard of them. If a laptop is pointed at a public DNS server,
    *internet sites keep working but internal sites fail*: the classic symptom of a DNS misconfiguration.
    """
)

M5_RESOLUTION_V2_EXTRA = md(
    """
    ## Split-brain DNS and VPN clients (added in version 2)

    Many organisations publish the **same name** internally and externally with different answers: inside the
    network `portal.northwind.com` resolves to an internal address, outside it resolves to a public proxy.
    VPN clients make this work by pushing internal DNS servers (and sometimes a *name resolution policy*)
    while connected. When a VPN client update or crash leaves a **stale static DNS server** on the adapter,
    the laptop may resolve nothing internal at all. That's exactly the fault in this course's simulation.
    """
)

M5_DIAGNOSE = md(
    """
    ## A repeatable DNS check

    1. **Confirm it's DNS.** Can you reach the target by IP but not by name? Then it's name resolution.
    2. **Which DNS servers is the client using?** `ipconfig /all` or `Get-DnsClientServerAddress`. Are they
       the corporate servers you expect? Static or from DHCP?
    3. **Ask the configured server.** `nslookup intranet.corp.local`
    4. **Ask a known-good server directly.** `nslookup intranet.corp.local 10.20.1.10`. If this works and
       step 3 didn't, the client is asking the wrong server.
    5. **Rule out local overrides.** Check the hosts file and `ipconfig /displaydns` for stale entries; then
       `ipconfig /flushdns`.
    6. **Fix, then verify by name** from the user's application, not just nslookup.

    ## Reading nslookup output

    ```text
    C:\\> nslookup intranet.corp.local
    Server:  UnKnown
    Address:  192.168.1.1

    *** UnKnown can't find intranet.corp.local: Non-existent domain
    ```

    * `Server: UnKnown` simply means the DNS server has no reverse (PTR) record; harmless on its own.
    * `192.168.1.1` is a **home router**, not a corporate DNS server: that's the real clue here.
    * `Non-existent domain` (NXDOMAIN) means the server answered authoritatively that the name doesn't
      exist *in the zones it knows*. `Request timed out` means it didn't answer at all.
    * `Non-authoritative answer` on success just means the answer came from a cache, not the zone owner.

    ## PowerShell: Resolve-DnsName

    ```powershell
    Resolve-DnsName intranet.corp.local                       # uses the configured servers
    Resolve-DnsName intranet.corp.local -Server 10.20.1.10    # ask a specific server
    Resolve-DnsName northwind.com -Type MX                    # query a record type
    Resolve-DnsName intranet.corp.local -DnsOnly              # skip hosts file / LLMNR / NetBIOS
    ```

    ## Common causes and fixes

    | Symptom | Likely cause | Fix |
    |---|---|---|
    | Internal names fail, internet works | Client using a public or home DNS server (stale static setting, VPN left-over) | Set DNS back to automatic (DHCP), flush cache |
    | One site resolves to the wrong IP | Stale hosts file entry or cached record | Remove the entry, `ipconfig /flushdns` |
    | Everything fails by name for everyone | DNS server down or unreachable | Escalate to infrastructure, check alternates |
    | Works on Wi-Fi, fails on VPN (or vice versa) | Split-brain DNS / VPN DNS policy | Check the VPN profile and adapter DNS |
    """
)

M5_TUTOR = md(
    """
    Use the AI tutor to practise explaining DNS problems in your own words. It answers from Northwind's
    approved knowledge base (the DNS Troubleshooting Runbook and Network Standards) and shows its sources.
    Try asking it to walk through the scenarios below, then check its reasoning against what you learned.
    """
)

M5_BANK = [
    order(
        "Put the steps Windows follows to resolve a name such as intranet.corp.local in order.",
        [
            "Check whether the name is the local computer's own name",
            "Check the DNS client cache (including entries preloaded from the hosts file)",
            "Query the preferred DNS server",
            "Query an alternate DNS server if the preferred one does not respond",
        ],
        "The resolver cache (with hosts entries) comes before any network query; alternates are used only when "
        "the preferred server doesn't respond.",
        difficulty=3,
        tags=["dns", "resolution-order"],
        skills=["DNS"],
    ),
    mc(
        "Which command clears the DNS client resolver cache on Windows?",
        ["ipconfig /flushdns", "ipconfig /release", "ipconfig /registerdns", "nslookup -clear"],
        0,
        "/flushdns empties the cache (Clear-DnsClientCache in PowerShell). /registerdns re-registers the "
        "client's own records.",
        difficulty=1,
        tags=["dns", "cache"],
        skills=["DNS"],
        distractor=2,
    ),
    mc(
        "`nslookup intranet.corp.local` fails, but `nslookup intranet.corp.local 10.20.1.10` (the corporate DNS "
        "server) succeeds. What is the most likely cause?",
        [
            "The client is configured with the wrong DNS server",
            "The intranet web server is down",
            "The hosts file is missing",
            "The DHCP lease has expired",
        ],
        0,
        "The record exists and the corporate server answers, so the client must be asking a different server.",
        difficulty=2,
        tags=["dns", "nslookup"],
        skills=["DNS"],
        distractor=1,
    ),
    match(
        "Match each DNS record type to its purpose.",
        [
            ("A", "Maps a name to an IPv4 address"),
            ("AAAA", "Maps a name to an IPv6 address"),
            ("CNAME", "An alias that points to another name"),
            ("MX", "Identifies the mail servers for a domain"),
            ("PTR", "Reverse lookup from an IP address to a name"),
        ],
        "Record types tell you what kind of answer to expect.",
        difficulty=2,
        tags=["dns", "records"],
        skills=["DNS"],
    ),
    tf(
        "On Windows, an entry in the hosts file takes precedence over the answer from a DNS server.",
        True,
        "Hosts entries are preloaded into the resolver cache, which is checked before any DNS server.",
        difficulty=2,
        tags=["dns", "hosts-file"],
        skills=["DNS"],
    ),
    ms(
        "Which symptoms are consistent with a DNS problem? Select all that apply.",
        [
            "Websites fail by name but work by IP address",
            "nslookup reports 'Non-existent domain' for an internal server that exists",
            "One website resolves to an unexpected IP address",
            "There is no link light on the network adapter",
            "The laptop has a 169.254.x.x address",
        ],
        {0, 1, 2},
        "No link light is a physical-layer fault; a 169.254 address is a DHCP (APIPA) symptom.",
        difficulty=2,
        tags=["dns", "symptoms"],
        skills=["DNS", "Networking Fundamentals"],
    ),
    fill(
        "Complete the commands.",
        "Resolve-DnsName northwind.com -Type {{b1}} returns the domain's mail servers, and ipconfig {{b2}} "
        "shows the entries in the DNS client cache.",
        {"b1": ["MX"], "b2": ["/displaydns", "displaydns"]},
        "MX records list mail servers; /displaydns lists cached answers.",
        difficulty=3,
        tags=["dns", "commands"],
        skills=["DNS", "Windows Administration"],
    ),
    sa(
        "In DNS, what does TTL stand for?",
        ["time to live", "time-to-live"],
        "TTL is how long resolvers may cache a record before asking again.",
        wrong="time to load",
        difficulty=1,
        tags=["dns", "cache"],
        skills=["DNS"],
    ),
    long(
        "Explain why a DNS misconfiguration can stop a user reaching the intranet while internet sites still "
        "work, and how you would confirm and fix it.",
        "Internal names like intranet.corp.local exist only on the corporate DNS servers. If the client is "
        "using a public or home resolver (for example a stale static DNS left by a VPN client update), internet "
        "names still resolve but internal ones return NXDOMAIN. Confirm with ipconfig /all (which DNS servers), "
        "nslookup against the configured server versus the corporate server, then set DNS back to automatic "
        "(DHCP), ipconfig /flushdns and verify by name.",
        [
            "internal",
            "corporate dns",
            "public",
            "static",
            "vpn",
            "nslookup",
            "ipconfig /all",
            "flushdns",
            "dhcp",
            "verify",
        ],
        "The key idea is that only internal DNS servers know internal names.",
        good=(
            "Internal names such as intranet.corp.local only exist on Northwind's internal DNS servers. If the "
            "laptop is asking a public or home resolver, for example because a VPN client update left a stale "
            "static DNS server on the adapter, then internet names still resolve normally but internal names come "
            "back as Non-existent domain, so it looks like 'only the intranet is down'. I'd confirm with ipconfig "
            "/all to see which DNS servers are configured and whether they are static, then compare nslookup "
            "intranet.corp.local against the configured server and against the corporate server 10.20.1.10. The "
            "fix is to set the adapter's DNS back to automatic from DHCP, run ipconfig /flushdns and verify the "
            "intranet opens by name."
        ),
        weak="DNS is like the phone book of the internet so if it breaks the intranet will not work. Restart the PC.",
        tags=["dns"],
        skills=["DNS", "Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 6

M6_POST = md(
    """
    ## What happens when you press the power button

    1. The power supply stabilises and signals **Power Good** to the motherboard.
    2. The CPU starts executing the **firmware** (UEFI, or legacy BIOS on older machines).
    3. The firmware runs the **POST** (power-on self-test): CPU, memory, graphics and essential controllers.
    4. The firmware finds a **boot device** and hands over to its boot loader (Windows Boot Manager).
    5. Windows loads the kernel, drivers and services, then shows the sign-in screen.

    Where the sequence stops tells you where to look.

    ## Three failure families

    | Symptom | Where it failed | First checks |
    |---|---|---|
    | **No power**: no lights, no fans | Before step 1 | Wall outlet (test with another device), power cable, PSU switch, surge protector, laptop charger/battery |
    | **Power but no POST**: fans spin, no display, maybe beeps or blinking LEDs | Steps 2–3 | Beep/LED codes, reseat RAM, remove recently added hardware, try a known-good monitor/cable, minimal configuration |
    | **POST but no boot**: logo shows, then *"No bootable device"* or recovery screen | Steps 4–5 | Boot order, is the drive detected in UEFI?, BitLocker recovery, Windows Startup Repair |

    ## Beep and LED codes

    When the display can't work, the firmware reports POST errors with **beeps** or **LED blink patterns**.
    Codes vary by manufacturer and firmware version, so always look up the exact model. Typical examples on
    desktop boards with Award/Phoenix-style firmware:

    | Pattern | Typical meaning |
    |---|---|
    | One short beep | POST completed normally |
    | Repeating long beeps | Memory not detected or not seated |
    | One long, two short | Video adapter error |
    | Continuous high-low siren | CPU overheating or fan failure |

    Business laptops (Dell, HP, Lenovo) mostly use **diagnostic LEDs** or caps-lock blink codes and have
    built-in pre-boot diagnostics (e.g. Dell ePSA, HP PC Hardware Diagnostics UEFI): run them before
    opening the case.

    ## Work safely

    * Shut down and **disconnect power** (and remove a removable laptop battery) before opening a device.
    * Use an anti-static wrist strap or touch bare grounded metal; handle boards by the edges.
    * Confirm data is backed up before touching storage.
    * Respect warranty seals: many business devices are repaired under contract by the vendor.
    """
)

M6_FAULTS = md(
    """
    ## Symptom → suspect → test

    | Symptom | Most likely suspects | How to test |
    |---|---|---|
    | Random blue screens, different stop codes | RAM, then drivers | Windows Memory Diagnostic (`mdsched.exe`) or MemTest86; check BugCheck 1001 events |
    | Slow, freezing, clicking noises | Failing hard drive | SMART status (`Get-PhysicalDisk`, vendor tools), `chkdsk /scan` |
    | Shuts down under load (video calls, builds) | Overheating, failing PSU | Check vents and fans, temperatures in vendor tools, Event 41 without BugCheck |
    | Battery drains fast or won't charge | Battery wear, wrong charger wattage | `powercfg /batteryreport` (design vs full charge capacity), try a known-good charger |
    | External monitor shows "no signal" | Cable, input source, dock firmware | Swap cable, select input, update dock firmware, test without the dock |
    | Keyboard or trackpad partially works | Liquid damage, ribbon cable, driver | External keyboard test, Device Manager, inspect for spills |

    ## Example: the laptop that died during video calls

    A finance user's laptop turns off after about 20 minutes of Teams video. Event Viewer shows Event 41 with
    no BugCheck (so not a blue screen), and the vendor diagnostics report the fan running at maximum with the
    CPU at 98 °C. The vents are clogged with dust. Cleaning the vents and updating the BIOS fan profile
    resolves it; the ticket notes the asset for the next preventive maintenance round.

    ## Repair or replace?

    Consider warranty status, age (most organisations refresh laptops every 3–4 years), the cost of the part
    versus the device, and the **user's downtime**. A loan device and a migrated profile often serve the
    business better than a perfect repair two weeks later.
    """
)

M6_BANK = [
    mc(
        "Fans spin and lights come on, but there is no display and the desktop gives repeating long beeps. "
        "What is the most likely cause?",
        [
            "Memory (RAM) not detected or not seated",
            "A corrupted Windows user profile",
            "A DNS misconfiguration",
            "The hard drive is full",
        ],
        0,
        "Repeating long beeps commonly indicate a memory fault on many firmware types; the failure is in POST, "
        "before Windows or storage are involved.",
        difficulty=2,
        tags=["post", "beep-codes"],
        skills=["Hardware Diagnostics"],
        distractor=3,
    ),
    order(
        "Put the boot sequence in order.",
        [
            "The power supply signals Power Good",
            "Firmware runs the power-on self-test (POST)",
            "Firmware hands over to the boot loader on the boot device",
            "Windows loads the kernel, drivers and services",
        ],
        "Knowing the order tells you which component to suspect when the sequence stops.",
        difficulty=2,
        tags=["boot"],
        skills=["Hardware Diagnostics"],
    ),
    ms(
        "Which practices are safe before opening a desktop PC? Select all that apply.",
        [
            "Shut down and disconnect the power cable",
            "Use an anti-static wrist strap or touch grounded metal",
            "Confirm the user's data is backed up if storage is involved",
            "Hold memory modules by their gold contacts",
            "Work on carpet in socks to stay comfortable",
        ],
        {0, 1, 2},
        "Disconnect power, control static and protect data. Touching contacts and carpet both invite ESD damage.",
        difficulty=1,
        tags=["safety", "esd"],
        skills=["Hardware Diagnostics"],
    ),
    tf(
        '"No bootable device found" means the computer failed its power-on self-test.',
        False,
        "The firmware completed POST and is reporting that it can't find a boot loader: check boot order and "
        "whether the drive is detected.",
        difficulty=2,
        tags=["boot"],
        skills=["Hardware Diagnostics"],
    ),
    match(
        "Match each tool to its purpose.",
        [
            ("mdsched.exe", "Windows Memory Diagnostic for testing RAM"),
            ("chkdsk", "Checks a volume's file system for errors"),
            ("powercfg /batteryreport", "Reports battery design versus full-charge capacity"),
            ("Vendor UEFI diagnostics", "Pre-boot hardware tests run before Windows starts"),
        ],
        "Use built-in and vendor diagnostics before replacing parts.",
        difficulty=2,
        tags=["tools"],
        skills=["Hardware Diagnostics", "Windows Administration"],
    ),
    fill(
        "Complete the sentence.",
        "Drives report their own health through a monitoring technology called {{b1}}.",
        {"b1": ["SMART", "S.M.A.R.T.", "self-monitoring analysis and reporting technology"]},
        "SMART attributes such as reallocated sectors warn of impending drive failure.",
        difficulty=2,
        tags=["storage"],
        skills=["Hardware Diagnostics"],
    ),
    sa(
        "What does the acronym POST stand for?",
        ["power-on self-test", "power on self test", "power-on self test"],
        "The power-on self-test checks essential hardware before the firmware looks for a boot device.",
        wrong="power on startup test",
        difficulty=1,
        tags=["post"],
        skills=["Hardware Diagnostics"],
    ),
    mc(
        "A laptop shuts down only after about 20 minutes of video calls. Event 41 is logged with no BugCheck "
        "and the vents are clogged with dust. What is the most likely cause?",
        ["Overheating", "A failing hard drive", "A corrupt user profile", "An expired DHCP lease"],
        0,
        "Load-dependent shutdowns with clogged vents point to thermal protection; Event 41 without a BugCheck "
        "rules out a blue screen.",
        difficulty=2,
        tags=["thermal"],
        skills=["Hardware Diagnostics", "Windows Administration"],
        distractor=1,
    ),
    long(
        "A desktop will not power on at all: no lights and no fans. Describe your troubleshooting steps in order.",
        "Confirm the outlet works with another device, check the power cable and any surge protector or power "
        "board, check the PSU switch and voltage selector, reseat the cable, check the front panel button "
        "connection. Then test with a known-good power cable/PSU or a PSU tester; if the PSU is good suspect the "
        "motherboard. Work safely: disconnect power before opening the case and use ESD protection; document.",
        [
            "outlet",
            "cable",
            "surge",
            "psu",
            "switch",
            "known-good",
            "tester",
            "motherboard",
            "esd",
            "disconnect",
        ],
        "Start outside the box with the simplest, most likely causes and move inwards.",
        good=(
            "I'd start with the simplest and most external causes. First check the wall outlet works by plugging in "
            "another device, and bypass any surge protector or power board. Then check the power cable is seated at "
            "both ends and try a known-good cable, and check the switch on the back of the power supply. If there's "
            "still nothing, I'd disconnect power, use an ESD strap and open the case to check the front panel power "
            "button connector and the motherboard power connectors. Next I'd test the PSU with a tester or a "
            "known-good PSU; if the PSU is fine the motherboard is the likely fault. I'd document each step."
        ),
        weak="I would open the computer and replace the motherboard because that is usually the problem.",
        tags=["power"],
        skills=["Hardware Diagnostics", "Troubleshooting Methodology"],
    ),
]

# =============================================================================================== module 7

M7_LISTENING = md(
    """
    ## Users remember how you made them feel

    Most users can't judge whether your fix was technically elegant, but they always know whether they felt
    listened to. Good communication shortens calls, gets you better information and turns frustrated users
    into allies.

    ## Active listening

    * **Let them finish.** The detail you need is often in the last sentence.
    * **Paraphrase** to confirm understanding: *"So the shared drive disconnects every time you dock your
      laptop, and it started after Tuesday's update. Is that right?"*
    * **Acknowledge the impact**, not just the fault: *"And that means you can't finish the payroll file
      today. Let's make that the priority."*
    * **Take notes as you go** so you never ask the same question twice.

    ## Open and closed questions

    Use **open questions** to explore and **closed questions** to confirm.

    | Open (explore) | Closed (confirm) |
    |---|---|
    | "What happens when you try to sign in?" | "Do you see the error before or after entering your password?" |
    | "What changed since it last worked?" | "Did you install the update this morning?" |
    | "How is this affecting your work today?" | "Is anyone else in your team affected?" |

    ## Plain language

    | Instead of… | Try… |
    |---|---|
    | "Your DNS cache is stale." | "Your computer remembered an old address for that site; I'll clear it." |
    | "We need to re-image the device." | "We'll reinstall a fresh copy of the standard software." |
    | "The DHCP scope is exhausted." | "The network ran out of addresses to give out; we're adding more." |
    | "I'll escalate to L2." | "I'm passing this to our network specialists, who'll call you by 2pm." |

    ## Structure every interaction

    1. **Greet** and introduce yourself; confirm who you're speaking to.
    2. **Listen and record** the issue and its impact.
    3. **Set expectations**: what you'll do, how long it should take, the ticket number.
    4. **Diagnose and resolve**, narrating what you're doing if you're connected remotely.
    5. **Confirm** the issue is resolved *from the user's point of view*.
    6. **Close**: summarise, explain how to avoid a repeat, and ask if there's anything else.
    """
)

M7_DEESCALATE_TRANSCRIPT = md(
    """
    [00:00] Sooner or later you'll take a call from someone who is angry before you've said a word. In this
    video we'll practise turning that call around using the HEARD model: Hear, Empathize, Apologize, Resolve,
    Diagnose.

    [00:18] Hear. Let them get it all out without interrupting. Angry people need to be heard before they can
    listen. Make short acknowledgements so they know you're there.

    [00:34] Empathize. Name the impact: "Losing that report an hour before the board meeting is awful." You're
    not agreeing that IT is useless; you're showing you understand what it means for them.

    [00:52] Apologize – for the experience, sincerely and without blaming anyone: "I'm sorry this has happened
    today." Avoid "calm down"; it almost always makes things worse.

    [01:08] Resolve. Move to action quickly and offer options: "I can restore the version from 9:30 now, or
    set you up on webmail while we fix Outlook. Which would help most?" Giving choices returns a sense of
    control.

    [01:30] Diagnose – after the pressure is off. Find out why it happened so it doesn't happen again, and
    tell the user what you'll do to prevent a repeat.

    [01:45] If the user becomes abusive, stay professional, state the boundary once, and follow your
    escalation policy. Then document the call factually and follow up when you said you would.
    """
)

M7_BANK = [
    mc(
        "Which response is the best example of paraphrasing?",
        [
            '"So the shared drive disconnects every time you dock your laptop. Is that right?"',
            '"Have you tried restarting it?"',
            '"That\'s strange, it works for everyone else."',
            '"I\'ll log a ticket and someone will get back to you."',
        ],
        0,
        "Paraphrasing restates the user's problem in your words and checks your understanding.",
        difficulty=1,
        tags=["active-listening"],
        skills=["Customer Communication"],
        distractor=3,
    ),
    ms(
        "Which of these are *open* questions? Select all that apply.",
        [
            "What happens when you try to sign in?",
            "How has this affected your work today?",
            "Did you restart your laptop?",
            "Is the cable plugged in?",
            "What changed since it last worked?",
        ],
        {0, 1, 4},
        "Open questions invite explanation; closed questions are answered yes/no and are best for confirming.",
        difficulty=1,
        tags=["questioning"],
        skills=["Customer Communication"],
    ),
    tf(
        'Telling an upset user to "calm down" is an effective de-escalation technique.',
        False,
        "It usually escalates the situation. Acknowledge the impact and move to options instead.",
        difficulty=1,
        tags=["de-escalation"],
        skills=["Customer Communication"],
    ),
    order(
        "Put the steps of the HEARD de-escalation model in order.",
        ["Hear", "Empathize", "Apologize", "Resolve", "Diagnose"],
        "Diagnose comes last: find out why it happened once the user is back on track.",
        difficulty=2,
        tags=["de-escalation"],
        skills=["Customer Communication"],
    ),
    match(
        "Match each piece of jargon to a plain-language explanation for a user.",
        [
            ("Your DNS cache is stale", "Your computer remembered an old address for the site"),
            ("We need to re-image the device", "We'll reinstall a fresh copy of the standard software"),
            ("The DHCP scope is exhausted", "The network ran out of addresses to give out"),
            ("I'll escalate to L2", "I'm passing this to a specialist team"),
        ],
        "Plain language builds trust and avoids confusion.",
        difficulty=2,
        tags=["plain-language"],
        skills=["Customer Communication"],
    ),
    fill(
        "Complete the sentence.",
        "Before closing a ticket, always {{b1}} with the user that the issue is resolved from their point of view.",
        {"b1": ["confirm", "check", "verify"]},
        "Resolution is confirmed by the user, not assumed by the analyst.",
        difficulty=1,
        tags=["closure"],
        skills=["Customer Communication"],
    ),
    sa(
        "What should you always give a user so they can follow up on their issue later?",
        ["ticket number", "the ticket number", "a ticket number", "reference number", "incident number"],
        "A ticket or reference number lets anyone pick up the history instantly.",
        regex=r"(?i).*\b(ticket|reference|incident|case)\s*(number|no\.?|id)\b.*",
        wrong="my mobile number",
        difficulty=1,
        tags=["closure"],
        skills=["Customer Communication"],
    ),
    mc(
        "An executive insists you skip the queue for a non-urgent request (a second monitor). What is the "
        "best response?",
        [
            "Acknowledge the request, explain how priority works, give a realistic time and follow the VIP policy",
            "Drop everything and do it immediately to avoid a complaint",
            "Tell them everyone has to wait and end the call",
            "Log it as a P1 so it gets done faster",
        ],
        0,
        "Be respectful and transparent: priority comes from impact and urgency, and many organisations have "
        "a defined VIP process.",
        difficulty=2,
        tags=["expectations", "priority"],
        skills=["Customer Communication"],
        distractor=1,
    ),
    long(
        "Write the closing message you would send to a user after fixing a DNS problem caused by a VPN client "
        "update. Explain what was wrong in plain language.",
        "A good closing message thanks the user, explains in plain language what went wrong (the VPN update left "
        "an old network address setting, so the laptop asked the wrong 'phone book' for internal sites), what was "
        "done (reset it to automatic and cleared the cache), confirms it works, says how to get help if it "
        "returns, and quotes the ticket number.",
        ["thank", "plain", "vpn", "update", "setting", "reset", "automatic", "confirm", "ticket", "contact"],
        "Plain language, what was done, confirmation and the ticket number are the essentials.",
        good=(
            "Hi Sam, thanks for your patience this morning. The problem was caused by last night's VPN update: it "
            "left an old setting on your laptop that told it to look up internal websites in the wrong place, so "
            "the intranet couldn't be found even though the internet worked. I've reset that setting to automatic "
            "and cleared the saved addresses, and you confirmed the intranet and Teams are working again. If it "
            "happens again, just reply to this email or call the service desk on 1800 555 010 and quote ticket "
            "INC0012345. I'll check back tomorrow to make sure everything is still working."
        ),
        weak="Hi, your DNS was wrong so I fixed it. Ticket closed.",
        tags=["closure", "plain-language"],
        skills=["Customer Communication", "DNS"],
    ),
]

# ============================================================================================= assignment

RUBRIC = {
    "title": "Network Outage Resolution Report",
    "description": "Assesses a post-incident resolution record for accuracy, evidence and communication.",
    "criteria": [
        {
            "id": "root_cause",
            "name": "Root cause analysis",
            "description": "Identifies the technical root cause and links it to the observed symptoms.",
            "weight": 30,
            "max_score": 4,
            "levels": [
                {
                    "score": 4,
                    "label": "Exemplary",
                    "description": "Root cause (failed uplink after firmware update; user VLAN not trunked) clearly stated and explicitly linked to the APIPA symptoms with evidence.",
                },
                {
                    "score": 3,
                    "label": "Proficient",
                    "description": "Correct root cause with some supporting evidence.",
                },
                {
                    "score": 2,
                    "label": "Developing",
                    "description": "Symptoms described accurately but the root cause is vague or partly wrong.",
                },
                {"score": 1, "label": "Beginning", "description": "Root cause missing or incorrect."},
            ],
        },
        {
            "id": "process",
            "name": "Troubleshooting process and evidence",
            "description": "Shows a structured, layer-by-layer investigation with commands and results.",
            "weight": 25,
            "max_score": 4,
            "levels": [
                {
                    "score": 4,
                    "label": "Exemplary",
                    "description": "Clear scoping, bottom-up checks, commands with outputs (ipconfig, ping) and the reasoning for each step.",
                },
                {
                    "score": 3,
                    "label": "Proficient",
                    "description": "Structured steps with most evidence included.",
                },
                {
                    "score": 2,
                    "label": "Developing",
                    "description": "Steps listed without evidence or out of logical order.",
                },
                {
                    "score": 1,
                    "label": "Beginning",
                    "description": "Little or no description of how the fault was isolated.",
                },
            ],
        },
        {
            "id": "resolution",
            "name": "Resolution and validation",
            "description": "Describes the fix, how service was verified and preventive follow-ups.",
            "weight": 20,
            "max_score": 4,
            "levels": [
                {
                    "score": 4,
                    "label": "Exemplary",
                    "description": "Fix, verification with users (renewed leases, connectivity tests) and preventive actions (problem record, change review) all documented.",
                },
                {
                    "score": 3,
                    "label": "Proficient",
                    "description": "Fix and verification documented; prevention mentioned briefly.",
                },
                {
                    "score": 2,
                    "label": "Developing",
                    "description": "Fix described but verification or prevention missing.",
                },
                {"score": 1, "label": "Beginning", "description": "Resolution unclear."},
            ],
        },
        {
            "id": "communication",
            "name": "Stakeholder communication",
            "description": "Records timely, plain-language updates to users and managers.",
            "weight": 15,
            "max_score": 4,
            "levels": [
                {
                    "score": 4,
                    "label": "Exemplary",
                    "description": "Communication log with times, audiences and plain-language messages, including the all-clear.",
                },
                {
                    "score": 3,
                    "label": "Proficient",
                    "description": "Updates recorded with times for most audiences.",
                },
                {"score": 2, "label": "Developing", "description": "Communication mentioned without detail."},
                {"score": 1, "label": "Beginning", "description": "No stakeholder communication recorded."},
            ],
        },
        {
            "id": "documentation",
            "name": "Documentation quality",
            "description": "Structure, timeline accuracy, clarity and usefulness to another analyst.",
            "weight": 10,
            "max_score": 4,
            "levels": [
                {
                    "score": 4,
                    "label": "Exemplary",
                    "description": "Well structured with an accurate timeline; another analyst could rely on it.",
                },
                {"score": 3, "label": "Proficient", "description": "Clear with minor gaps."},
                {"score": 2, "label": "Developing", "description": "Hard to follow or missing a timeline."},
                {"score": 1, "label": "Beginning", "description": "Disorganised or incomplete."},
            ],
        },
    ],
}

ASSIGNMENT = {
    "title": "Document a Network Outage Resolution",
    "scenario": md(
        """
        At **08:40 on Monday**, 23 staff on **Level 3 of Northwind's Sydney office** reported they could not
        reach the intranet, Teams or the internet. Only **wired** desktops and docked laptops on Level 3 were
        affected; Wi-Fi users and every other floor were working normally.

        You took the first call and coordinated with the Network team. Affected PCs showed **169.254.x.x**
        addresses. The Network team found that access switch **SYD-L3-SW02** had rebooted during a weekend
        firmware update and come back with its uplink module failed, so the **user VLAN (VLAN 30)** was no longer
        trunked to the core switch where the DHCP relay lives. They reseated the uplink module, restored the trunk
        configuration and service returned at **10:15** after users renewed their leases.
        """
    ),
    "objective": "Produce a post-incident resolution record that another analyst, your team leader and the "
    "affected business unit can rely on.",
    "instructions": md(
        """
        Write a resolution report (around 400–800 words) for the incident above. Include:

        1. **Incident summary**: what happened, who was affected, business impact and priority.
        2. **Timeline** with timestamps from first report to all-clear.
        3. **Troubleshooting steps and evidence**: what you checked, in what order, and what each result told you
           (include command output such as `ipconfig /all` or `ping`).
        4. **Root cause**: technical explanation *and* a one-paragraph plain-language version.
        5. **Resolution and validation**: the fix and how you verified service for users.
        6. **Communication log**: updates to users and managers (who, when, what).
        7. **Preventive actions**: follow-ups such as a problem record or change review.

        Attach at least one **screenshot** of diagnostic evidence (for example `ipconfig /all` showing an APIPA
        address, or the switch status in monitoring).
        """
    ),
    "required_evidence": [
        {"id": "write_up", "label": "Resolution report (text)", "type": "text", "required": True},
        {
            "id": "screenshot",
            "label": "Screenshot of diagnostic evidence",
            "type": "screenshot",
            "required": True,
        },
    ],
    "resources": [
        {
            "title": "Northwind Service Desk SOP",
            "url": "https://example.com/praxis-demo-placeholder/kb/service-desk-sop",
        },
        {
            "title": "Escalation Policy",
            "url": "https://example.com/praxis-demo-placeholder/kb/escalation-policy",
        },
    ],
    "expected_output": "Root cause: SYD-L3-SW02 uplink module failed after the weekend firmware update, so VLAN 30 "
    "was not trunked to the core switch and DHCP Discover broadcasts never reached the relay; clients fell back to "
    "APIPA (169.254.x.x). Fix: uplink reseated and trunk restored, leases renewed (ipconfig /renew), connectivity "
    "verified with users. Prevention: problem record for the firmware/uplink failure, post-change verification "
    "checklist for switch maintenance, monitoring alert on uplink state.",
    "evaluation_criteria": "Accuracy of the root cause, quality of evidence, verification, stakeholder "
    "communication and clarity. See the rubric for level descriptors.",
    "passing_score": 70,
    "grading_mode": "ai_recommend_human_final",
    "high_stakes": False,
    "max_submissions": 3,
    "allowed_file_types": [".png", ".jpg", ".jpeg", ".pdf", ".txt"],
}

# Report variants (quality 1–4) used for learner submissions; {name} is filled per learner.
REPORTS = {
    4: md(
        """
        **Incident summary.** INC-Level3-network, P2 (High). From 08:40 to 10:15 on Monday, 23 wired users on
        Level 3 Sydney could not reach the intranet, Teams or the internet. Wi-Fi users and other floors were
        unaffected. Impact: the Accounts and Payroll teams lost roughly 1.5 hours during month-end preparation.

        **Timeline.** 08:40 first call (I logged it). 08:47 three more calls; scope confirmed as wired-only on
        Level 3, ticket raised to P2 and linked. 08:55 `ipconfig /all` on PC SYD-L3-0412 showed 169.254.88.14
        with no gateway; ping 10.20.30.1 failed. 09:05 escalated to Network with evidence. 09:20 Network
        confirmed SW02 uplink down after weekend firmware update. 09:58 uplink module reseated, trunk for VLAN 30
        restored. 10:05–10:15 users renewed leases; all-clear sent at 10:20.

        **Troubleshooting and evidence.** I started by scoping: wired-only on one floor pointed to a shared
        component (access switch, uplink, VLAN or DHCP relay) rather than individual PCs. Link lights were on,
        so Layer 1 at the desk was fine. The APIPA address showed DHCP Discover was not reaching a server.
        A docked laptop moved to Wi-Fi received 10.20.40.x immediately, proving DHCP itself was healthy.

        **Root cause.** The switch rebooted during the firmware update with its uplink module failed, so VLAN 30
        was not trunked to the core where the DHCP relay lives; clients therefore self-assigned APIPA addresses.
        *Plain language:* the network cupboard on Level 3 lost its connection to the rest of the building after
        weekend maintenance, so computers plugged in there couldn't get an address to talk to anything.

        **Resolution and validation.** Network reseated the module and restored the trunk. I verified with three
        users that `ipconfig /renew` gave a 10.20.30.x address, the gateway and intranet responded, and Teams
        connected. A floor walk confirmed everyone was back online.

        **Communication log.** 08:50 Teams post to Level 3 staff (known issue, use Wi-Fi as a workaround). 09:10
        email to Finance manager with impact and next update time. 09:45 progress update. 10:20 all-clear with
        cause in plain language.

        **Preventive actions.** Problem record PRB-0098 for the uplink failure; change review of the firmware
        rollout; add a post-maintenance verification step (test DHCP on each VLAN) and a monitoring alert on
        uplink state. — {name}
        """
    ),
    3: md(
        """
        Summary: On Monday morning around 08:40 the wired network on Level 3 stopped working for about 23 people.
        Wi-Fi still worked so people could use that as a workaround. I classed it as a P2.

        What I did: I checked one of the affected PCs with ipconfig /all and it had a 169.254 address, which
        means it could not get an address from DHCP. Ping to the gateway 10.20.30.1 failed. Because only the wired
        users on that floor were affected I thought it was the switch or the VLAN, so I escalated to the Network
        team at about 09:05 with the screenshot.

        Root cause: the Level 3 switch (SW02) had a firmware update over the weekend and the uplink module failed,
        so the VLAN for the users was not connected to the core and DHCP requests never reached the server.

        Fix: Network reseated the uplink and fixed the trunk at about 10:00. Users ran ipconfig /renew or
        restarted and I checked with a few of them that the intranet and Teams worked again.

        Communication: I posted in the Level 3 Teams channel at 08:50 and sent an update to the managers at about
        09:45 and when it was fixed.

        Follow up: a problem ticket should be raised about the firmware update and the switch should be checked
        after maintenance in future. — {name}
        """
    ),
    2: md(
        """
        The network went down on Level 3 on Monday morning. A lot of people called the service desk. I checked
        a computer and it had a strange IP address starting with 169 so I knew it was a network problem and sent
        the ticket to the network team.

        They found a problem with the switch after an update and fixed it. After that everyone restarted their
        computers and it was working again at about 10:15. I told the users it was fixed.

        Next time the network team should test the switch after updates. — {name}
        """
    ),
    1: md(
        """
        Level 3 internet was not working on Monday. The network team fixed the switch and now it works. Users
        were told. — {name}
        """
    ),
}

# =============================================================================================== structure

MODULES = [
    {
        "title": "IT Support Fundamentals",
        "description": "The service desk's role, ITIL vocabulary, priorities and the ticket lifecycle.",
        "bank": ("Module 1 – IT Support Fundamentals", M1_BANK),
        "lessons": [
            {
                "title": "The Service Desk and the Incident Lifecycle",
                "lesson_type": "text",
                "summary": "Incidents, requests, problems, priority and escalation.",
                "duration_minutes": 20,
                "content": {"body_markdown": M1_SERVICE_DESK},
                "skills": ["Troubleshooting Methodology"],
                "activities": [
                    {
                        "activity_type": "callout",
                        "title": "Northwind tip",
                        "content": {
                            "variant": "tip",
                            "body_markdown": "If you are unsure of a ticket's priority, ask: *how many people are affected, and what happens if we wait an hour?*",
                        },
                    },
                    {
                        "activity_type": "check",
                        "title": "Quick check",
                        "content": {
                            "question": "Ten users in one team cannot print, but they can print to the next floor. What priority fits best?",
                            "options": [
                                {"id": "a", "text": "P1 – Critical"},
                                {"id": "b", "text": "P3 – Medium"},
                                {"id": "c", "text": "P5 – Planning"},
                            ],
                            "answer_ids": ["b"],
                            "explanation": "Medium impact (one team) with a workaround available gives medium urgency: P3.",
                        },
                    },
                ],
            },
            {
                "title": "Writing Tickets Other Analysts Can Use",
                "lesson_type": "video",
                "summary": "What to capture so a ticket stands on its own.",
                "duration_minutes": 8,
                "content": {
                    "video_url": f"{PLACEHOLDER_MEDIA}/videos/writing-great-tickets.mp4",
                    "captions_url": f"{PLACEHOLDER_MEDIA}/captions/writing-great-tickets.en.vtt",
                    "captions_label": "English",
                    "captions_lang": "en",
                    "poster_url": f"{PLACEHOLDER_MEDIA}/posters/writing-great-tickets.jpg",
                    "body_markdown": "> **Demo placeholder video.** Replace the video URL with your own recording; the transcript below is the real script.",
                    "transcript": M1_TICKETS_TRANSCRIPT,
                },
                "skills": ["Customer Communication"],
            },
            {
                "title": "Service Desk Vocabulary",
                "lesson_type": "flashcards",
                "summary": "Twelve terms you'll use every day.",
                "duration_minutes": 10,
                "content": {"cards": [{"front": f, "back": b} for f, b in M1_FLASHCARDS]},
                "skills": ["Troubleshooting Methodology"],
            },
            {"kind": "quiz", "title": "Module 1 Quiz: IT Support Fundamentals"},
        ],
    },
    {
        "title": "Troubleshooting Methodology",
        "description": "A six-step process and the OSI model as tools for isolating faults.",
        "bank": ("Module 2 – Troubleshooting Methodology", M2_BANK),
        "lessons": [
            {
                "title": "A Structured Troubleshooting Process",
                "lesson_type": "text",
                "summary": "Identify, theorise, test, implement, verify, document.",
                "duration_minutes": 20,
                "content": {"body_markdown": M2_METHOD},
                "skills": ["Troubleshooting Methodology"],
            },
            {
                "title": "Isolating Faults with the OSI Model",
                "lesson_type": "text",
                "summary": "Bottom-up, top-down and divide-and-conquer.",
                "duration_minutes": 25,
                "content": {"body_markdown": M2_OSI},
                "skills": ["Troubleshooting Methodology", "Networking Fundamentals"],
            },
            {
                "title": "Case Study: The Printer That Wasn't Broken",
                "lesson_type": "scenario",
                "summary": "Apply the methodology to a real Monday-morning ticket.",
                "duration_minutes": 10,
                "content": {
                    "scenario": M2_SCENARIO,
                    "choices": M2_SCENARIO_CHOICES,
                    "body_markdown": "**Debrief:** the common factor (staff returning from leave) was the clue. Look for what affected users share before touching shared infrastructure.",
                },
                "skills": ["Troubleshooting Methodology"],
            },
            {"kind": "quiz", "title": "Module 2 Quiz: Troubleshooting Methodology"},
        ],
    },
    {
        "title": "Windows Troubleshooting",
        "description": "Event Viewer, Device Manager and PowerShell for first-line diagnostics.",
        "bank": ("Module 3 – Windows Troubleshooting", M3_BANK),
        "lessons": [
            {
                "title": "Finding Clues in Event Viewer",
                "lesson_type": "text",
                "summary": "Logs, levels and the Event IDs worth recognising.",
                "duration_minutes": 25,
                "content": {"body_markdown": M3_EVENTVIEWER},
                "skills": ["Windows Administration"],
            },
            {
                "title": "Device Manager and Driver Troubleshooting",
                "lesson_type": "video",
                "summary": "Problem codes, rolling back and reinstalling drivers.",
                "duration_minutes": 7,
                "content": {
                    "video_url": f"{PLACEHOLDER_MEDIA}/videos/device-manager-drivers.mp4",
                    "captions_url": f"{PLACEHOLDER_MEDIA}/captions/device-manager-drivers.en.vtt",
                    "captions_label": "English",
                    "captions_lang": "en",
                    "body_markdown": "> **Demo placeholder video.** The transcript below is the real script.",
                    "transcript": M3_DEVMGR_TRANSCRIPT,
                },
                "skills": ["Windows Administration", "Hardware Diagnostics"],
            },
            {
                "title": "PowerShell for First-Line Diagnostics",
                "lesson_type": "code",
                "summary": "Seven commands that answer the first questions on most tickets.",
                "duration_minutes": 20,
                "content": {
                    "language": "powershell",
                    "code": M3_POWERSHELL,
                    "instructions": "Run each block in a normal (non-admin) PowerShell window on your own machine. "
                    "Note which commands answer *what is this machine*, *is the service running* and *can it reach the network*. "
                    "None of these commands change anything, so they're safe to run on a user's device during a remote session.",
                },
                "skills": ["Windows Administration"],
            },
            {"kind": "quiz", "title": "Module 3 Quiz: Windows Troubleshooting"},
        ],
    },
    {
        "title": "Network Troubleshooting",
        "description": "IP configuration, DHCP and APIPA, the command-line toolkit and a live simulation.",
        "bank": ("Module 4 – Network Troubleshooting", M4_BANK),
        "lessons": [
            {
                "title": "IP Configuration: DHCP, APIPA and Static Addresses",
                "lesson_type": "text",
                "summary": "What clients need, how DHCP works and what 169.254 means.",
                "duration_minutes": 25,
                "content": {"body_markdown": M4_DHCP},
                "skills": ["Networking Fundamentals"],
            },
            {
                "title": "Command-Line Network Tools",
                "lesson_type": "mixed",
                "summary": "ipconfig, ping, tracert, netstat and Test-NetConnection.",
                "duration_minutes": 20,
                "content": {"body_markdown": M4_TOOLS_INTRO},
                "skills": ["Networking Fundamentals", "Windows Administration"],
                "activities": [
                    {
                        "activity_type": "text",
                        "title": "The core toolkit",
                        "content": {"body_markdown": M4_TOOLS_TEXT},
                    },
                    {
                        "activity_type": "code",
                        "title": "A healthy client, end to end",
                        "content": {
                            "language": "text",
                            "code": M4_TOOLS_CODE,
                            "instructions": "Notice how each command tests one more layer than the last.",
                        },
                    },
                    {
                        "activity_type": "callout",
                        "title": "Watch out",
                        "content": {
                            "variant": "warning",
                            "body_markdown": "Many firewalls block ICMP. A failed `ping` is a clue, not proof: test the real service port with `Test-NetConnection -Port`.",
                        },
                    },
                    {
                        "activity_type": "check",
                        "title": "Quick check",
                        "content": {
                            "question": "`tracert` to every destination stops after hop 1 (your gateway). Where is the fault most likely?",
                            "options": [
                                {"id": "a", "text": "On the user's laptop"},
                                {"id": "b", "text": "Between the gateway and the next router"},
                                {"id": "c", "text": "At the destination server"},
                            ],
                            "answer_ids": ["b"],
                            "explanation": "The gateway responds, but nothing beyond it does, for every destination.",
                        },
                    },
                ],
            },
            {
                "kind": "simulation",
                "title": "Live Ticket: Laptop Cannot Connect to the Network",
                "summary": "Diagnose and fix a real-world connectivity ticket in a simulated helpdesk.",
                "duration_minutes": 25,
                "content": {
                    "body_markdown": "Put everything from Modules 2–4 into practice. You're the Level 2 analyst on a ticket from Priya in Finance: her laptop can't reach the intranet after a VPN client update.",
                    "instructions": "Talk to the user, gather evidence with real Windows commands, record your diagnosis, fix the root cause, **verify** and document. You're scored on technical accuracy, process, communication, decision making and efficiency. You can attempt the simulation up to three times.",
                },
                "skills": [
                    "Networking Fundamentals",
                    "DNS",
                    "Troubleshooting Methodology",
                    "Customer Communication",
                ],
            },
            {"kind": "quiz", "title": "Module 4 Quiz: Network Troubleshooting"},
        ],
    },
    {
        "title": "DNS Troubleshooting",
        "description": "How Windows resolves names, caching, record types and a repeatable DNS check.",
        "bank": ("Module 5 – DNS Troubleshooting", M5_BANK),
        "lessons": [
            {
                "title": "How Windows Resolves a Name",
                "lesson_type": "text",
                "summary": "Resolution order, the hosts file, caching and record types.",
                "duration_minutes": 25,
                "content": {"body_markdown": M5_RESOLUTION_V1},
                "skills": ["DNS"],
                "key": "dns_resolution",
            },
            {
                "title": "Diagnosing DNS: nslookup, Resolve-DnsName and the Cache",
                "lesson_type": "text",
                "summary": "A six-step DNS check and how to read nslookup output.",
                "duration_minutes": 25,
                "content": {"body_markdown": M5_DIAGNOSE},
                "skills": ["DNS", "Windows Administration"],
            },
            {
                "title": "Practise with the AI Tutor: DNS Scenarios",
                "lesson_type": "ai_tutor",
                "summary": "Talk through DNS faults with a tutor grounded in Northwind's runbooks.",
                "duration_minutes": 10,
                "content": {
                    "body_markdown": M5_TUTOR,
                    "prompts": [
                        "Why would DNS cause this problem?",
                        "What's the difference between NXDOMAIN and a timeout?",
                        "Why does the hosts file override DNS?",
                        "Quiz me on DNS record types",
                    ],
                },
                "skills": ["DNS"],
            },
            {"kind": "quiz", "title": "Module 5 Quiz: DNS Troubleshooting"},
        ],
    },
    {
        "title": "Hardware Troubleshooting",
        "description": "POST and boot failures, beep codes and common component faults.",
        "bank": ("Module 6 – Hardware Troubleshooting", M6_BANK),
        "lessons": [
            {
                "title": "POST, Beep Codes and Boot Failures",
                "lesson_type": "text",
                "summary": "No power, no POST and no boot: where the sequence stops.",
                "duration_minutes": 20,
                "content": {"body_markdown": M6_POST},
                "skills": ["Hardware Diagnostics"],
            },
            {
                "title": "Diagnosing Common Hardware Faults",
                "lesson_type": "text",
                "summary": "Symptom → suspect → test for RAM, storage, heat, power and peripherals.",
                "duration_minutes": 20,
                "content": {"body_markdown": M6_FAULTS},
                "skills": ["Hardware Diagnostics"],
            },
            {"kind": "quiz", "title": "Module 6 Quiz: Hardware Troubleshooting"},
        ],
    },
    {
        "title": "Customer Communication",
        "description": "Active listening, plain language, de-escalation and a practical write-up.",
        "bank": ("Module 7 – Customer Communication", M7_BANK),
        "lessons": [
            {
                "title": "Active Listening and Asking Good Questions",
                "lesson_type": "text",
                "summary": "Paraphrasing, open vs closed questions and plain language.",
                "duration_minutes": 20,
                "content": {"body_markdown": M7_LISTENING},
                "skills": ["Customer Communication"],
            },
            {
                "title": "De-escalating a Frustrated User",
                "lesson_type": "video",
                "summary": "The HEARD model in practice.",
                "duration_minutes": 6,
                "content": {
                    "video_url": f"{PLACEHOLDER_MEDIA}/videos/de-escalation-heard.mp4",
                    "captions_url": f"{PLACEHOLDER_MEDIA}/captions/de-escalation-heard.en.vtt",
                    "captions_label": "English",
                    "captions_lang": "en",
                    "body_markdown": "> **Demo placeholder video.** The transcript below is the real script.",
                    "transcript": M7_DEESCALATE_TRANSCRIPT,
                },
                "skills": ["Customer Communication"],
            },
            {
                "kind": "assignment",
                "title": "Practical: Document a Network Outage Resolution",
                "summary": "Write a resolution record assessed against a five-criterion rubric.",
                "duration_minutes": 60,
                "content": {
                    "body_markdown": "Apply everything you've learned to document a real-world outage so another analyst, your team leader and the business can rely on it.",
                    "instructions": "Read the scenario, write your report and attach a screenshot of evidence. An AI assistant drafts a rubric recommendation; an assessor makes the final grade.",
                },
                "skills": [
                    "Customer Communication",
                    "Networking Fundamentals",
                    "Troubleshooting Methodology",
                ],
            },
            {"kind": "quiz", "title": "Module 7 Quiz: Customer Communication"},
            {
                "kind": "final",
                "title": "Final Assessment",
                "summary": "18 questions drawn from every module. 45 minutes, two attempts, pass mark 75%.",
                "duration_minutes": 45,
            },
        ],
    },
]

# v2 edit: a new lesson in module 5 and an expanded resolution lesson.
V2_NEW_LESSON = {
    "title": "Split-Brain DNS and VPN Clients",
    "lesson_type": "text",
    "summary": "Why the same name can have two answers, and how VPN updates break it.",
    "duration_minutes": 10,
    "content": {
        "body_markdown": M5_RESOLUTION_V2_EXTRA
        + "\n"
        + md(
            """
        ### Checklist after a VPN client update

        1. `ipconfig /all`: is the DNS server on the Wi-Fi/Ethernet adapter **static**? It shouldn't be.
        2. `Get-DnsClientNrptPolicy`: is a name resolution policy present while connected?
        3. Compare `Resolve-DnsName portal.northwind.com` on and off the VPN.
        4. Reset adapter DNS to automatic: `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses`.
        5. `ipconfig /flushdns`, then verify internal and external names.
        """
        )
    },
    "skills": ["DNS", "Networking Fundamentals"],
}
V2_CHANGELOG = (
    "Version 2: added the lesson 'Split-Brain DNS and VPN Clients' to Module 5 with a post-VPN-update checklist; "
    "expanded 'How Windows Resolves a Name' with a split-brain DNS section; clarified the final assessment time limit."
)

FINAL_POOL_DRAWS = [3, 3, 3, 3, 2, 2, 2]  # per module bank → 18 questions
OBJECTIVE_TYPES = [
    "multiple_choice",
    "multiple_select",
    "true_false",
    "short_answer",
    "matching",
    "ordering",
    "fill_blank",
]
