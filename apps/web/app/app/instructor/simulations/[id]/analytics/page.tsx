"use client";

import { useParams } from "next/navigation";
import { SimulationAnalyticsView } from "@/components/analytics/sim-analytics";

export default function SimulationAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  return <SimulationAnalyticsView id={id} />;
}
