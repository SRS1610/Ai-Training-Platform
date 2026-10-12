"use client";

import { PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { Building2, Network, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { DepartmentsPanel, TeamsPanel } from "@/components/admin/structure";
import { PageGate, useUrlState } from "@/components/admin/ui";

function StructurePage() {
  const [tab, setTab] = useUrlState("tab", "departments");
  return (
    <>
      <PageHeader
        icon={<Network />}
        eyebrow="Manage"
        title="Departments & teams"
        description="Mirror your organisation chart. Departments and teams drive assignments, reporting and manager views."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="departments">
            <Building2 aria-hidden /> Departments
          </TabsTrigger>
          <TabsTrigger value="teams">
            <UsersRound aria-hidden /> Teams
          </TabsTrigger>
        </TabsList>
        <TabsContent value="departments">
          <DepartmentsPanel />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="users.edit">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <StructurePage />
      </Suspense>
    </PageGate>
  );
}
