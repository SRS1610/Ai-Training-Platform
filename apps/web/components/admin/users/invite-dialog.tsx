"use client";

/**
 * Invite people: single email, many emails (pasted), or CSV import with a client-side preview that flags
 * problems before upload. Server-side results (invited count + per-row errors) are shown afterwards.
 */

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileDropzone,
  FormField,
  Input,
  SimpleSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Mail, MailPlus, Users } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { ak } from "../keys";
import { DepartmentSelect, RolePicker, useDepartments, useRoles } from "../pickers";
import type { BulkResult, InvitationOut, UsersImportResult } from "../types";
import { UpgradeNotice, isPlanLimit } from "../ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(text: string): { valid: string[]; invalid: string[]; duplicates: number } {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const t of tokens) {
    const e = t.toLowerCase();
    if (!EMAIL_RE.test(e)) invalid.push(t);
    else if (seen.has(e)) duplicates++;
    else {
      seen.add(e);
      valid.push(e);
    }
  }
  return { valid, invalid, duplicates };
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

interface PreviewRow {
  row: number;
  email: string;
  roles: string[];
  department: string;
  error: string | null;
}

function RolesAndDepartment({
  roles,
  setRoles,
  department,
  setDepartment,
}: {
  roles: string[];
  setRoles: (v: string[]) => void;
  department: string | null;
  setDepartment: (v: string | null) => void;
}) {
  const rolesQ = useRoles();
  return (
    <div className="space-y-4">
      <div>
        <p id="invite-roles-label" className="mb-2 text-sm font-medium text-slate-800">
          Roles <span className="text-rose-600">*</span>
        </p>
        {rolesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading roles…</p>
        ) : (
          <RolePicker roles={rolesQ.data ?? []} value={roles} onChange={setRoles} labelledBy="invite-roles-label" />
        )}
      </div>
      <FormField label="Department" hint="Optional — they can be moved later.">
        {(aria) => <DepartmentSelect id={aria.id} value={department} onChange={setDepartment} />}
      </FormField>
    </div>
  );
}

export function InviteDialog({ open, onOpenChange, defaultTab = "single" }: { open: boolean; onOpenChange: (o: boolean) => void; defaultTab?: "single" | "bulk" | "csv" }) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState(defaultTab);
  const [email, setEmail] = React.useState("");
  const [bulk, setBulk] = React.useState("");
  const [roles, setRoles] = React.useState<string[]>(["learner"]);
  const [department, setDepartment] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<PreviewRow[] | null>(null);
  const [csvError, setCsvError] = React.useState<string | null>(null);
  const [defaultRole, setDefaultRole] = React.useState("learner");
  const [bulkResult, setBulkResult] = React.useState<BulkResult | null>(null);
  const [importResult, setImportResult] = React.useState<UsersImportResult | null>(null);
  const rolesQ = useRoles(open);
  const deptQ = useDepartments(open);

  React.useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setEmail("");
      setBulk("");
      setRoles(["learner"]);
      setDepartment(null);
      setFile(null);
      setPreview(null);
      setCsvError(null);
      setBulkResult(null);
      setImportResult(null);
      single.reset();
      many.reset();
      upload.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ak.invitations.all });
    qc.invalidateQueries({ queryKey: ak.members.all });
  };

  const single = useMutation({
    mutationFn: () => api.post<InvitationOut>("/invitations", { email: email.trim(), roles, department_id: department }),
    onSuccess: (inv) => {
      invalidate();
      toast.success(`Invitation sent to ${inv.email}`);
      onOpenChange(false);
    },
  });

  const parsed = React.useMemo(() => parseEmails(bulk), [bulk]);
  const many = useMutation({
    mutationFn: () => api.post<BulkResult>("/invitations/bulk", { emails: parsed.valid, roles, department_id: department }),
    onSuccess: (r) => {
      invalidate();
      setBulkResult(r);
      if (r.invited.length) toast.success(`${r.invited.length} invitation${r.invited.length === 1 ? "" : "s"} sent`);
    },
  });

  const upload = useMutation({
    mutationFn: () => api.upload<UsersImportResult>("/users/import", { file: file!, default_role: defaultRole }),
    onSuccess: (r) => {
      invalidate();
      setImportResult(r);
      if (r.invited) toast.success(`${r.invited} invitation${r.invited === 1 ? "" : "s"} sent from CSV`);
    },
  });

  // Client-side CSV preview + validation (mirrors the server rules).
  React.useEffect(() => {
    if (!file) return;
    let cancelled = false;
    file.text().then((text) => {
      if (cancelled) return;
      const rows = parseCsv(text);
      const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
      if (!header.includes("email")) {
        setCsvError("The first row must be a header with an “email” column (optional: role or roles, department).");
        setPreview(null);
        return;
      }
      if (rows.length - 1 > 1000) {
        setCsvError("CSV has more than 1,000 rows — split it into smaller files.");
        setPreview(null);
        return;
      }
      setCsvError(null);
      const roleKeys = new Set((rolesQ.data ?? []).map((r) => r.key));
      const deptNames = new Set((deptQ.data ?? []).map((d) => d.name.toLowerCase()));
      const idx = (k: string) => header.indexOf(k);
      const seen = new Set<string>();
      setPreview(
        rows.slice(1).map((r, i) => {
          const em = (r[idx("email")] ?? "").trim().toLowerCase();
          const roleField = (idx("roles") >= 0 ? r[idx("roles")] : idx("role") >= 0 ? r[idx("role")] : "") ?? "";
          const rs = roleField.replace(/\|/g, ";").replace(/,/g, ";").split(";").map((x) => x.trim()).filter(Boolean);
          const dep = idx("department") >= 0 ? (r[idx("department")] ?? "").trim() : "";
          let error: string | null = null;
          if (!EMAIL_RE.test(em)) error = "Invalid email address";
          else if (seen.has(em)) error = "Duplicate email in file";
          else if (roleKeys.size && rs.some((k) => !roleKeys.has(k))) error = `Unknown role(s): ${rs.filter((k) => !roleKeys.has(k)).join(", ")}`;
          else if (dep && deptNames.size && !deptNames.has(dep.toLowerCase())) error = `Unknown department: ${dep}`;
          seen.add(em);
          return { row: i + 2, email: em || r[idx("email")] || "", roles: rs, department: dep, error };
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [file, rolesQ.data, deptQ.data]);

  const previewErrors = preview?.filter((p) => p.error).length ?? 0;
  const activeError = tab === "single" ? single.error : tab === "bulk" ? many.error : upload.error;

  const template = () => {
    const blob = new Blob(["email,roles,department\njane.doe@example.com,learner,\nsam.lee@example.com,learner;instructor,\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "praxis-invite-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm">
            <MailPlus className="size-5" aria-hidden />
          </span>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>Invitations expire after 7 days. People join with the roles you choose.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="single">
              <Mail aria-hidden /> Single
            </TabsTrigger>
            <TabsTrigger value="bulk">
              <Users aria-hidden /> Many emails
            </TabsTrigger>
            <TabsTrigger value="csv">
              <FileSpreadsheet aria-hidden /> CSV import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-5">
            <form
              id="invite-single"
              onSubmit={(e) => {
                e.preventDefault();
                if (EMAIL_RE.test(email.trim()) && roles.length) single.mutate();
              }}
              className="space-y-5"
            >
              <FormField label="Email address" required error={email && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address" : null}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" autoFocus />
              </FormField>
              <RolesAndDepartment roles={roles} setRoles={setRoles} department={department} setDepartment={setDepartment} />
            </form>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-5">
            {bulkResult ? (
              <BulkSummary invited={bulkResult.invited.length} errors={bulkResult.errors.map((e) => ({ email: e.email, error: e.error }))} />
            ) : (
              <>
                <FormField
                  label="Email addresses"
                  required
                  hint="Paste up to 500 addresses separated by commas, spaces or new lines."
                >
                  <Textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"alex@company.com, sam@company.com\njordan@company.com"} />
                </FormField>
                {bulk.trim() && (
                  <div className="flex flex-wrap gap-2" aria-live="polite">
                    <Badge tone="success" dot>
                      {parsed.valid.length} valid
                    </Badge>
                    {parsed.invalid.length > 0 && (
                      <Badge tone="danger" dot title={parsed.invalid.join(", ")}>
                        {parsed.invalid.length} invalid: {parsed.invalid.slice(0, 3).join(", ")}
                        {parsed.invalid.length > 3 ? "…" : ""}
                      </Badge>
                    )}
                    {parsed.duplicates > 0 && (
                      <Badge tone="warning" dot>
                        {parsed.duplicates} duplicate{parsed.duplicates === 1 ? "" : "s"} removed
                      </Badge>
                    )}
                  </div>
                )}
                <RolesAndDepartment roles={roles} setRoles={setRoles} department={department} setDepartment={setDepartment} />
              </>
            )}
          </TabsContent>

          <TabsContent value="csv" className="space-y-4">
            {importResult ? (
              <BulkSummary invited={importResult.invited} errors={importResult.errors.map((e) => ({ email: e.email ?? `Row ${e.row}`, error: `Row ${e.row}: ${e.error}` }))} />
            ) : (
              <>
                <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 sm:flex-row sm:items-center">
                  <p className="flex-1">
                    Columns: <code className="font-mono font-semibold">email</code> (required), <code className="font-mono">roles</code> (role keys separated by{" "}
                    <code className="font-mono">;</code>) and <code className="font-mono">department</code> (exact name). Max 1,000 rows / 1&nbsp;MB.
                  </p>
                  <Button size="sm" variant="secondary" leftIcon={<Download />} onClick={template}>
                    Template
                  </Button>
                </div>
                <FileDropzone
                  accept=".csv,text/csv"
                  maxSize={1024 * 1024}
                  onFiles={(f) => {
                    setFile(f[0] ?? null);
                    setPreview(null);
                  }}
                  files={file ? [{ name: file.name, size: file.size }] : undefined}
                  onRemove={() => {
                    setFile(null);
                    setPreview(null);
                    setCsvError(null);
                  }}
                  label="Drop a CSV here, or browse"
                />
                {csvError && (
                  <Alert tone="danger" title="This file can't be imported">
                    {csvError}
                  </Alert>
                )}
                {preview && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                      <Badge tone="success" dot>
                        {preview.length - previewErrors} ready
                      </Badge>
                      {previewErrors > 0 && (
                        <Badge tone="danger" dot>
                          {previewErrors} with problems (will be skipped)
                        </Badge>
                      )}
                    </div>
                    <div className="max-h-60 overflow-auto rounded-xl border border-slate-200 scrollbar-thin">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-50 text-slate-600">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-semibold">Row</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Email</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Roles</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Department</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {preview.slice(0, 200).map((p) => (
                            <tr key={p.row} className={cn(p.error && "bg-rose-50/60")}>
                              <td className="px-3 py-2 tabular-nums text-slate-500">{p.row}</td>
                              <td className="max-w-[12rem] truncate px-3 py-2 font-medium text-slate-800">{p.email || "—"}</td>
                              <td className="px-3 py-2 text-slate-700">{p.roles.join(", ") || <span className="text-slate-400">{defaultRole} (default)</span>}</td>
                              <td className="px-3 py-2 text-slate-700">{p.department || "—"}</td>
                              <td className="px-3 py-2">
                                {p.error ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                                    <AlertTriangle className="size-3.5" aria-hidden />
                                    {p.error}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    <CheckCircle2 className="size-3.5" aria-hidden />
                                    Ready
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <FormField label="Default role" hint="Used for rows without a roles column value.">
                  <SimpleSelect
                    value={defaultRole}
                    onValueChange={setDefaultRole}
                    options={(rolesQ.data ?? [{ key: "learner", name: "Learner" }]).map((r) => ({ value: r.key, label: r.name }))}
                    className="sm:max-w-xs"
                  />
                </FormField>
              </>
            )}
          </TabsContent>
        </Tabs>

        {activeError &&
          (isPlanLimit(activeError) ? (
            <UpgradeNotice error={activeError} title="You've reached your plan's seat limit" compact />
          ) : (
            <Alert tone="danger" title="Couldn't send invitations">
              {errorMessage(activeError)}
            </Alert>
          ))}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {(tab === "bulk" && bulkResult) || (tab === "csv" && importResult) ? "Close" : "Cancel"}
          </Button>
          {tab === "single" && (
            <Button type="submit" form="invite-single" variant="gradient" loading={single.isPending} disabled={!EMAIL_RE.test(email.trim()) || !roles.length}>
              Send invitation
            </Button>
          )}
          {tab === "bulk" && !bulkResult && (
            <Button variant="gradient" loading={many.isPending} disabled={!parsed.valid.length || parsed.valid.length > 500 || !roles.length} onClick={() => many.mutate()}>
              Send {parsed.valid.length || ""} invitation{parsed.valid.length === 1 ? "" : "s"}
            </Button>
          )}
          {tab === "csv" && !importResult && (
            <Button variant="gradient" loading={upload.isPending} disabled={!file || !!csvError || !preview || preview.length === previewErrors} onClick={() => upload.mutate()}>
              Import {preview ? preview.length - previewErrors : ""} people
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkSummary({ invited, errors }: { invited: number; errors: { email: string; error: string }[] }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-slate-900">{invited}</p>
          <p className="text-sm font-medium text-slate-700">Invitations sent</p>
        </div>
        <div className={cn("rounded-2xl border p-4", errors.length ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white" : "border-slate-200 bg-slate-50")}>
          <AlertTriangle className={cn("size-5", errors.length ? "text-rose-600" : "text-slate-400")} aria-hidden />
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-slate-900">{errors.length}</p>
          <p className="text-sm font-medium text-slate-700">Skipped</p>
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="max-h-48 space-y-1.5 overflow-auto rounded-xl border border-rose-100 bg-rose-50/50 p-3 text-sm scrollbar-thin">
          {errors.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium text-slate-900">{e.email}</span>
              <span className="text-rose-700">{e.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
