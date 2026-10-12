"""Permission catalogue and default (system) role templates."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionDef:
    code: str
    description: str
    category: str


PERMISSIONS: list[PermissionDef] = [
    PermissionDef("users.view", "View users in the organisation", "users"),
    PermissionDef("users.create", "Invite / create users", "users"),
    PermissionDef("users.edit", "Edit users, departments and teams", "users"),
    PermissionDef("users.delete", "Remove / deactivate users", "users"),
    PermissionDef("roles.manage", "Create custom roles and assign roles", "users"),
    PermissionDef("courses.view", "View courses (including drafts when combined with edit)", "content"),
    PermissionDef("courses.create", "Create courses", "content"),
    PermissionDef("courses.edit", "Edit courses and course structure", "content"),
    PermissionDef("courses.publish", "Publish course versions", "content"),
    PermissionDef("courses.delete", "Delete / archive courses", "content"),
    PermissionDef("lessons.manage", "Create and edit lessons and activities", "content"),
    PermissionDef("assignments.manage", "Create and edit practical assignments and rubrics", "content"),
    PermissionDef("simulations.manage", "Create and edit simulations", "content"),
    PermissionDef("assessments.manage", "Create and edit assessments and question banks", "content"),
    PermissionDef("enrolments.manage", "Assign training and manage enrolments / learning paths", "learning"),
    PermissionDef("submissions.review", "Review and grade submissions; override AI grades", "assessment"),
    PermissionDef("certificates.issue", "Issue and revoke certificates", "assessment"),
    PermissionDef("analytics.view", "View organisation analytics", "insight"),
    PermissionDef("reports.export", "Generate and export reports", "insight"),
    PermissionDef("organisation.manage", "Manage organisation settings, branding, SSO", "organisation"),
    PermissionDef("billing.manage", "Manage subscription and billing", "organisation"),
    PermissionDef("ai.manage", "Configure AI providers, models, limits and budgets", "ai"),
    PermissionDef("knowledge.manage", "Manage the knowledge base used by AI", "ai"),
    PermissionDef("audit.view", "View audit logs", "governance"),
    PermissionDef("api_keys.manage", "Manage API keys and integrations", "organisation"),
    PermissionDef("learning.access", "Access learner features (enrol, learn, submit, AI tutor)", "learning"),
    PermissionDef("system.manage", "Platform administration (super admin only)", "system"),
]

ALL_CODES = {p.code for p in PERMISSIONS}
ORG_CODES = ALL_CODES - {"system.manage"}

DEFAULT_ROLES: dict[str, dict] = {
    "org_admin": {
        "name": "Organisation Admin",
        "description": "Manages the organisation, users, courses, reporting and billing.",
        "permissions": sorted(ORG_CODES),
    },
    "training_manager": {
        "name": "Training Manager",
        "description": "Creates training programs, assigns courses and tracks employees.",
        "permissions": [
            "users.view",
            "users.create",
            "users.edit",
            "courses.view",
            "enrolments.manage",
            "certificates.issue",
            "analytics.view",
            "reports.export",
            "learning.access",
        ],
    },
    "instructor": {
        "name": "Instructor",
        "description": "Creates courses, lessons, assignments, simulations and assessments.",
        "permissions": [
            "users.view",
            "courses.view",
            "courses.create",
            "courses.edit",
            "courses.publish",
            "lessons.manage",
            "assignments.manage",
            "simulations.manage",
            "assessments.manage",
            "enrolments.manage",
            "submissions.review",
            "analytics.view",
            "reports.export",
            "knowledge.manage",
            "learning.access",
        ],
    },
    "sme": {
        "name": "Subject Matter Expert",
        "description": "Creates and reviews training content and assessment rubrics.",
        "permissions": [
            "courses.view",
            "courses.edit",
            "lessons.manage",
            "assignments.manage",
            "simulations.manage",
            "assessments.manage",
            "knowledge.manage",
            "learning.access",
        ],
    },
    "assessor": {
        "name": "Assessor",
        "description": "Reviews practical assignments and overrides AI grades when required.",
        "permissions": [
            "users.view",
            "courses.view",
            "submissions.review",
            "analytics.view",
            "learning.access",
        ],
    },
    "auditor": {
        "name": "Auditor",
        "description": "Read-only access to training records, assessment evidence and audit trails.",
        "permissions": ["users.view", "courses.view", "analytics.view", "reports.export", "audit.view"],
    },
    "learner": {
        "name": "Learner",
        "description": "Consumes training, interacts with AI, completes assignments and simulations.",
        "permissions": ["courses.view", "learning.access"],
    },
}
