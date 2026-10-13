"use client";

import { PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { BarChart3, Building2, HeartPulse, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { PageGate, useUrlState } from "@/components/admin/ui";
import { SystemHealth } from "@/components/platform/health";
import { PlatformOverview } from "@/components/platform/overview";
import { OrganisationsTable, PlatformUsersTable } from "@/components/platform/tables";

function PlatformPage() {
  const [tab, setTab] = useUrlState("tab", "overview");
  return (
    <>
      <PageHeader
        icon={<Building2 />}
        eyebrow="Super admin"
        title="Platform admin"
        description="Every tenant, user, subscription and service — in one place."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Platform sections">
          <TabsTrigger value="overview">
            <BarChart3 aria-hidden /> Overview
          </TabsTrigger>
          <TabsTrigger value="organisations">
            <Building2 aria-hidden /> Organisations
          </TabsTrigger>
          <TabsTrigger value="users">
            <UsersRound aria-hidden /> Users
          </TabsTrigger>
          <TabsTrigger value="health">
            <HeartPulse aria-hidden /> System health
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <PlatformOverview />
        </TabsContent>
        <TabsContent value="organisations">
          <OrganisationsTable />
        </TabsContent>
        <TabsContent value="users">
          <PlatformUsersTable />
        </TabsContent>
        <TabsContent value="health">
          <SystemHealth />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function Page() {
  return (
    <PageGate superadmin>
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" aria-label="Loading" />}>
        <PlatformPage />
      </Suspense>
    </PageGate>
  );
}

