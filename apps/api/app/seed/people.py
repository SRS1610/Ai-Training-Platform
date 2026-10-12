"""Demo organisations and people."""

from __future__ import annotations

PASSWORD = "Praxis-Demo-2026!"

SUPERADMIN = {"email": "superadmin@praxis.demo", "full_name": "Morgan Hayes"}

NORTHWIND = {
    "name": "Northwind Technologies",
    "plan": "enterprise",
    "seats": 60,
    "branding": {
        "primary_color": "#4f46e5",
        "secondary_color": "#0ea5e9",
        "accent_color": "#f59e0b",
        "certificate_text": "Northwind Technologies certifies that the learner has met every requirement of this course.",
        "login_message": "Welcome to the Northwind Academy. Sign in with your Northwind account.",
    },
    "settings": {"gamification_enabled": True, "default_locale": "en-AU"},
}

DEPARTMENTS = [
    ("IT Service Desk", "First-line support for all Northwind staff, 07:00–19:00 AEST."),
    ("Infrastructure", "Network, server, storage and cloud platforms."),
    ("Cyber Security", "Security operations centre, identity security and governance."),
    ("Customer Success", "Onboarding and support for Northwind's customers."),
    ("Finance", "Financial planning, accounts and payroll."),
]

TEAMS = [
    ("Service Desk – Tier 1", "IT Service Desk", "First-contact resolution and triage."),
    ("Service Desk – Tier 2", "IT Service Desk", "Desktop engineering and escalations."),
    ("Network Operations", "Infrastructure", "LAN, WAN, Wi-Fi and DNS/DHCP."),
    ("SOC Analysts", "Cyber Security", "24×7 monitoring and incident response."),
    ("Customer Onboarding", "Customer Success", "New customer implementations."),
]

# key → (email, full name, roles, department, job title)
STAFF = {
    "admin": (
        "admin@northwind.demo",
        "Olivia Bennett",
        ["org_admin"],
        None,
        "Head of Learning & Development",
    ),
    "manager": (
        "manager@northwind.demo",
        "Marcus Lee",
        ["training_manager"],
        "IT Service Desk",
        "Service Desk Training Manager",
    ),
    "instructor": (
        "instructor@northwind.demo",
        "Dr. Priya Raman",
        ["instructor"],
        "IT Service Desk",
        "Senior Technical Instructor",
    ),
    "sme": ("sme@northwind.demo", "Tom Fischer", ["sme"], "Infrastructure", "Principal Network Engineer"),
    "assessor": (
        "assessor@northwind.demo",
        "Grace Okafor",
        ["assessor"],
        "IT Service Desk",
        "Service Desk Team Leader",
    ),
    "auditor": ("auditor@northwind.demo", "Daniel Novak", ["auditor"], "Finance", "Internal Audit Lead"),
}

ALEX = (
    "learner@northwind.demo",
    "Alex Chen",
    "IT Service Desk",
    "Service Desk Analyst",
    "Service Desk – Tier 1",
)

# Learners: (slug, full name, department, job title, team, profile)
# profile drives their story in the flagship course (see flows.py):
#   cert_v1 / cert_v2  completed with certificate (enrolled before/after version 2)
#   retake             failed the final assessment once, then passed
#   progress_v1 / progress_v2  part-way through
#   overdue            assigned with a past due date, little progress
#   not_started        assigned, nothing done yet
#   none               not enrolled in the flagship
LEARNERS = [
    (
        "sofia.martinez",
        "Sofia Martinez",
        "IT Service Desk",
        "Service Desk Analyst",
        "Service Desk – Tier 1",
        "cert_v1",
    ),
    (
        "liam.oconnor",
        "Liam O'Connor",
        "IT Service Desk",
        "Service Desk Analyst",
        "Service Desk – Tier 1",
        "cert_v1",
    ),
    (
        "aisha.rahman",
        "Aisha Rahman",
        "IT Service Desk",
        "Senior Service Desk Analyst",
        "Service Desk – Tier 2",
        "progress_v1",
    ),
    (
        "ethan.walker",
        "Ethan Walker",
        "IT Service Desk",
        "Service Desk Analyst",
        "Service Desk – Tier 1",
        "progress_v2",
    ),
    (
        "meilin.zhang",
        "Mei Lin Zhang",
        "IT Service Desk",
        "Graduate IT Analyst",
        "Service Desk – Tier 1",
        "not_started",
    ),
    (
        "noah.kowalski",
        "Noah Kowalski",
        "IT Service Desk",
        "Service Desk Analyst",
        "Service Desk – Tier 1",
        "overdue",
    ),
    (
        "hannah.schmidt",
        "Hannah Schmidt",
        "IT Service Desk",
        "Desktop Support Engineer",
        "Service Desk – Tier 2",
        "retake",
    ),
    ("rajesh.iyer", "Rajesh Iyer", "Infrastructure", "Network Engineer", "Network Operations", "cert_v1"),
    (
        "chloe.dubois",
        "Chloé Dubois",
        "Infrastructure",
        "Systems Administrator",
        "Network Operations",
        "cert_v2",
    ),
    ("kwame.mensah", "Kwame Mensah", "Infrastructure", "Cloud Engineer", "Network Operations", "progress_v2"),
    (
        "isabella.rossi",
        "Isabella Rossi",
        "Infrastructure",
        "Junior Network Technician",
        "Network Operations",
        "overdue",
    ),
    (
        "tomas.garcia",
        "Tomás García",
        "Infrastructure",
        "Infrastructure Graduate",
        "Network Operations",
        "not_started",
    ),
    ("yusuf.demir", "Yusuf Demir", "Cyber Security", "SOC Analyst", "SOC Analysts", "cert_v2"),
    ("emma.johansson", "Emma Johansson", "Cyber Security", "SOC Analyst", "SOC Analysts", "progress_v2"),
    ("lucas.silva", "Lucas Silva", "Cyber Security", "Security Engineer", "SOC Analysts", "none"),
    ("zara.ahmed", "Zara Ahmed", "Cyber Security", "Graduate SOC Analyst", "SOC Analysts", "progress_v2"),
    (
        "olu.adeyemi",
        "Olúwaseun Adeyemi",
        "Customer Success",
        "Customer Success Manager",
        "Customer Onboarding",
        "none",
    ),
    (
        "mia.thompson",
        "Mia Thompson",
        "Customer Success",
        "Implementation Consultant",
        "Customer Onboarding",
        "none",
    ),
    (
        "jack.robinson",
        "Jack Robinson",
        "Customer Success",
        "Customer Support Specialist",
        "Customer Onboarding",
        "progress_v2",
    ),
    (
        "fatima.alsayed",
        "Fatima Al-Sayed",
        "Customer Success",
        "Customer Success Manager",
        "Customer Onboarding",
        "none",
    ),
    (
        "ben.carter",
        "Ben Carter",
        "Customer Success",
        "Customer Support Specialist",
        "Customer Onboarding",
        "none",
    ),
    ("sarah.kim", "Sarah Kim", "Finance", "Financial Analyst", None, "none"),
    ("david.nguyen", "David Nguyen", "Finance", "Payroll Officer", None, "none"),
    ("elena.petrova", "Elena Petrova", "Finance", "Accounts Payable Officer", None, "none"),
]

MINIMAL_LEARNERS = {"sofia.martinez", "noah.kowalski", "hannah.schmidt", "ethan.walker"}

CONTOSO = {
    "name": "Contoso Training Co",
    "plan": "business",
    "seats": 5,
    "branding": {"primary_color": "#0f766e"},
    "admin": ("admin@contoso.demo", "Rebecca Shaw", "Managing Director"),
    "trainer": ("trainer@contoso.demo", "Samuel Osei", "Lead Training Consultant"),
    "learner": ("learner@contoso.demo", "Jordan Ellis", "Training Consultant"),
}

SOLO = ("solo@praxis.demo", "Riley Morgan")
