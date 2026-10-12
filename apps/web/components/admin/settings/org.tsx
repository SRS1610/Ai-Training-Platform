"use client";

/** Organisation profile + branding with a live preview of the app shell and certificate. */

import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BookOpen, Building2, CheckCircle2, ImageIcon, LayoutDashboard, Palette, RotateCcw, Save, Sparkles, Target, XCircle } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ak } from "../keys";
import type { OrgOut } from "../types";
import { SectionCard, UpgradeNotice, isPlanLimit } from "../ui";

export function useOrg() {
  return useQuery({ queryKey: ak.org.current, queryFn: ({ signal }) => api.get<OrgOut>("/organisations/current", { signal }) });
}

/* ------------------------------------------------------------------ colour maths */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lum(hex: string): number {
  const c = rgb(hex);
  if (!c) return 1;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

export function contrastWithWhite(hex: string): number {
  return 1.05 / (lum(hex) + 0.05);
}

function tint(hex: string, t: number): string {
  const c = rgb(hex);
  if (!c) return hex;
  const m = c.map((v) => Math.round(v + (255 - v) * t));
  return `rgb(${m.join(",")})`;
}

const PRESETS = [
  { name: "Indigo", primary: "#4f46e5", secondary: "#7c3aed", accent: "#db2777" },
  { name: "Ocean", primary: "#0369a1", secondary: "#0d9488", accent: "#f59e0b" },
  { name: "Forest", primary: "#047857", secondary: "#0f766e", accent: "#ea580c" },
  { name: "Sunset", primary: "#c2410c", secondary: "#be123c", accent: "#7c3aed" },
  { name: "Berry", primary: "#be185d", secondary: "#7e22ce", accent: "#0284c7" },
  { name: "Graphite", primary: "#334155", secondary: "#4f46e5", accent: "#0d9488" },
];

function ColorField({ label, value, onChange, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; hint?: string }) {
  const valid = !value || HEX.test(value);
  const ratio = valid && value ? contrastWithWhite(value) : null;
  return (
    <FormField label={label} hint={hint} error={valid ? null : "Use a hex colour like #4f46e5"}>
      {(aria) => (
        <div className="flex items-center gap-2">
          <label className={cn("relative grid size-11 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl border border-slate-200 shadow-sm focus-within:ring-4 focus-within:ring-brand-500/20", disabled && "cursor-not-allowed opacity-60")} style={{ background: valid && value ? value : "#fff" }}>
            <span className="sr-only">Pick {label.toLowerCase()}</span>
            <input type="color" value={valid && value && value.length === 7 ? value : "#4f46e5"} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
          </label>
          <Input {...aria} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.trim())} placeholder="#4f46e5" maxLength={7} className="font-mono uppercase" />
          {ratio !== null && (
            <Badge tone={ratio >= 4.5 ? "success" : ratio >= 3 ? "warning" : "danger"} size="sm" className="shrink-0" title="Contrast of white text on this colour">
              {ratio >= 4.5 ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
              {ratio.toFixed(1)}:1
            </Badge>
          )}
        </div>
      )}
    </FormField>
  );
}

/* ------------------------------------------------------------------ previews */

function ShellPreview({ name, logo, primary, secondary, accent }: { name: string; logo: string; primary: string; secondary: string; accent: string }) {
  const p = HEX.test(primary) ? primary : "#4f46e5";
  const s = HEX.test(secondary) ? secondary : p;
  const a = HEX.test(accent) ? accent : s;
  return (
    <figure aria-label="App preview" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
      <div className="flex h-56 text-[10px]">
        <div className="w-28 shrink-0 space-y-1.5 border-r border-slate-100 bg-slate-50/80 p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="size-5 rounded object-contain" />
            ) : (
              <span className="grid size-5 place-items-center rounded text-[9px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${p}, ${s})` }}>
                {name.slice(0, 1)}
              </span>
            )}
            <span className="truncate font-semibold text-slate-800">{name || "Your org"}</span>
          </div>
          {[LayoutDashboard, BookOpen, Target, Award].map((Icon, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-md px-1.5 py-1" style={i === 0 ? { background: tint(p, 0.9), color: p } : { color: "#475569" }}>
              <Icon className="size-3" aria-hidden />
              <span className="h-1.5 flex-1 rounded-full" style={{ background: i === 0 ? p : "#cbd5e1", opacity: i === 0 ? 0.6 : 1 }} />
            </div>
          ))}
        </div>
        <div className="flex-1 space-y-2.5 p-3">
          <div className="rounded-xl p-3 text-white" style={{ background: `linear-gradient(120deg, ${p}, ${s} 60%, ${a})` }}>
            <p className="text-[11px] font-bold">Good morning, Alex</p>
            <p className="opacity-90">3 courses in progress</p>
            <span className="mt-1.5 inline-block rounded-md bg-white px-2 py-0.5 font-semibold" style={{ color: p }}>
              Resume
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[p, s, a].map((c, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-1.5">
                <span className="block size-3 rounded" style={{ background: c }} />
                <span className="mt-1 block h-1.5 w-8 rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-2/3 rounded-full" style={{ background: `linear-gradient(90deg, ${p}, ${a})` }} />
            </div>
            <div className="flex gap-1.5">
              <span className="rounded-md px-2 py-0.5 font-semibold text-white" style={{ background: p }}>
                Primary
              </span>
              <span className="rounded-md px-2 py-0.5 font-semibold" style={{ background: tint(p, 0.9), color: p }}>
                Soft
              </span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="border-t border-slate-100 px-3 py-2 text-xs text-muted-foreground">App shell preview</figcaption>
    </figure>
  );
}

function CertificatePreview({ name, logo, primary, secondary, accent, text }: { name: string; logo: string; primary: string; secondary: string; accent: string; text: string }) {
  const p = HEX.test(primary) ? primary : "#4f46e5";
  const s = HEX.test(secondary) ? secondary : p;
  const a = HEX.test(accent) ? accent : s;
  return (
    <figure aria-label="Certificate preview" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
      <div className="relative m-3 rounded-xl border-2 p-4 text-center" style={{ borderColor: tint(p, 0.6) }}>
        <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-lg" style={{ background: `linear-gradient(90deg, ${p}, ${s}, ${a})` }} />
        <div className="mx-auto mb-1 mt-1 flex items-center justify-center gap-1.5">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-5 object-contain" />
          ) : (
            <Building2 className="size-4" style={{ color: p }} aria-hidden />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: p }}>
            {name || "Your organisation"}
          </span>
        </div>
        <p className="font-display text-sm font-bold text-slate-900">Certificate of Completion</p>
        <p className="mt-1 text-[10px] text-slate-500">This certifies that</p>
        <p className="font-display text-base font-semibold" style={{ color: s }}>
          Alex Chen
        </p>
        <p className="mx-auto mt-1 max-w-[16rem] text-[10px] leading-snug text-slate-600">{text || "has successfully completed Incident Response Fundamentals."}</p>
        <div className="mx-auto mt-2 grid size-8 place-items-center rounded-full text-white" style={{ background: `linear-gradient(135deg, ${a}, ${p})` }}>
          <Award className="size-4" aria-hidden />
        </div>
      </div>
      <figcaption className="border-t border-slate-100 px-3 py-2 text-xs text-muted-foreground">Certificate preview</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ form */

interface Form {
  name: string;
  logo_url: string;
  primary: string;
  secondary: string;
  accent: string;
  certificate_text: string;
  login_message: string;
  email_footer: string;
  default_locale: string;
}

function fromOrg(o: OrgOut): Form {
  const b = (o.branding ?? {}) as Record<string, string | undefined>;
  return {
    name: o.name,
    logo_url: o.logo_url ?? "",
    primary: b.primary_color ?? "",
    secondary: b.secondary_color ?? "",
    accent: b.accent_color ?? "",
    certificate_text: b.certificate_text ?? "",
    login_message: b.login_message ?? "",
    email_footer: b.email_footer ?? "",
    default_locale: o.settings.default_locale ?? "en-AU",
  };
}

const LOCALES = [
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "es-ES", label: "Español" },
];

export function OrganisationSettings() {
  const qc = useQueryClient();
  const org = useOrg();
  const [form, setForm] = React.useState<Form | null>(null);
  React.useEffect(() => {
    if (org.data) setForm(fromOrg(org.data));
  }, [org.data]);

  const save = useMutation({
    mutationFn: (f: Form) => {
      const o = org.data!;
      const base = fromOrg(o);
      const body: Record<string, unknown> = {};
      if (f.name.trim() !== o.name) body.name = f.name.trim();
      if (f.default_locale !== base.default_locale) body.settings = { default_locale: f.default_locale };
      const brandingChanged = (["primary", "secondary", "accent", "certificate_text", "login_message", "email_footer"] as const).some((k) => f[k] !== base[k]);
      if (o.features.custom_branding) {
        if (f.logo_url !== base.logo_url) body.logo_url = f.logo_url.trim() || null;
        if (brandingChanged)
          body.branding = {
            primary_color: f.primary || null,
            secondary_color: f.secondary || null,
            accent_color: f.accent || null,
            certificate_text: f.certificate_text.trim() || null,
            login_message: f.login_message.trim() || null,
            email_footer: f.email_footer.trim() || null,
          };
      }
      return api.patch<OrgOut>("/organisations/current", body);
    },
    onSuccess: (o) => {
      qc.setQueryData(ak.org.current, o);
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success("Organisation settings saved");
    },
  });

  if (org.isError) return <ErrorState error={org.error} onRetry={() => org.refetch()} />;
  if (!form || !org.data)
    return (
      <div className="grid gap-6 xl:grid-cols-5">
        <Skeleton className="h-[34rem] rounded-2xl xl:col-span-3" />
        <Skeleton className="h-[34rem] rounded-2xl xl:col-span-2" />
      </div>
    );
  const o = org.data;
  const branding = o.features.custom_branding;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(fromOrg(o));
  const invalid = !form.name.trim() || [form.primary, form.secondary, form.accent].some((c) => c && !HEX.test(c)) || (!!form.logo_url && !/^https?:\/\/.+/i.test(form.logo_url));

  return (
    <form
      className="grid gap-6 xl:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate(form);
      }}
    >
      <div className="space-y-6 xl:col-span-3">
        <SectionCard title="Organisation profile" icon={Building2} color="indigo">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Organisation name" required>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} />
            </FormField>
            <FormField label="Default language & region" hint="Used for dates, numbers and new members.">
              <SimpleSelect value={form.default_locale} onValueChange={(v) => set("default_locale", v)} options={LOCALES} />
            </FormField>
            <FormField label="Workspace URL" className="sm:col-span-2" hint="Set a custom domain in the Custom domain tab.">
              <Input value={`${typeof window !== "undefined" ? window.location.host : "praxis"}/${o.slug}`} disabled className="font-mono" />
            </FormField>
          </div>
        </SectionCard>

        <SectionCard title="Branding" description="Logo and colours used across the app, emails and certificates." icon={Palette} color="fuchsia">
          {!branding && <UpgradeNotice title="Custom branding is a Business feature" description="Add your logo, colours and certificate wording." compact className="mb-5" />}
          <fieldset disabled={!branding} className="space-y-5 disabled:opacity-60">
            <FormField label="Logo URL" hint="A public HTTPS link to a square PNG or SVG (at least 128 × 128). Direct upload needs a public asset store and isn't available yet." error={form.logo_url && !/^https?:\/\/.+/i.test(form.logo_url) ? "Use a full https:// URL" : null}>
              {(aria) => (
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {form.logo_url && /^https?:\/\//.test(form.logo_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.logo_url} alt="Logo preview" className="size-full object-contain" />
                    ) : (
                      <ImageIcon className="size-5 text-slate-400" aria-hidden />
                    )}
                  </span>
                  <Input {...aria} value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://cdn.example.com/logo.svg" maxLength={1024} />
                </div>
              )}
            </FormField>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-800">Presets</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setForm((f) => (f ? { ...f, primary: p.primary, secondary: p.secondary, accent: p.accent } : f))}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-300 focus-visible:focus-ring"
                  >
                    <span className="flex -space-x-1" aria-hidden>
                      {[p.primary, p.secondary, p.accent].map((c) => (
                        <span key={c} className="size-5 rounded-full ring-2 ring-white" style={{ background: c }} />
                      ))}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <ColorField label="Primary" value={form.primary} onChange={(v) => set("primary", v)} hint="Buttons, links, active nav" />
              <ColorField label="Secondary" value={form.secondary} onChange={(v) => set("secondary", v)} hint="Gradients, highlights" />
              <ColorField label="Accent" value={form.accent} onChange={(v) => set("accent", v)} hint="Badges, certificate seal" />
            </div>
            {form.primary && HEX.test(form.primary) && contrastWithWhite(form.primary) < 4.5 && (
              <Alert tone="warning" title="Low contrast primary colour">
                White text on this colour is below 4.5:1. Praxis automatically darkens it in the app so buttons stay readable (WCAG AA).
              </Alert>
            )}
            <FormField label="Certificate wording" hint="Shown under the learner's name on certificates.">
              <Textarea rows={2} value={form.certificate_text} onChange={(e) => set("certificate_text", e.target.value)} maxLength={1000} placeholder="has successfully completed the course and demonstrated the required competencies." />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Sign-in message" hint="Shown on your login page.">
                <Textarea rows={2} value={form.login_message} onChange={(e) => set("login_message", e.target.value)} maxLength={500} />
              </FormField>
              <FormField label="Email footer" hint="Appended to notification emails.">
                <Textarea rows={2} value={form.email_footer} onChange={(e) => set("email_footer", e.target.value)} maxLength={500} />
              </FormField>
            </div>
          </fieldset>
        </SectionCard>
      </div>

      <div className="xl:col-span-2">
        <div className="sticky top-24 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-fuchsia-600" aria-hidden />
            <h2 className="font-display text-base font-semibold text-slate-900">Live preview</h2>
          </div>
          <ShellPreview name={form.name} logo={/^https?:\/\//.test(form.logo_url) ? form.logo_url : ""} primary={form.primary} secondary={form.secondary} accent={form.accent} />
          <CertificatePreview name={form.name} logo={/^https?:\/\//.test(form.logo_url) ? form.logo_url : ""} primary={form.primary} secondary={form.secondary} accent={form.accent} text={form.certificate_text} />
          {save.isError &&
            (isPlanLimit(save.error) ? (
              <UpgradeNotice error={save.error} compact />
            ) : (
              <Alert tone="danger" title="Couldn't save">
                {errorMessage(save.error)}
              </Alert>
            ))}
          <div className="flex gap-2">
            <Button variant="ghost" leftIcon={<RotateCcw />} disabled={!dirty || save.isPending} onClick={() => setForm(fromOrg(o))}>
              Discard
            </Button>
            <Button type="submit" variant="gradient" block leftIcon={<Save />} loading={save.isPending} disabled={!dirty || invalid}>
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
