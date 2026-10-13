import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy · Praxis",
  description: "What Praxis collects, why, and the controls you have over your data.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li><strong>Account details:</strong> name, email, organisation, roles, department and sign-in security settings.</li>
        <li><strong>Learning records:</strong> enrolments, progress, quiz answers, assignment submissions, simulation actions and results, certificates and skill levels.</li>
        <li><strong>AI conversations:</strong> questions you ask the AI tutor and the answers it gives.</li>
        <li><strong>Technical data:</strong> sign-in sessions, IP address and device information, used for security and for the audit log.</li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How it's used",
    body: (
      <p>We use your data to run your training, show progress to you and to the people your organisation authorises (instructors, assessors, managers), issue and verify certificates, secure accounts, and support the service. We don&apos;t sell personal data.</p>
    ),
  },
  {
    id: "ai",
    title: "AI processing",
    body: (
      <p>When AI features are on, the relevant content (for example your question and the course material it relates to) is sent to the AI provider your organisation has configured, only to produce the answer, draft or recommendation. Your organisation controls which providers are used and can switch AI features off.</p>
    ),
  },
  {
    id: "controls",
    title: "Your controls",
    body: (
      <>
        <p>
          Under <Link href="/app/profile/privacy">Profile → Privacy &amp; data</Link> you can review and change optional consents (product analytics, marketing, AI processing), download a copy of your data, and request deletion.
        </p>
        <p>Leaderboards are opt-out, and integrity signals from assessments are shown to assessors only as supplementary information, never as an automatic verdict.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who can see your data",
    body: (
      <p>Data is kept separate per organisation. Within your organisation, access follows the roles your administrators assign, and access to sensitive areas is recorded in a tamper-evident audit log. Anyone with a certificate&apos;s verification link can see that certificate&apos;s holder name, course, date and status.</p>
    ),
  },
  {
    id: "retention",
    title: "Retention",
    body: (
      <p>Each organisation sets how long learning records and logs are kept. When the retention period ends, or your organisation closes its account, records are deleted or anonymised. Data exports you request stay available to download for 7 days.</p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>Connections are encrypted in transit. Passwords are hashed, two-factor authentication and single sign-on are supported, and API keys are scoped, can expire and can be revoked at any time.</p>
    ),
  },
  {
    id: "contact",
    title: "Questions",
    body: (
      <p>
        Your organisation&apos;s administrator is your first point of contact for questions about your data. See also the <Link href="/terms">Terms of Service</Link>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      icon={ShieldCheck}
      eyebrow="Legal"
      title="Privacy Policy"
      intro="What Praxis collects, why we collect it, and the controls you and your organisation have over it."
      version="2026-01"
      sections={SECTIONS}
      related={{ href: "/terms", label: "Terms of Service" }}
    />
  );
}
