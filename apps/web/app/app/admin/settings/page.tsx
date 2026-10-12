"use client";

import { PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { Building2, Globe2, Hourglass, KeyRound, Settings, ShieldCheck, Trophy } from "lucide-react";
import { Suspense } from "react";
import { DomainSettings, RetentionSettings, SecuritySettings } from "@/components/admin/settings/domain-security";
import { GamificationSettings } from "@/components/admin/settings/gamification";
import { OrganisationSettings } from "@/components/admin/settings/org";
import { SSOSettings } from "@/components/admin/settings/sso";
import { PageGate, useUrlState } from "@/components/admin/ui";

const TABS = [
  { value: "organisation", label: "Organisation", icon: Building2 },
  { value: "domain", label: "Custom domain", icon: Globe2 },
  { value: "security", label: "Security", icon: ShieldCheck },
  { value: "sso", label: "SSO", icon: KeyRound },
  { value: "gamification", label: "Gamification", icon: Trophy },
  { value: "retention", label: "Data retention", icon: Hourglass },
];

function SettingsPage() {
  const [tab, setTab] = useUrlState("tab", "organisation");
  return (
    <>
      <PageHeader icon={<Settings />} eyebrow="Manage" title="Organisation settings" description="Branding, domain, security, single sign-on, gamification and data retention." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="underline" aria-label="Settings sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon aria-hidden /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="organisation">
          <OrganisationSettings />
        </TabsContent>
        <TabsContent value="domain">
          <DomainSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="sso">
          <SSOSettings />
        </TabsContent>
        <TabsContent value="gamification">
          <GamificationSettings />
        </TabsContent>
        <TabsContent value="retention">
          <RetentionSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="organisation.manage">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <SettingsPage />
      </Suspense>
    </PageGate>
  );
}
