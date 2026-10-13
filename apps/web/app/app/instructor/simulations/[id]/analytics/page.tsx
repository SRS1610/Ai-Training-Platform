"use client";

import { useParams } from "next/navigation";
import { SimulationAnalyticsView } from "@/components/analytics/sim-analytics";
import { AccessGate } from "@/components/grading/access-gate";

export default function SimulationAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccessGate anyOf={["simulations.manage", "analytics.view"]} area="simulation analytics">
      <SimulationAnalyticsView id={id} />
    </AccessGate>
  );
}
