"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { AccessGate } from "@/components/grading/access-gate";
import { SimulationBuilder } from "@/components/sim-builder/builder";

export default function SimulationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccessGate anyOf={["simulations.manage"]} area="the simulation builder">
      <Suspense fallback={<Skeleton className="h-[640px] rounded-3xl" />}>
        <SimulationBuilder id={id} />
      </Suspense>
    </AccessGate>
  );
}
