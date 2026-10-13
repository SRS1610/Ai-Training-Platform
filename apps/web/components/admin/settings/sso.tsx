"use client";

/** SSO connections (OIDC / SAML): CRUD, domains with DNS verification, enforcement, default role and test. */

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  RadioCard,
  RadioGroup,
  SimpleSelect,
  Skeleton,
  Switch,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FlaskConical, Globe2, Hourglass, KeyRound, Lock, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { ak } from "../keys";
import { useRoles } from "../pickers";
import type { SSOOut, SSOTestResult } from "../types";
import { CopyButton, RoleChip, UpgradeNotice, isPlanLimit, toastError } from "../ui";

function ConnectionCard({ c, onEdit, onDelete, onChanged }: { c: SSOOut; onEdit: () => void; onDelete: () => void; onChanged: (c: SSOOut) => void }) {
  const [test, setTest] = React.useState<SSOTestResult | null>(null);
  const verify = useMutation({
    mutationFn: () => api.post<SSOOut>(`/sso/connections/${c.id}/verify-domains`),
    onSuccess: (r) => {
      onChanged(r);
      const pending = r.domains.filter((d) => !d.verified).length;
      if (pending) toast.error(`${pending} domain${pending === 1 ? "" : "s"} still unverified — check the TXT records`);
      else toast.success("All domains verified");
    },
    onError: (e) => toastError(e),
  });
  const testM = useMutation({
    mutationFn: () => api.post<SSOTestResult>(`/sso/connections/${c.id}/test`),
    onSuccess: setTest,
    onError: (e) => toastError(e),
  });
  const toggle = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<SSOOut>(`/sso/connections/${c.id}`, patch),
    onSuccess: (r) => {
      onChanged(r);
      toast.success("Connection updated");
    },
    onError: (e) => toastError(e),
  });
  const pending = c.domains.filter((d) => !d.verified);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm", c.protocol === "oidc" ? "from-indigo-500 to-violet-500" : "from-teal-400 to-cyan-500")}>
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">{c.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={c.protocol === "oidc" ? "brand" : "info"} size="sm" className="uppercase">
                {c.protocol}
              </Badge>
              <Badge tone={c.enabled ? "success" : "neutral"} size="sm" dot>
                {c.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {c.enforce_sso && (
                <Badge tone="violet" size="sm">
                  <Lock aria-hidden /> Enforced
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">New users join as</span>
              <RoleChip roleKey={c.default_role_key} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" leftIcon={<FlaskConical />} loading={testM.isPending} onClick={() => testM.mutate()}>
            Test
          </Button>
          <Button size="sm" variant="secondary" leftIcon={<Pencil />} onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" leftIcon={<Trash2 />} onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email domains</p>
          {c.domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains — users choose SSO from the login page.</p>
          ) : (
            <ul className="space-y-2">
              {c.domains.map((d) => (
                <li key={d.domain} className={cn("rounded-xl border p-3", d.verified ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50")}>
                  <div className="flex items-center gap-2">
                    {d.verified ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <Hourglass className="size-4 text-amber-600" aria-hidden />}
                    <span className="font-mono text-sm font-semibold text-slate-900">{d.domain}</span>
                    <Badge tone={d.verified ? "success" : "warning"} size="sm" className="ml-auto">
                      {d.verified ? "Verified" : "Pending"}
                    </Badge>
                  </div>
                  {!d.verified && d.record_name && (
                    <div className="mt-2 space-y-1 text-xs">
                      <p className="text-slate-700">
                        Add a <strong>{d.record_type}</strong> record:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono ring-1 ring-amber-200">{d.record_name}</code>
                        <CopyButton value={d.record_name} size="xs" variant="ghost" label="Name" />
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono ring-1 ring-amber-200">{d.record_value}</code>
                        <CopyButton value={d.record_value ?? ""} size="xs" variant="ghost" label="Value" />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && (
            <Button size="sm" leftIcon={<RefreshCw />} loading={verify.isPending} onClick={() => verify.mutate()}>
              Verify domains
            </Button>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Settings</p>
          <label htmlFor={`sso-${c.id}-enabled`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span>
              <span className="block text-sm font-medium text-slate-900">Enabled</span>
              <span className="block text-xs text-muted-foreground">Allow sign-in through this connection</span>
            </span>
            <Switch id={`sso-${c.id}-enabled`} checked={c.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ enabled: v })} aria-label="Connection enabled" />
          </label>
          <label htmlFor={`sso-${c.id}-enforce`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span>
              <span className="block text-sm font-medium text-slate-900">Enforce SSO</span>
              <span className="block text-xs text-muted-foreground">Verified-domain users must use SSO (no passwords)</span>
            </span>
            <Switch id={`sso-${c.id}-enforce`} checked={c.enforce_sso} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ enforce_sso: v })} aria-label="Enforce SSO" />
          </label>
          {c.callback_url && (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-600">Redirect / callback URL (add this in your IdP)</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900">{c.callback_url}</code>
                <CopyButton value={c.callback_url} size="xs" variant="ghost" />
              </div>
            </div>
          )}
          {c.requires_saml_adapter && (
            <Alert tone="info" title="SAML adapter required">
              SAML sign-in runs through the server&apos;s SAML adapter. Ask your Praxis platform team to enable it for this connection.
            </Alert>
          )}
        </div>
      </div>
      {test && (
        <div className={cn("flex items-start gap-3 border-t p-4", test.ok ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50")} aria-live="polite">
          {test.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-semibold", test.ok ? "text-emerald-900" : "text-rose-900")}>{test.ok ? "Connection test passed" : "Connection test failed"}</p>
            <p className="text-sm text-slate-700">{test.message}</p>
            {Object.keys(test.details ?? {}).length > 0 && (
              <dl className="mt-2 grid gap-1 text-xs">
                {Object.entries(test.details ?? {}).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="font-medium text-slate-600">{k}:</dt>
                    <dd className="min-w-0 truncate font-mono text-slate-800">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <Button size="xs" variant="ghost" onClick={() => setTest(null)}>
            Dismiss
          </Button>
        </div>
      )}
    </article>
  );
}

interface Form {
  protocol: "oidc" | "saml";
  name: string;
  domains: string;
  enforce_sso: boolean;
  default_role_key: string;
  enabled: boolean;
  issuer: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  idp_entity_id: string;
  sso_url: string;
  x509_cert: string;
}

const EMPTY: Form = {
  protocol: "oidc",
  name: "",
  domains: "",
  enforce_sso: false,
  default_role_key: "learner",
  enabled: true,
  issuer: "",
  client_id: "",
  client_secret: "",
  scopes: "openid email profile",
  idp_entity_id: "",
  sso_url: "",
  x509_cert: "",
};

function ConnectionDialog({ state, onClose, onSaved }: { state: SSOOut | "new" | null; onClose: () => void; onSaved: () => void }) {
  const editing = state && state !== "new" ? state : null;
  const roles = useRoles(!!state);
  const [f, setF] = React.useState<Form>(EMPTY);
  React.useEffect(() => {
    if (!state) return;
    if (editing) {
      const cfg = editing.config as Record<string, string | undefined>;
      setF({
        ...EMPTY,
        protocol: editing.protocol as "oidc" | "saml",
        name: editing.name,
        domains: editing.domains.map((d) => d.domain).join(", "),
        enforce_sso: editing.enforce_sso,
        default_role_key: editing.default_role_key,
        enabled: editing.enabled,
        issuer: cfg.issuer ?? "",
        client_id: cfg.client_id ?? "",
        scopes: cfg.scopes ?? "openid email profile",
        idp_entity_id: cfg.idp_entity_id ?? "",
        sso_url: cfg.sso_url ?? "",
        x509_cert: cfg.x509_cert ?? "",
      });
    } else setF(EMPTY);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const hasSecret = !!(editing?.config as Record<string, unknown> | undefined)?.has_client_secret;

  const save = useMutation({
    mutationFn: () => {
      const domains = f.domains
        .split(/[\s,;]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const body: Record<string, unknown> = { name: f.name.trim(), email_domains: domains, enforce_sso: f.enforce_sso, default_role_key: f.default_role_key, enabled: f.enabled };
      if (f.protocol === "oidc") body.oidc = { issuer: f.issuer.trim(), client_id: f.client_id.trim(), client_secret: f.client_secret || null, scopes: f.scopes.trim() || "openid email profile" };
      else body.saml = { idp_entity_id: f.idp_entity_id.trim(), sso_url: f.sso_url.trim(), x509_cert: f.x509_cert.trim() };
      return editing ? api.patch<SSOOut>(`/sso/connections/${editing.id}`, body) : api.post<SSOOut>("/sso/connections", { protocol: f.protocol, ...body });
    },
    onSuccess: () => {
      toast.success(editing ? "Connection updated" : "SSO connection created");
      onSaved();
      onClose();
    },
  });
  const valid = f.name.trim() && (f.protocol === "oidc" ? /^https?:\/\//.test(f.issuer) && f.client_id.trim() && (editing ? true : !!f.client_secret) : f.idp_entity_id.trim() && /^https?:\/\//.test(f.sso_url) && f.x509_cert.trim().length >= 20);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New SSO connection"}</DialogTitle>
          <DialogDescription>Secrets are encrypted at rest and never shown again after saving.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          {!editing && (
            <RadioGroup value={f.protocol} onValueChange={(v) => set("protocol", v as Form["protocol"])} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Protocol">
              <RadioCard value="oidc" title="OpenID Connect" description="Okta, Entra ID, Google, Auth0, Keycloak" icon={<KeyRound />} />
              <RadioCard value="saml" title="SAML 2.0" description="ADFS, PingFederate, legacy IdPs" icon={<ShieldCheck />} />
            </RadioGroup>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Display name" required hint="Shown on the sign-in button">
              <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="e.g. Northwind Okta" />
            </FormField>
            <FormField label="Default role for new users">
              <SimpleSelect value={f.default_role_key} onValueChange={(v) => set("default_role_key", v)} options={(roles.data ?? [{ key: "learner", name: "Learner" }]).map((r) => ({ value: r.key, label: r.name }))} />
            </FormField>
            <FormField label="Email domains" className="sm:col-span-2" hint="Comma-separated. New domains need a DNS TXT record before they're active.">
              <Input value={f.domains} onChange={(e) => set("domains", e.target.value)} placeholder="northwind.com, northwind.co.uk" className="font-mono" leftIcon={<Globe2 />} />
            </FormField>
          </div>
          {f.protocol === "oidc" ? (
            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:grid-cols-2">
              <FormField label="Issuer URL" required className="sm:col-span-2">
                <Input value={f.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" className="font-mono" />
              </FormField>
              <FormField label="Client ID" required>
                <Input value={f.client_id} onChange={(e) => set("client_id", e.target.value)} className="font-mono" autoComplete="off" />
              </FormField>
              <FormField label="Client secret" required={!editing} hint={editing ? (hasSecret ? "A secret is stored — leave blank to keep it" : "No secret stored") : undefined}>
                <Input type="password" value={f.client_secret} onChange={(e) => set("client_secret", e.target.value)} autoComplete="new-password" placeholder={editing && hasSecret ? "••••••••" : ""} />
              </FormField>
              <FormField label="Scopes" className="sm:col-span-2">
                <Input value={f.scopes} onChange={(e) => set("scopes", e.target.value)} className="font-mono" />
              </FormField>
            </div>
          ) : (
            <div className="grid gap-4 rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
              <FormField label="IdP entity ID" required>
                <Input value={f.idp_entity_id} onChange={(e) => set("idp_entity_id", e.target.value)} className="font-mono" />
              </FormField>
              <FormField label="SSO URL" required>
                <Input value={f.sso_url} onChange={(e) => set("sso_url", e.target.value)} placeholder="https://idp.example.com/sso/saml" className="font-mono" />
              </FormField>
              <FormField label="Signing certificate (PEM)" required>
                <Textarea rows={4} value={f.x509_cert} onChange={(e) => set("x509_cert", e.target.value)} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" />
              </FormField>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label htmlFor="sso-form-enabled" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <span className="text-sm font-medium text-slate-900">Enabled</span>
              <Switch id="sso-form-enabled" checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Enabled" />
            </label>
            <label htmlFor="sso-form-enforce" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <span className="text-sm font-medium text-slate-900">Enforce SSO for domains</span>
              <Switch id="sso-form-enforce" checked={f.enforce_sso} onCheckedChange={(v) => set("enforce_sso", v)} aria-label="Enforce SSO" />
            </label>
          </div>
          {save.isError &&
            (isPlanLimit(save.error) ? (
              <UpgradeNotice error={save.error} compact />
            ) : (
              <Alert tone="danger" title="Couldn't save the connection">
                {errorMessage(save.error)}
              </Alert>
            ))}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.isPending} disabled={!valid}>
              {editing ? "Save changes" : "Create connection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SSOSettings() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ak.sso.all, queryFn: ({ signal }) => api.get<SSOOut[]>("/sso/connections", { signal }) });
  const [dialog, setDialog] = React.useState<SSOOut | "new" | null>(null);
  const [del, setDel] = React.useState<SSOOut | null>(null);
  const update = (c: SSOOut) => qc.setQueryData<SSOOut[]>(ak.sso.all, (old) => (old ?? []).map((x) => (x.id === c.id ? c : x)));

  if (list.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  if (list.isError)
    return isPlanLimit(list.error) ? (
      <div className="space-y-6">
        <UpgradeNotice error={list.error} title="Single sign-on is an Enterprise feature" description="Connect Okta, Entra ID, Google Workspace or any SAML/OIDC provider, verify your domains and enforce SSO." />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { t: "One identity", b: "People sign in with the account they already use for work." },
            { t: "Just-in-time access", b: "New starters join with the right default role on first sign-in." },
            { t: "Enforced policy", b: "Turn off passwords for your verified email domains." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
              <ShieldCheck className="size-6 text-violet-600" aria-hidden />
              <p className="mt-3 font-display font-semibold text-slate-900">{x.t}</p>
              <p className="mt-1 text-sm text-slate-600">{x.b}</p>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <ErrorState error={list.error} onRetry={() => list.refetch()} />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Connect your identity provider. Users with a verified domain are routed to SSO automatically.</p>
        <Button leftIcon={<Plus />} onClick={() => setDialog("new")}>
          New connection
        </Button>
      </div>
      {!list.data?.length ? (
        <EmptyState
          bordered
          illustration="shield"
          title="No SSO connections"
          description="Add an OIDC or SAML connection to let people sign in with your identity provider."
          action={
            <Button variant="gradient" leftIcon={<Plus />} onClick={() => setDialog("new")}>
              Add a connection
            </Button>
          }
        />
      ) : (
        list.data.map((c) => <ConnectionCard key={c.id} c={c} onEdit={() => setDialog(c)} onDelete={() => setDel(c)} onChanged={update} />)
      )}
      <ConnectionDialog state={dialog} onClose={() => setDialog(null)} onSaved={() => qc.invalidateQueries({ queryKey: ak.sso.all })} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        destructive
        title={`Delete ${del?.name}?`}
        description={del?.enforce_sso ? "SSO is enforced on this connection. After deleting it, people on its domains will need a password (or password reset) to sign in." : "People will no longer be able to sign in through this connection."}
        confirmText={del?.enforce_sso ? del.name : undefined}
        confirmLabel="Delete connection"
        onConfirm={async () => {
          try {
            await api.delete(`/sso/connections/${del!.id}`);
            toast.success("Connection deleted");
            qc.invalidateQueries({ queryKey: ak.sso.all });
          } catch (e) {
            toastError(e);
          }
        }}
      />
    </div>
  );
}
