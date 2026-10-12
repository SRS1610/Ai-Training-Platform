"use client";

import { use } from "react";
import { SimulationBriefing } from "@/components/simulation/briefing";

export default function SimulationBriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SimulationBriefing id={id} />;
}
