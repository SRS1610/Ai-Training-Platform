"use client";

import { Button, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { MailPlus, UserPlus, UsersRound } from "lucide-react";
import { Suspense, useState } from "react";
import { CreateUserDialog } from "@/components/admin/users/create-user-dialog";
import { InvitationsTab } from "@/components/admin/users/invitations-tab";
import { InviteDialog } from "@/components/admin/users/invite-dialog";
import { MembersTab, MemberStats } from "@/components/admin/users/members-tab";
import { PageGate, useUrlState } from "@/components/admin/ui";
import { Can, useAuth } from "@/lib/auth";

function UsersPage() {
  const { can } = useAuth();
  const [tab, setTab] = useUrlState("tab", "members");
  const [invite, setInvite] = useState(false);
  const [create, setCreate] = useState(false);

  return (
    <>
      <PageHeader
        icon={<UsersRound />}
        eyebrow="Manage"
        title="People"
        description="Everyone in your organisation — their roles, departments and access."
        actions={
          <Can permission="users.create">
            <Button variant="secondary" leftIcon={<UserPlus />} onClick={() => setCreate(true)}>
              Create member
            </Button>
            <Button variant="gradient" leftIcon={<MailPlus />} onClick={() => setInvite(true)}>
              Invite people
            </Button>
          </Can>
        }
      />
      <div className="space-y-6">
        <MemberStats />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="underline">
            <TabsTrigger value="members">Members</TabsTrigger>
            {can("users.create") && <TabsTrigger value="invitations">Invitations</TabsTrigger>}
          </TabsList>
          <TabsContent value="members">
            <MembersTab onInvite={() => setInvite(true)} />
          </TabsContent>
          {can("users.create") && (
            <TabsContent value="invitations">
              <InvitationsTab onInvite={() => setInvite(true)} />
            </TabsContent>
          )}
        </Tabs>
      </div>
      <InviteDialog open={invite} onOpenChange={setInvite} />
      <CreateUserDialog open={create} onOpenChange={setCreate} />
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="users.view">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <UsersPage />
      </Suspense>
    </PageGate>
  );
}
