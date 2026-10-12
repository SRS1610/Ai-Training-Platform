"use client";

import { PageHeader } from "@praxis/ui";
import { ShieldCheck } from "lucide-react";
import { RolesMatrix } from "@/components/admin/roles-matrix";
import { PageGate } from "@/components/admin/ui";

export default function RolesPage() {
  return (
    <PageGate permission="roles.manage">
      <PageHeader
        icon={<ShieldCheck />}
        eyebrow="Manage"
        title="Roles & permissions"
        description="Seven system roles cover most organisations. Create custom roles when you need finer control."
      />
      <RolesMatrix />
    </PageGate>
  );
}
