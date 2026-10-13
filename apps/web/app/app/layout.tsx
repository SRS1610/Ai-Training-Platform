import type { Metadata } from "next";
import { MfaRequiredGate, WorkspaceAccessGate } from "@/components/admin/account-access";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Praxis" },
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Access gates: a suspended organisation / paused membership gets a branded dead-end with Sign out and an
  // org switcher (instead of a generic load error); a required-but-missing MFA gets one clear set-up CTA.
  return (
    <WorkspaceAccessGate>
      <AppShell>
        <MfaRequiredGate>{children}</MfaRequiredGate>
      </AppShell>
    </WorkspaceAccessGate>
  );
}
