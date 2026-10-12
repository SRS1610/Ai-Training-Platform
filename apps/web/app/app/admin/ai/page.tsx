"use client";

import { PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { BarChart3, SlidersHorizontal, Sparkles } from "lucide-react";
import { Suspense } from "react";
import { AIConfigForm } from "@/components/admin/ai-config";
import { AIUsageDashboard } from "@/components/admin/ai-usage";
import { PageGate, useUrlState } from "@/components/admin/ui";

function AIPage() {
  const [tab, setTab] = useUrlState("tab", "usage");
  return (
    <>
      <PageHeader
        icon={<Sparkles />}
        eyebrow="Manage"
        title="AI settings"
        description="Choose providers and models, tune the tutor, and keep AI spend on budget."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="usage">
            <BarChart3 aria-hidden /> Usage & budget
          </TabsTrigger>
          <TabsTrigger value="config">
            <SlidersHorizontal aria-hidden /> Configuration
          </TabsTrigger>
        </TabsList>
        <TabsContent value="usage">
          <AIUsageDashboard />
        </TabsContent>
        <TabsContent value="config">
          <AIConfigForm />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="ai.manage">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <AIPage />
      </Suspense>
    </PageGate>
  );
}
