import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service · Praxis",
  description: "The terms that apply when you or your organisation use Praxis.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "accounts",
    title: "Your account",
    body: (
      <>
        <p>You need an account to use Praxis. Keep your password private, turn on two-factor authentication where your organisation asks for it, and tell your administrator straight away if you think someone else has used your account.</p>
        <p>If you join through an organisation, that organisation controls your membership, roles and the training assigned to you.</p>
      </>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <ul>
        <li>Use Praxis for learning, teaching, assessment and workforce development.</li>
        <li>Don&apos;t share assessment content, try to get around proctoring or integrity checks, or submit work that isn&apos;t yours.</li>
        <li>Don&apos;t upload unlawful material, malware, or personal data you have no right to share.</li>
        <li>Don&apos;t probe, overload or reverse-engineer the service, or access data that belongs to another organisation.</li>
      </ul>
    ),
  },
  {
    id: "content",
    title: "Content you create",
    body: (
      <p>Courses, questions, assignments, simulations, submissions and other material you add stay yours, or your organisation&apos;s. You allow Praxis to store, process and display that content only so that the service works for you and the people you share it with.</p>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    body: (
      <>
        <p>The AI tutor, course builder and grading recommendations can be wrong. Generated content is saved as a draft for a person to review before learners see it. AI grading is only a recommendation until an assessor confirms or overrides it.</p>
        <p>Simulation scores come from a deterministic scoring engine, not from AI judgement. Your organisation can switch AI features off or limit their use.</p>
      </>
    ),
  },
  {
    id: "certificates",
    title: "Certificates",
    body: (
      <p>Certificates show completion of the stated training on the stated date. Anyone can check one at its public verification link. Your organisation may revoke a certificate issued in error or obtained through misconduct, and the verification page then shows it as revoked.</p>
    ),
  },
  {
    id: "plans",
    title: "Plans and billing",
    body: (
      <p>Paid plans renew each billing period until cancelled. Cancelling takes effect at the end of the current period, and you can resume before then. Seat-based plans are billed for the seats purchased. Enterprise plans follow the order form agreed with your organisation.</p>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <p>We may suspend access that breaks these terms or puts other customers at risk. You can leave at any time. Organisations can export their data before closing an account, and records are then deleted according to the retention settings in place.</p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        If these terms change in a meaningful way, we&apos;ll tell you in the app and ask you to accept the new version. See also the <Link href="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      icon={ScrollText}
      eyebrow="Legal"
      title="Terms of Service"
      intro="The terms that apply when you, or the organisation that invited you, use Praxis to learn, teach, assess and simulate real work."
      version="2026-01"
      sections={SECTIONS}
      related={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
