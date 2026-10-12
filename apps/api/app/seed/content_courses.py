"""Supporting courses: cyber incident response, customer service, WHS, privacy, plus a draft, an archived
course and small courses for the second organisation and the individual learner."""

from __future__ import annotations

from textwrap import dedent

from app.seed.qb import fill, long, match, mc, ms, order, sa, tf

PLACEHOLDER_MEDIA = "https://example.com/praxis-demo-placeholder"


def md(text: str) -> str:
    return dedent(text).strip() + "\n"


# ============================================================================================ cyber / SOC

CYBER_LIFECYCLE = md(
    """
    ## The incident response lifecycle

    Most security teams structure incident response on **NIST SP 800-61**, which defines four phases:

    | Phase | Goal | Typical SOC activities |
    |---|---|---|
    | **Preparation** | Be ready before anything happens | Playbooks, logging coverage, contact lists, tooling, exercises |
    | **Detection & Analysis** | Decide whether an event is an incident and how bad it is | Alert triage, enrichment, scoping, severity rating |
    | **Containment, Eradication & Recovery** | Stop the damage, remove the cause, restore service | Isolate hosts, block indicators, reset credentials, restore from clean backups |
    | **Post-Incident Activity** | Learn and improve | Lessons-learned review, detection tuning, report to stakeholders |

    The phases loop: what you learn after an incident feeds back into preparation.

    ## Severity drives everything

    | Severity | Example | Response |
    |---|---|---|
    | Critical | Ransomware spreading, confirmed data exfiltration | Major incident; executive notification; 24×7 response |
    | High | Compromised privileged account, malware on a server | Immediate containment; IR lead assigned |
    | Medium | Single phished user, contained malware on a laptop | Contain within hours; standard playbook |
    | Low | Blocked attack, policy violation | Log, tune, educate |

    ## Evidence matters

    Record **what you saw, when, and where** in UTC timestamps. Preserve evidence before you change things:
    export the email, capture memory or disk images when the playbook requires it, and record hashes. If a
    case may end up with legal or HR involvement, maintain a **chain of custody**: who handled each item and
    when.
    """
)

CYBER_TRIAGE = md(
    """
    ## From alert to decision

    A SOC analyst's core loop is **triage**: decide quickly and defensibly whether an alert is a true
    positive, a false positive or needs more investigation.

    1. **Read the alert**: what rule fired, on which asset or identity, and why?
    2. **Enrich**: user role and recent sign-ins, asset criticality, threat intelligence on IPs, domains and
       file hashes, related alerts in the last 24 hours.
    3. **Scope**: is it one host or many? One mailbox or a campaign? Search the SIEM for the same indicators.
    4. **Decide and act**: close as a false positive *with a reason*, or escalate to an incident and start
       containment according to the playbook.

    ## Mapping to MITRE ATT&CK

    Mapping activity to **ATT&CK** techniques gives everyone a shared language. A credential-phishing email
    is *Phishing: Spearphishing Link (T1566.002)*; a sign-in from the stolen password is *Valid Accounts
    (T1078)*. Mapping also shows which later stages to hunt for.

    ## Common triage mistakes

    * Closing an alert because "the user said it was fine" without evidence.
    * Investigating one mailbox when the same email reached 40 people.
    * Resetting a password but leaving the attacker's MFA method or mailbox rules in place.
    * Forgetting to tell the user they did the right thing by reporting.
    """
)

CYBER_EMAIL = md(
    """
    ## Reading a suspicious email like an analyst

    ### Headers

    | Header | What to check |
    |---|---|
    | `From` | Display name vs actual address (e.g. "Microsoft 365" `<alerts@micros0ft-support.com>`) |
    | `Reply-To` | Replies redirected to a different domain? |
    | `Return-Path` | The envelope sender used for bounces; mismatches are a common spoofing sign |
    | `Authentication-Results` | `spf=`, `dkim=` and `dmarc=` results: failures are strong indicators |
    | `Received` | The path the message took; read from the bottom up |

    **SPF** checks the sending server is authorised for the envelope domain, **DKIM** verifies a
    cryptographic signature over the message, and **DMARC** ties them to the visible From domain and states
    what to do on failure.

    ### Links and attachments

    * Hover to read the real URL; look for look-alike domains and URL shorteners.
    * **Defang** indicators in notes (`hxxps://login-micros0ft[.]com`) so nobody clicks them.
    * Detonate URLs and attachments in a **sandbox**, never on your workstation.
    * Check whether anyone *clicked* (proxy logs) and whether anyone *entered credentials* (sign-in logs).

    ### Contain the campaign, not just the message

    Search all mailboxes for the same sender, subject or URL, quarantine every copy, block the sender and URL,
    and reset credentials (and revoke sessions and MFA registrations) for any user who submitted them.
    """
)

CYBER_BANK = [
    order(
        "Put the NIST incident response phases in order.",
        [
            "Preparation",
            "Detection and analysis",
            "Containment, eradication and recovery",
            "Post-incident activity",
        ],
        "NIST SP 800-61 defines these four phases; lessons learned feed back into preparation.",
        tags=["nist", "lifecycle"],
        skills=["Incident Response"],
    ),
    mc(
        "An email's Authentication-Results header shows `spf=fail dkim=none dmarc=fail`. What does this suggest?",
        [
            "The message probably did not come from the domain it claims to be from",
            "The email is safe because it was delivered",
            "The recipient's mailbox is full",
            "The attachment is encrypted",
        ],
        0,
        "SPF and DMARC failures mean the sender isn't authorised for the claimed domain: a strong spoofing sign.",
        difficulty=3,
        tags=["email", "headers"],
        skills=["Phishing Analysis"],
        distractor=1,
    ),
    ms(
        "A credential-phishing email reached 47 users and one entered their password. Which containment steps "
        "are appropriate? Select all that apply.",
        [
            "Quarantine every copy of the email across mailboxes",
            "Reset the affected user's password and revoke their sessions",
            "Block the sender and the phishing URL",
            "Delete the single copy in the reporting user's inbox and close the case",
            "Publicly name the user who clicked in the all-staff email",
        ],
        {0, 1, 2},
        "Contain the whole campaign and the compromised identity. Shaming users discourages reporting.",
        difficulty=2,
        tags=["containment"],
        skills=["Incident Response", "Phishing Analysis"],
    ),
    tf(
        "You should open a suspicious attachment on your own workstation to see what it does.",
        False,
        "Always use an isolated sandbox for detonation.",
        difficulty=1,
        tags=["sandbox"],
        skills=["Phishing Analysis"],
    ),
    match(
        "Match each email authentication mechanism to what it verifies.",
        [
            ("SPF", "The sending server is authorised to send for the envelope domain"),
            ("DKIM", "A cryptographic signature over the message is valid"),
            ("DMARC", "SPF/DKIM align with the visible From domain, plus the failure policy"),
        ],
        "Together they make spoofing the visible From address much harder.",
        difficulty=3,
        tags=["email"],
        skills=["Phishing Analysis"],
    ),
    fill(
        "Complete the sentence.",
        "Writing hxxps://evil[.]com in case notes so nobody can click it is called {{b1}} the indicator.",
        {"b1": ["defanging", "defang"]},
        "Defanging keeps indicators readable but non-clickable.",
        difficulty=2,
        tags=["indicators"],
        skills=["Phishing Analysis"],
    ),
    sa(
        "Which MITRE ATT&CK tactic-technique pair describes a phishing email containing a malicious link? "
        "(Give the technique name.)",
        ["spearphishing link", "phishing: spearphishing link", "t1566.002"],
        "T1566.002 Phishing: Spearphishing Link.",
        regex=r"(?i).*(spear\s*phishing\s*link|t1566\.002).*",
        wrong="drive-by compromise",
        difficulty=4,
        tags=["mitre"],
        skills=["Threat Detection"],
    ),
    long(
        "A user reports a suspicious 'Microsoft 365 password expiry' email. Describe how you would triage it.",
        "Check headers (From vs Return-Path, Reply-To, SPF/DKIM/DMARC), analyse the URL in a sandbox, search the "
        "SIEM/mail logs for other recipients and clicks, check sign-in logs for credential use, classify, quarantine "
        "all copies, block sender/URL, reset and revoke sessions for affected users, notify and thank the reporter.",
        [
            "headers",
            "spf",
            "dmarc",
            "sandbox",
            "url",
            "siem",
            "recipients",
            "sign-in",
            "quarantine",
            "block",
            "reset",
        ],
        "Scope the campaign and check for credential use, not just the single email.",
        good=(
            "First I'd export the email and check the headers: the From display name versus the real address, "
            "Reply-To, Return-Path and the SPF, DKIM and DMARC results. I'd defang the link and detonate it in a "
            "sandbox to confirm it's a credential-harvesting page. Then I'd scope it in the SIEM and message trace: "
            "who else received it, who clicked according to proxy logs, and whether anyone entered credentials by "
            "checking sign-in logs for unusual locations. If confirmed I'd classify it as phishing, quarantine every "
            "copy, block the sender domain and URL, and reset passwords and revoke sessions for affected users. "
            "Finally I'd thank the reporter and document the case."
        ),
        weak="I would tell the user to delete it and block the sender.",
        tags=["triage"],
        skills=["Incident Response", "Phishing Analysis"],
    ),
]

CYBER = {
    "course": {
        "title": "Cybersecurity Incident Response for SOC Analysts",
        "subtitle": "Triage alerts, investigate phishing and contain incidents with confidence",
        "description": md(
            """
            A practical introduction to incident response in a security operations centre. You'll learn the NIST
            incident response lifecycle, how to triage alerts with enrichment and scoping, and how to analyse a
            phishing email from headers to containment, then investigate a live phishing campaign in a simulated SOC.
            """
        ),
        "category": "Cyber Security",
        "difficulty": "intermediate",
        "duration_minutes": 180,
        "learning_objectives": [
            "Describe the four phases of the NIST incident response lifecycle",
            "Triage alerts using enrichment, scoping and severity",
            "Analyse email headers, SPF, DKIM and DMARC results and malicious links",
            "Contain a phishing campaign and a compromised account",
        ],
        "prerequisites": ["IT Support Troubleshooting Fundamentals or equivalent experience"],
        "target_audience": "SOC Level 1 analysts and service desk staff moving into security.",
        "tags": ["security", "soc", "incident-response", "phishing"],
        "certificate_enabled": True,
        "pass_threshold": 70,
        "ai_tutor_enabled": True,
    },
    "skills": [
        ("Incident Response", "Detecting, containing and recovering from security incidents."),
        ("Phishing Analysis", "Investigating suspicious emails, headers and links."),
        ("Threat Detection", "Alert triage, enrichment and ATT&CK mapping."),
    ],
    "modules": [
        {
            "title": "Incident Response Foundations",
            "description": "Lifecycle, severity and triage.",
            "lessons": [
                {
                    "title": "The Incident Response Lifecycle",
                    "lesson_type": "text",
                    "duration_minutes": 20,
                    "summary": "NIST SP 800-61 phases, severity and evidence handling.",
                    "content": {"body_markdown": CYBER_LIFECYCLE},
                    "skills": ["Incident Response"],
                },
                {
                    "title": "Alert Triage in the SOC",
                    "lesson_type": "text",
                    "duration_minutes": 20,
                    "summary": "Enrich, scope, decide, and map to MITRE ATT&CK.",
                    "content": {"body_markdown": CYBER_TRIAGE},
                    "skills": ["Threat Detection"],
                },
            ],
        },
        {
            "title": "Phishing Investigation",
            "description": "From headers to campaign containment.",
            "lessons": [
                {
                    "title": "Analysing a Suspicious Email",
                    "lesson_type": "text",
                    "duration_minutes": 25,
                    "summary": "Headers, SPF/DKIM/DMARC, links and attachments.",
                    "content": {"body_markdown": CYBER_EMAIL},
                    "skills": ["Phishing Analysis"],
                },
                {
                    "kind": "simulation",
                    "template": "phishing-email-investigation",
                    "title": "Live Investigation: Phishing Email Campaign",
                    "duration_minutes": 20,
                    "summary": "Triage a user-reported phish, scope the campaign and recover a compromised account.",
                    "content": {
                        "body_markdown": "A user has reported a 'Microsoft 365 security alert' email. Investigate it end to end in the simulated SOC.",
                        "instructions": "Analyse the evidence before you act, contain the whole campaign and keep stakeholders informed.",
                    },
                    "skills": ["Phishing Analysis", "Incident Response"],
                },
                {"kind": "quiz", "title": "Course Quiz: Incident Response and Phishing"},
            ],
        },
    ],
    "bank": ("SOC – Incident Response and Phishing", CYBER_BANK),
}

# ============================================================================================ customer service

CS_REMEMBER = md(
    """
    ## Moments of truth

    Customers judge a business on a handful of **moments of truth**: the first greeting, the moment something
    goes wrong, and how it's put right. Research on service recovery consistently finds that a problem handled
    well can leave a customer *more* loyal than one who never had a problem at all.

    ## Expectations

    Satisfaction is the gap between what customers **expected** and what they **experienced**. You can
    close the gap from both sides: deliver more, and set honest expectations ("Your replacement will arrive
    Thursday" beats "soon").

    ## Measuring service

    | Measure | Question | Use |
    |---|---|---|
    | CSAT | "How satisfied were you with this interaction?" | Quality of individual interactions |
    | NPS | "How likely are you to recommend us?" (0–10) | Overall loyalty |
    | First contact resolution | Was it solved on the first contact? | Efficiency and customer effort |
    | Customer effort score | "How easy was it to get your issue resolved?" | Friction in the process |

    ## Language that helps

    * Say what you **can** do: "What I can do right now is…"
    * Use the customer's name and own the problem: "I'll look after this for you."
    * Replace "you have to" with "the quickest way is…"
    """
)

CS_RECOVERY_TRANSCRIPT = md(
    """
    [00:00] When something goes wrong for a customer, the next two minutes matter more than the mistake. A
    simple structure many service teams use is LAST: Listen, Apologise, Solve, Thank.

    [00:15] Listen fully. Don't interrupt, and don't start defending the business. Take notes and repeat the key
    facts back.

    [00:30] Apologise sincerely for the experience. "I'm really sorry, that's not the experience we want you to
    have." You don't need to admit legal fault to be genuinely sorry.

    [00:48] Solve. Offer a fair remedy and, where you can, a choice: a replacement today, or a refund. If you
    need to check with someone, say exactly when you'll come back.

    [01:05] Thank the customer for telling you. Every complaint is free information about how to improve.

    [01:15] And if there's a safety issue – an allergy, an injury – safety comes before everything else, including
    the apology. We'll practise that in the simulation.
    """
)

CS_COMPLAINTS = md(
    """
    ## A complaint-handling routine

    1. **Make sure everyone is safe.** Injury, allergic reaction or danger? Act first: first aid, emergency
       services, remove the hazard.
    2. **Listen and acknowledge.** Let the customer explain; acknowledge the impact on them.
    3. **Apologise for the experience** without arguing about blame.
    4. **Find the facts.** Talk to staff involved, check records (dockets, logs, CCTV where appropriate).
    5. **Put it right.** A fair remedy that matches the impact, explained clearly.
    6. **Record and report.** Complete incident or complaint records accurately and escalate as policy requires.
    7. **Follow up.** Contact the customer afterwards, and fix the process so it doesn't recur.

    ## Remedies

    | Situation | Proportionate remedy |
    |---|---|
    | Long wait, order otherwise fine | Sincere apology, small gesture (drink, discount) |
    | Wrong or poor-quality item | Replace or refund promptly, plus apology |
    | Safety incident (e.g. allergen exposure) | Medical care first; waive the bill; formal incident report; manager follow-up |

    ## What not to do

    * Argue about whose fault it was in front of the customer.
    * Promise outcomes you can't deliver ("this will never happen again") without a process change behind it.
    * Skip the record: unreported incidents can't be investigated or prevented.
    """
)

CS_BANK = [
    order(
        "Put the LAST service recovery steps in order.",
        ["Listen", "Apologise", "Solve", "Thank"],
        "Listen first, apologise sincerely, solve fairly and thank the customer for raising it.",
        tags=["service-recovery"],
        skills=["Service Recovery"],
    ),
    mc(
        "A guest who declared a peanut allergy says they are having a reaction after eating. What do you do first?",
        [
            "Make sure they are safe: first aid, ask about their EpiPen and call an ambulance",
            "Apologise and offer a free dessert",
            "Ask the kitchen who made the mistake",
            "Fill in the incident report while it is fresh",
        ],
        0,
        "Safety always comes first; apologies, investigation and records follow.",
        difficulty=1,
        tags=["safety"],
        skills=["Complaint Handling"],
        distractor=1,
    ),
    tf(
        "A complaint that is handled well can leave a customer more loyal than if nothing had gone wrong.",
        True,
        "This is the service recovery paradox: fast, fair recovery builds trust.",
        tags=["service-recovery"],
        skills=["Service Recovery"],
    ),
    match(
        "Match each measure to the question it asks.",
        [
            ("CSAT", "How satisfied were you with this interaction?"),
            ("NPS", "How likely are you to recommend us?"),
            ("Customer effort score", "How easy was it to get your issue resolved?"),
        ],
        "Each measure answers a different question about service.",
        difficulty=2,
        tags=["metrics"],
        skills=["Customer Communication"],
    ),
    ms(
        "Which phrases help a frustrated customer? Select all that apply.",
        [
            '"What I can do right now is…"',
            '"I\'ll look after this for you."',
            '"That\'s not my department."',
            '"You have to fill in the form first."',
            '"I\'m really sorry this happened."',
        ],
        {0, 1, 4},
        "Positive, ownership-taking language reduces frustration.",
        tags=["language"],
        skills=["Customer Communication"],
    ),
    fill(
        "Complete the sentence.",
        "Customer satisfaction is the gap between what customers {{b1}} and what they experienced.",
        {"b1": ["expected", "expect"]},
        "Set honest expectations and then meet or beat them.",
        tags=["expectations"],
        skills=["Customer Communication"],
    ),
    sa(
        "What should you always complete after a safety incident involving a customer?",
        ["incident report", "an incident report", "the incident report"],
        "Accurate incident records allow investigation, insurance and prevention.",
        regex=r"(?i).*incident\s+(report|record|form).*",
        wrong="a refund",
        tags=["compliance"],
        skills=["Complaint Handling"],
    ),
    long(
        "Describe how you would handle a customer whose meal arrived cold after a 40-minute wait.",
        "Listen and acknowledge the wait and the cold meal, apologise sincerely, replace the meal promptly or offer "
        "a choice of remedy, possibly a gesture for the wait, check with the kitchen why it happened, thank the "
        "customer and follow up before they leave; record the issue.",
        ["listen", "acknowledge", "apologise", "replace", "choice", "kitchen", "thank", "follow up"],
        "A proportionate remedy plus finding out why.",
        good=(
            "I'd listen without interrupting and acknowledge that a 40-minute wait followed by a cold meal is really "
            "disappointing. I'd apologise sincerely and offer a choice: a freshly cooked replacement as a priority, or "
            "removing it from the bill, plus a drink on the house for the wait. I'd check with the kitchen why the "
            "order was delayed and sat at the pass, thank the guest for telling us, and come back before they leave "
            "to make sure everything is right. I'd note it in the shift log so the manager can address the cause."
        ),
        weak="I would say sorry and take it back to the kitchen to be heated up.",
        tags=["service-recovery"],
        skills=["Service Recovery", "Complaint Handling"],
    ),
]

CUSTOMER_SERVICE = {
    "course": {
        "title": "Customer Service Excellence",
        "subtitle": "Moments of truth, service recovery and complaint handling",
        "description": md(
            """
            Great service is a skill you can practise. This course covers what customers remember, how to set and
            meet expectations, the LAST service recovery model and a complaint-handling routine that puts safety
            first, then lets you handle a serious complaint in a realistic restaurant simulation.
            """
        ),
        "category": "Customer Service",
        "difficulty": "beginner",
        "duration_minutes": 120,
        "learning_objectives": [
            "Explain moments of truth and the service recovery paradox",
            "Apply the LAST model to recover a service failure",
            "Handle a complaint safely, fairly and with an accurate record",
        ],
        "target_audience": "Anyone who deals with customers or internal users.",
        "tags": ["customer-service", "communication", "complaints"],
        "certificate_enabled": True,
        "pass_threshold": 70,
        "ai_tutor_enabled": True,
    },
    "skills": [
        ("Service Recovery", "Turning a service failure into a positive outcome."),
        ("Complaint Handling", "Handling complaints safely, fairly and with accurate records."),
    ],
    "modules": [
        {
            "title": "Foundations of Great Service",
            "description": "Expectations, moments of truth and recovery.",
            "lessons": [
                {
                    "title": "What Customers Remember",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "summary": "Moments of truth, expectations and how service is measured.",
                    "content": {"body_markdown": CS_REMEMBER},
                    "skills": ["Customer Communication"],
                },
                {
                    "title": "Service Recovery in Practice",
                    "lesson_type": "video",
                    "duration_minutes": 6,
                    "summary": "The LAST model: Listen, Apologise, Solve, Thank.",
                    "content": {
                        "video_url": f"{PLACEHOLDER_MEDIA}/videos/service-recovery-last.mp4",
                        "captions_url": f"{PLACEHOLDER_MEDIA}/captions/service-recovery-last.en.vtt",
                        "captions_label": "English",
                        "captions_lang": "en",
                        "body_markdown": "> **Demo placeholder video.** The transcript below is the real script.",
                        "transcript": CS_RECOVERY_TRANSCRIPT,
                    },
                    "skills": ["Service Recovery"],
                },
            ],
        },
        {
            "title": "Handling Complaints",
            "description": "A safety-first complaint routine and a live simulation.",
            "lessons": [
                {
                    "title": "Handling Complaints Step by Step",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "summary": "Seven steps from safety to follow-up, and proportionate remedies.",
                    "content": {"body_markdown": CS_COMPLAINTS},
                    "skills": ["Complaint Handling"],
                },
                {
                    "kind": "simulation",
                    "template": "restaurant-food-safety-complaint",
                    "title": "Live Scenario: Allergy Complaint at Dinner Service",
                    "duration_minutes": 15,
                    "summary": "You're the duty manager when a guest has an allergic reaction.",
                    "content": {
                        "body_markdown": "A guest who declared a peanut allergy reports a reaction. You're the duty manager on shift.",
                        "instructions": "Put guest safety first, recover the service, investigate and complete the incident report.",
                    },
                    "skills": ["Complaint Handling", "Service Recovery"],
                },
                {"kind": "quiz", "title": "Course Quiz: Customer Service Excellence"},
            ],
        },
    ],
    "bank": ("Customer Service Excellence", CS_BANK),
}

# ============================================================================================ WHS

WHS_DUTIES = md(
    """
    ## Who has duties?

    Australia's model **Work Health and Safety (WHS) Act** (adopted, with local variations, by most states and
    territories) places duties on several groups:

    | Duty holder | Duty |
    |---|---|
    | **PCBU** (person conducting a business or undertaking) – usually the employer | Primary duty of care: ensure, *so far as is reasonably practicable*, the health and safety of workers and others affected by the work |
    | **Officers** (directors, senior executives) | Exercise *due diligence* to ensure the PCBU complies |
    | **Workers** (employees, contractors, volunteers) | Take reasonable care of their own and others' health and safety and follow reasonable instructions and policies |
    | **Others at the workplace** (visitors) | Take reasonable care and comply with reasonable instructions |

    "Reasonably practicable" weighs the likelihood and severity of harm against what is known about the
    hazard and ways to control it, and the availability, suitability and (lastly) cost of controls.

    ## Consultation

    PCBUs must consult workers on health and safety matters that affect them. Workers can elect **health and
    safety representatives (HSRs)**. At Northwind, raise concerns with your manager, your HSR or through the
    safety portal.

    ## Psychosocial hazards

    WHS duties cover **psychological** health too: excessive workload, bullying, harassment and poor support
    are hazards to be managed like any physical hazard.
    """
)

WHS_HIERARCHY = md(
    """
    ## Hazard, risk and control

    A **hazard** is anything that could cause harm (a trailing cable, a heavy box, an aggressive caller). The
    **risk** is the likelihood and consequence of that harm. Controls reduce the risk.

    ## The hierarchy of control

    Work from the top: higher controls are more effective because they rely less on people remembering.

    1. **Eliminate** the hazard (remove the trailing cable by installing a floor box).
    2. **Substitute** it with something safer (a lighter, wheeled monitor trolley).
    3. **Isolate** people from it (lock the comms room).
    4. **Engineering controls** (cable trays, sit-stand desks, ventilation).
    5. **Administrative controls** (procedures, training, signage, job rotation).
    6. **Personal protective equipment** (gloves, safety glasses): the last line of defence.

    ## Desk work and ergonomics

    * Top of the screen at or slightly below eye level, about an arm's length away.
    * Feet flat, thighs roughly parallel to the floor, lower back supported.
    * Change posture often: stand, stretch or walk every 30–60 minutes.

    ## Reporting

    Report **all** incidents, injuries and near misses through the safety portal before the end of your shift.
    Near misses are free lessons: the same hazard may injure someone next time. Serious incidents (e.g. serious
    injury) may be *notifiable* to the regulator and the scene must be preserved; tell your manager immediately.
    """
)

WHS_BANK = [
    order(
        "Order the hierarchy of control from most to least effective.",
        ["Eliminate", "Substitute", "Isolate", "Engineering controls", "Administrative controls", "PPE"],
        "Controls higher up rely less on human behaviour.",
        tags=["hierarchy-of-control"],
        skills=["Workplace Safety"],
    ),
    mc(
        "Under the model WHS Act, who holds the primary duty of care?",
        [
            "The PCBU (person conducting a business or undertaking)",
            "Each individual worker",
            "The health and safety representative",
            "The building owner only",
        ],
        0,
        "The PCBU has the primary duty; officers, workers and others have their own duties too.",
        tags=["duties"],
        skills=["Workplace Safety"],
        distractor=1,
    ),
    tf(
        "Near misses do not need to be reported because nobody was hurt.",
        False,
        "Near misses reveal hazards before they injure someone and must be reported.",
        tags=["reporting"],
        skills=["Workplace Safety"],
    ),
    ms(
        "Which are psychosocial hazards? Select all that apply.",
        ["Bullying", "Excessive workload", "Poor support from managers", "A wet floor", "Trailing cables"],
        {0, 1, 2},
        "Psychosocial hazards affect mental health and are managed under the same WHS duties.",
        tags=["psychosocial"],
        skills=["Workplace Safety"],
    ),
    match(
        "Match each control to its level in the hierarchy.",
        [
            ("Installing a floor box so no cable crosses the walkway", "Eliminate"),
            ("Fitting cable trays under desks", "Engineering control"),
            ("A sign reminding staff to tuck chairs in", "Administrative control"),
            ("Safety glasses in the workshop", "PPE"),
        ],
        "Think about whether the control removes the hazard or relies on people.",
        difficulty=3,
        tags=["hierarchy-of-control"],
        skills=["Workplace Safety"],
    ),
    fill(
        "Complete the sentence.",
        "Duties must be met so far as is reasonably {{b1}}.",
        {"b1": ["practicable"]},
        "This phrase is central to the model WHS Act.",
        tags=["duties"],
        skills=["Workplace Safety"],
    ),
    sa(
        "What do the letters HSR stand for?",
        ["health and safety representative", "health & safety representative"],
        "HSRs are elected by workers to represent them on health and safety matters.",
        wrong="human safety resource",
        tags=["consultation"],
        skills=["Workplace Safety"],
    ),
]

WHS = {
    "course": {
        "title": "Workplace Health & Safety Essentials",
        "subtitle": "Your duties, the hierarchy of control and how to report",
        "description": "Mandatory annual training covering WHS duties, hazards and risk, the hierarchy of control, "
        "ergonomics for desk work and how to report incidents and near misses at Northwind.",
        "category": "Compliance",
        "difficulty": "beginner",
        "duration_minutes": 60,
        "learning_objectives": [
            "Describe the duties of PCBUs, officers and workers",
            "Apply the hierarchy of control to workplace hazards",
            "Set up a workstation ergonomically",
            "Report incidents and near misses correctly",
        ],
        "target_audience": "All Northwind staff (mandatory, annual).",
        "tags": ["compliance", "whs", "safety", "mandatory"],
        "certificate_enabled": True,
        "pass_threshold": 80,
        "ai_tutor_enabled": False,
    },
    "skills": [("Workplace Safety", "WHS duties, hazard control and incident reporting.")],
    "modules": [
        {
            "title": "Duties and Consultation",
            "description": "Who must do what under WHS law.",
            "lessons": [
                {
                    "title": "Duties Under WHS Law",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "summary": "PCBUs, officers, workers and psychosocial hazards.",
                    "content": {"body_markdown": WHS_DUTIES},
                    "skills": ["Workplace Safety"],
                },
            ],
        },
        {
            "title": "Managing Hazards",
            "description": "Controls, ergonomics and reporting.",
            "lessons": [
                {
                    "title": "Hazards, Risks and the Hierarchy of Control",
                    "lesson_type": "text",
                    "duration_minutes": 20,
                    "summary": "From elimination to PPE, plus desk ergonomics and reporting.",
                    "content": {"body_markdown": WHS_HIERARCHY},
                    "skills": ["Workplace Safety"],
                },
                {"kind": "quiz", "title": "WHS Essentials Assessment"},
            ],
        },
    ],
    "bank": ("Workplace Health & Safety Essentials", WHS_BANK),
}

# ============================================================================================ privacy

PRIVACY_PRINCIPLES = md(
    """
    ## What counts as personal data?

    Under the EU **General Data Protection Regulation (GDPR)**, personal data is any information relating to an
    identified or identifiable living person: names, email addresses, employee IDs, IP addresses, location data
    and device identifiers all qualify. **Special category** data (health, biometrics, religion, trade union
    membership and more) needs extra protection.

    ## The seven principles (Article 5)

    | Principle | In practice |
    |---|---|
    | Lawfulness, fairness and transparency | Have a lawful basis and tell people what you do with their data |
    | Purpose limitation | Collect for specified purposes; don't repurpose without a basis |
    | Data minimisation | Collect only what you need |
    | Accuracy | Keep it correct and up to date |
    | Storage limitation | Keep it no longer than necessary |
    | Integrity and confidentiality | Protect it with appropriate security |
    | Accountability | Be able to *demonstrate* compliance |

    ## Lawful bases (Article 6)

    Consent, contract, legal obligation, vital interests, public task and legitimate interests. Consent is only
    one of six, and it must be freely given, specific, informed and as easy to withdraw as to give.

    ## Australia

    Northwind's Australian operations are also bound by the **Privacy Act 1988** and its **Australian Privacy
    Principles (APPs)**, including the **Notifiable Data Breaches (NDB) scheme**.
    """
)

PRIVACY_RIGHTS = md(
    """
    ## Data subject rights

    Individuals can ask to **access** their data, have it **rectified**, **erased** ("right to be forgotten"),
    **restricted**, **ported** to another provider, and can **object** to some processing. Organisations must
    normally respond within **one month**. At Northwind, forward every such request to privacy@northwind.demo
    the day you receive it: don't try to handle it yourself.

    ## Personal data breaches

    A breach is any security incident leading to accidental or unlawful destruction, loss, alteration,
    unauthorised disclosure of, or access to, personal data: an email sent to the wrong person counts.

    * Under GDPR, notify the supervisory authority **within 72 hours** of becoming aware, unless the breach is
      unlikely to result in a risk to individuals; tell affected individuals without undue delay when the risk
      is high.
    * Under Australia's NDB scheme, eligible breaches likely to cause **serious harm** must be notified to the
      OAIC and affected individuals.

    **Your job:** report suspected breaches to the service desk or privacy team *immediately*. The 72-hour
    clock starts when the organisation becomes aware, and that can be the moment you notice.

    ## Everyday habits

    * Lock your screen; use approved storage only; never email spreadsheets of customer data to personal accounts.
    * Double-check recipients before sending personal data, and use the secure file-sharing tool.
    * Shred printed personal data.
    """
)

PRIVACY_BANK = [
    mc(
        "Within how many hours must a notifiable personal data breach normally be reported to the supervisory "
        "authority under GDPR?",
        ["72 hours", "24 hours", "7 days", "30 days"],
        0,
        "Article 33 requires notification within 72 hours of becoming aware, where feasible.",
        tags=["breach"],
        skills=["Data Privacy"],
        distractor=1,
    ),
    ms(
        "Which of these are personal data? Select all that apply.",
        [
            "An employee ID number",
            "A customer's email address",
            "A device's IP address",
            "Aggregated, anonymised sales totals by region",
            "The company's ABN",
        ],
        {0, 1, 2},
        "Anything relating to an identifiable living person is personal data; truly anonymised aggregates are not.",
        tags=["personal-data"],
        skills=["Data Privacy"],
    ),
    tf(
        "Consent is the only lawful basis for processing personal data under GDPR.",
        False,
        "There are six lawful bases; consent is just one.",
        tags=["lawful-basis"],
        skills=["Data Privacy"],
    ),
    match(
        "Match each GDPR principle to an example.",
        [
            ("Data minimisation", "Only collecting the fields a form actually needs"),
            ("Storage limitation", "Deleting applicant CVs after the retention period"),
            ("Integrity and confidentiality", "Encrypting laptops that hold customer data"),
            ("Accountability", "Keeping records that demonstrate compliance"),
        ],
        "Each principle shows up in everyday decisions.",
        difficulty=3,
        tags=["principles"],
        skills=["Data Privacy"],
    ),
    sa(
        "A customer emails asking for a copy of all the data Northwind holds about them. Where should you forward it?",
        ["privacy@northwind.demo", "the privacy team", "privacy team"],
        "Data subject requests go to the privacy team the same day.",
        regex=r"(?i).*privacy.*",
        wrong="I would reply myself",
        tags=["rights"],
        skills=["Data Privacy"],
    ),
    fill(
        "Complete the sentence.",
        "Organisations must normally respond to a data subject access request within one {{b1}}.",
        {"b1": ["month"]},
        "The deadline can be extended in limited circumstances.",
        tags=["rights"],
        skills=["Data Privacy"],
    ),
]

PRIVACY = {
    "course": {
        "title": "Data Privacy & GDPR Basics",
        "subtitle": "Personal data, the GDPR principles, rights and breaches",
        "description": "Understand what personal data is, the GDPR principles and lawful bases, data subject rights "
        "and what to do the moment you suspect a breach, including Australian Privacy Act obligations.",
        "category": "Compliance",
        "difficulty": "beginner",
        "duration_minutes": 45,
        "learning_objectives": [
            "Identify personal and special category data",
            "Apply the seven GDPR principles to everyday work",
            "Recognise data subject requests and route them correctly",
            "Report a suspected breach immediately",
        ],
        "target_audience": "All staff who handle customer or employee data.",
        "tags": ["compliance", "privacy", "gdpr"],
        "certificate_enabled": True,
        "pass_threshold": 80,
        "ai_tutor_enabled": True,
    },
    "skills": [("Data Privacy", "Handling personal data lawfully and securely.")],
    "modules": [
        {
            "title": "Privacy Essentials",
            "description": "Principles, rights and breaches.",
            "lessons": [
                {
                    "title": "Personal Data and the GDPR Principles",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "summary": "What personal data is, Article 5 principles and lawful bases.",
                    "content": {"body_markdown": PRIVACY_PRINCIPLES},
                    "skills": ["Data Privacy"],
                },
                {
                    "title": "Data Subject Rights and Breaches",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "summary": "Rights requests, the 72-hour rule and everyday habits.",
                    "content": {"body_markdown": PRIVACY_RIGHTS},
                    "skills": ["Data Privacy"],
                },
                {"kind": "quiz", "title": "Privacy Knowledge Check"},
            ],
        },
    ],
    "bank": ("Data Privacy & GDPR Basics", PRIVACY_BANK),
}

# ============================================================================================ draft / archived

DRAFT_ITIL = {
    "course": {
        "title": "ITIL 4 Foundations Primer",
        "subtitle": "Work in progress: the service value system for service desk staff",
        "description": "A short primer on ITIL 4 concepts for service desk staff: the service value system, the four "
        "dimensions and the practices you meet every day. (Draft: modules 2 and 3 to follow.)",
        "category": "IT Support",
        "difficulty": "beginner",
        "duration_minutes": 90,
        "tags": ["itil", "itsm", "draft"],
    },
    "modules": [
        {
            "title": "The Service Value System",
            "description": "Guiding principles and the value chain.",
            "lessons": [
                {
                    "title": "The Seven Guiding Principles",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "content": {
                        "body_markdown": md(
                            """
                  ITIL 4 defines seven guiding principles that apply to every decision:

                  1. Focus on value
                  2. Start where you are
                  3. Progress iteratively with feedback
                  4. Collaborate and promote visibility
                  5. Think and work holistically
                  6. Keep it simple and practical
                  7. Optimise and automate

                  *Draft note (Priya): add a service desk example for each principle.*
                  """
                        )
                    },
                },
                {
                    "title": "The Service Value Chain",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "content": {
                        "body_markdown": md(
                            """
                  The value chain has six activities: **plan**, **improve**, **engage**, **design and transition**,
                  **obtain/build** and **deliver and support**. The service desk lives mostly in *engage* and
                  *deliver and support*.

                  *Draft note: diagram to come.*
                  """
                        )
                    },
                },
            ],
        },
    ],
}

ARCHIVED_WIN7 = {
    "course": {
        "title": "Legacy Windows 7 Desktop Support",
        "subtitle": "Retired: Windows 7 reached end of support in January 2020",
        "description": "Archived course retained for audit purposes. Windows 7 extended support ended on 14 January "
        "2020; see IT Support Troubleshooting Fundamentals for current material.",
        "category": "IT Support",
        "difficulty": "beginner",
        "duration_minutes": 30,
        "tags": ["legacy", "windows-7", "archived"],
        "certificate_enabled": False,
    },
    "modules": [
        {
            "title": "Windows 7 Support Basics",
            "description": "Historical reference only.",
            "lessons": [
                {
                    "title": "Windows 7 End of Support",
                    "lesson_type": "text",
                    "duration_minutes": 10,
                    "content": {
                        "body_markdown": "Windows 7 extended support ended on **14 January 2020**. Devices still running "
                        "it no longer receive security updates and must not connect to the corporate network."
                    },
                },
            ],
        },
    ],
}

# ============================================================================================ second org / solo

CONTOSO_ONBOARDING = {
    "course": {
        "title": "Effective Customer Onboarding",
        "subtitle": "Turning new clients into successful, long-term customers",
        "description": "How Contoso's training consultants run kickoff meetings, set success criteria and check in "
        "during a client's first 90 days.",
        "category": "Customer Success",
        "difficulty": "beginner",
        "duration_minutes": 45,
        "tags": ["onboarding", "customer-success"],
        "certificate_enabled": True,
        "pass_threshold": 70,
    },
    "skills": [("Client Onboarding", "Running kickoffs and early-life success plans.")],
    "modules": [
        {
            "title": "The First 90 Days",
            "description": "Kickoff, success plans and check-ins.",
            "lessons": [
                {
                    "title": "Running a Great Kickoff",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "content": {
                        "body_markdown": md(
                            """
                  A kickoff meeting should leave the client clear on **who** they'll work with, **what** success looks
                  like and **when** the milestones are. Agree two or three measurable success criteria (for example
                  "80% of managers complete leadership module 1 within 30 days") and write them into a shared
                  success plan.
                  """
                        )
                    },
                    "skills": ["Client Onboarding"],
                },
                {
                    "title": "Check-ins That Prevent Churn",
                    "lesson_type": "text",
                    "duration_minutes": 15,
                    "content": {
                        "body_markdown": md(
                            """
                  Schedule check-ins at 14, 30, 60 and 90 days. Review progress against the success criteria, surface
                  blockers early and celebrate wins with the client's sponsor. Most churn risk is visible by day 30 if
                  you measure usage.
                  """
                        )
                    },
                    "skills": ["Client Onboarding"],
                },
                {"kind": "quiz", "title": "Onboarding Check"},
            ],
        },
    ],
    "bank": (
        "Customer Onboarding",
        [
            mc(
                "When should success criteria be agreed with a new client?",
                [
                    "At the kickoff meeting",
                    "At the 90-day review",
                    "Only if the client asks",
                    "After renewal",
                ],
                0,
                "Agreeing criteria at kickoff gives every later check-in something to measure against.",
                skills=["Client Onboarding"],
            ),
            tf(
                "Most churn risk is visible by day 30 if you measure usage.",
                True,
                "Early usage data is the strongest predictor.",
                skills=["Client Onboarding"],
            ),
            ms(
                "Which belong in a success plan? Select all that apply.",
                [
                    "Measurable success criteria",
                    "Milestone dates",
                    "Named contacts on both sides",
                    "The client's bank details",
                ],
                {0, 1, 2},
                "Keep commercial details out of the shared success plan.",
                skills=["Client Onboarding"],
            ),
            sa(
                "At how many days is the final check-in in the first-90-days plan?",
                ["90", "90 days", "day 90"],
                "Check-ins at 14, 30, 60 and 90 days.",
                regex=r"(?i).*\b90\b.*",
                wrong="120",
                skills=["Client Onboarding"],
            ),
        ],
    ),
}

SOLO_COURSE = {
    "course": {
        "title": "My Networking Basics Refresher",
        "subtitle": "Personal study notes",
        "description": "A personal refresher on subnetting and ports before a job interview.",
        "category": "Personal Study",
        "difficulty": "beginner",
        "duration_minutes": 40,
        "tags": ["personal", "networking"],
        "certificate_enabled": False,
    },
    "modules": [
        {
            "title": "Refresher",
            "description": "Subnets and common ports.",
            "lessons": [
                {
                    "title": "Subnetting in Five Minutes",
                    "lesson_type": "text",
                    "duration_minutes": 10,
                    "content": {
                        "body_markdown": md(
                            """
                  A /24 has 256 addresses (254 usable hosts). Each extra prefix bit halves the block: /25 = 128, /26 = 64,
                  /27 = 32, /28 = 16. Usable hosts = block size − 2 (network and broadcast).
                  """
                        )
                    },
                },
                {
                    "title": "Ports Worth Memorising",
                    "lesson_type": "flashcards",
                    "duration_minutes": 10,
                    "content": {
                        "cards": [
                            {"front": "22", "back": "SSH"},
                            {"front": "53", "back": "DNS"},
                            {"front": "67/68", "back": "DHCP"},
                            {"front": "80 / 443", "back": "HTTP / HTTPS"},
                            {"front": "389 / 636", "back": "LDAP / LDAPS"},
                            {"front": "3389", "back": "RDP"},
                            {"front": "445", "back": "SMB"},
                        ]
                    },
                },
            ],
        },
    ],
}
