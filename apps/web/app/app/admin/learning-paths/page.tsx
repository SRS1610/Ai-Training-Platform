"use client";

import { Button, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { BookOpenCheck, Route } from "lucide-react";
import { Suspense, useState } from "react";
import { AssignTrainingDialog } from "@/components/admin/assign-training-dialog";
import { AssignTrainingPanel, PathsList } from "@/components/admin/learning-paths";
import { PageGate, useUrlState } from "@/components/admin/ui";

function LearningPathsPage() {
  const [tab, setTab] = useUrlState("tab", "paths");
  const [assign, setAssign] = useState(false);
  return (
    <>
      <PageHeader
        icon={<Route />}
        eyebrow="Manage"
        title="Learning paths & assignments"
        description="Sequence courses into programs and assign training to people, departments or teams."
        actions={
          <Button variant="gradient" leftIcon={<BookOpenCheck />} onClick={() => setAssign(true)}>
            Assign training
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="paths">
            <Route aria-hidden /> Learning paths
          </TabsTrigger>
          <TabsTrigger value="assign">
            <BookOpenCheck aria-hidden /> Assign courses
          </TabsTrigger>
        </TabsList>
        <TabsContent value="paths">
          <PathsList />
        </TabsContent>
        <TabsContent value="assign">
          <AssignTrainingPanel />
        </TabsContent>
      </Tabs>
      <AssignTrainingDialog open={assign} onOpenChange={setAssign} />
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="enrolments.manage">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <LearningPathsPage />
      </Suspense>
    </PageGate>
  );
}
