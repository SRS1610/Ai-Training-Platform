"use client";

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioCard,
  RadioGroup,
  Textarea,
  cn,
} from "@praxis/ui";
import {
  ArrowUpRight,
  CheckCircle2,
  Eye,
  FileText,
  type LucideIcon,
  ListChecks,
  MessageSquare,
  MousePointerClick,
  Send,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import * as React from "react";
import type { ViewAction } from "../types";
import { useWorkspace } from "./context";

export const KIND_META: Record<string, { icon: LucideIcon; label: string; tone: string }> = {
  inspect: { icon: Eye, label: "Inspect", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  select: { icon: ListChecks, label: "Decide", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  command: { icon: Wrench, label: "Change", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  document: { icon: FileText, label: "Write", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  submit: { icon: CheckCircle2, label: "Submit", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  escalate: { icon: ArrowUpRight, label: "Escalate", tone: "bg-orange-50 text-orange-700 ring-orange-200" },
  ask: { icon: MessageSquare, label: "Ask", tone: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
};

export const INPUT_LABEL: Record<string, { label: string; icon: LucideIcon }> = {
  none: { label: "One click", icon: MousePointerClick },
  choice: { label: "Choose one", icon: ListChecks },
  free_text: { label: "Free text", icon: FileText },
  command: { label: "Typed command", icon: SquareTerminal },
};

export function kindMeta(kind: string) {
  return KIND_META[kind] ?? { icon: MousePointerClick, label: "Action", tone: "bg-slate-100 text-slate-700 ring-slate-200" };
}

const CONFIRM_SUBMIT = /(close|resolv|complete|finish|end |submit)/i;

export function needsConfirm(a: ViewAction): boolean {
  return a.kind === "escalate" || (a.kind === "submit" && CONFIRM_SUBMIT.test(a.label));
}

/** Runs an action by input type: direct send, choice dialog, free-text dialog or confirmation. */
function useActionRunner(action: ViewAction, onDone?: () => void) {
  const { act, pending, ended } = useWorkspace();
  const [dialog, setDialog] = React.useState<"choice" | "text" | "confirm" | null>(null);
  const busy = pending?.kind === "action" && pending.actionId === action.id;
  const disabled = ended || (!!pending && !busy);

  const send = (input: Record<string, unknown> | null) =>
    act({ action_id: action.id, tool: action.tool ?? undefined, input }, { kind: "action", actionId: action.id, label: action.label });

  const close = () => {
    setDialog(null);
    onDone?.();
  };

  const run = () => {
    if (action.input.type === "choice") return setDialog("choice");
    if (action.input.type === "free_text") return setDialog("text");
    if (needsConfirm(action)) return setDialog("confirm");
    void send(null)
      .catch(() => undefined)
      .finally(() => onDone?.());
  };

  const dialogs = (
    <>
      {dialog === "choice" && <ChoiceDialog action={action} onClose={close} onSubmit={(choice) => send({ choice })} />}
      {dialog === "text" && <TextDialog action={action} onClose={close} onSubmit={(text) => send({ text })} />}
      {dialog === "confirm" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={`${action.label}?`}
          description={
            action.kind === "escalate"
              ? "Escalating hands the work to another team. You can't take it back in this simulation."
              : "This is a final step in the scenario and may end your attempt."
          }
          confirmLabel={action.kind === "escalate" ? "Escalate" : "Confirm"}
          onConfirm={async () => {
            await send(null).catch(() => undefined);
            close();
          }}
        />
      )}
    </>
  );
  return { run, dialogs, busy, disabled };
}

/** Opens an action immediately (used by the actions palette). */
export function ActionLauncher({ action, onDone }: { action: ViewAction; onDone: () => void }) {
  const r = useActionRunner(action, onDone);
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    r.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return r.dialogs;
}

/**
 * One action, rendered by input type: one-click button (with confirmation for irreversible submits /
 * escalations), choice dialog, or free-text dialog. Sends `{action_id, tool, input}` via the session queue.
 */
export function ActionControl({
  action,
  variant = "button",
  size = "sm",
  className,
  children,
}: {
  action: ViewAction;
  variant?: "button" | "row";
  size?: "xs" | "sm" | "md";
  className?: string;
  children?: React.ReactNode;
}) {
  const { run, dialogs, busy, disabled } = useActionRunner(action);
  const k = kindMeta(action.kind);
  const Icon = k.icon;

  const trigger =
    variant === "row" ? (
      <button
        type="button"
        onClick={run}
        disabled={disabled || busy}
        className={cn(
          "group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:focus-ring disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset", k.tone)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">{action.label}</span>
          {action.description && <span className="mt-0.5 block text-xs text-muted-foreground">{action.description}</span>}
        </span>
      </button>
    ) : (
      <Button
        type="button"
        size={size}
        variant={action.kind === "document" || action.kind === "select" ? "soft" : "secondary"}
        onClick={run}
        loading={busy}
        disabled={disabled}
        leftIcon={
          <Icon
            className={cn(
              action.kind === "escalate" && "text-orange-600",
              action.kind === "command" && "text-amber-600",
              action.kind === "submit" && "text-emerald-600",
              action.kind === "inspect" && "text-sky-600",
            )}
          />
        }
        className={cn("shrink-0 justify-start", className)}
        title={action.description || undefined}
      >
        {children ?? action.label}
      </Button>
    );

  return (
    <>
      {trigger}
      {dialogs}
    </>
  );
}

function ChoiceDialog({ action, onClose, onSubmit }: { action: ViewAction; onClose: () => void; onSubmit: (choice: string) => Promise<unknown> }) {
  const [value, setValue] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>{action.description || "Choose the option that best fits the evidence you've gathered."}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={value} onValueChange={setValue} className="grid gap-2.5" aria-label={action.label}>
          {action.input.choices.map((c) => (
            <RadioCard key={c.id} value={c.id} title={c.label} />
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!value}
            loading={busy}
            leftIcon={<Send />}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(value);
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextDialog({ action, onClose, onSubmit }: { action: ViewAction; onClose: () => void; onSubmit: (text: string) => Promise<unknown> }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          {action.description && <DialogDescription>{action.description}</DialogDescription>}
        </DialogHeader>
        <TextActionForm action={action} onSubmit={async (t) => { await onSubmit(t); onClose(); }} onCancel={onClose} autoFocus />
      </DialogContent>
    </Dialog>
  );
}

/** Inline free-text form for document-style actions (resolution notes, incident reports, notices). */
export function TextActionForm({
  action,
  onSubmit,
  onCancel,
  autoFocus,
  rows = 6,
  submitLabel,
}: {
  action: ViewAction;
  onSubmit?: (text: string) => Promise<unknown>;
  onCancel?: () => void;
  autoFocus?: boolean;
  rows?: number;
  submitLabel?: string;
}) {
  const { act, pending, ended } = useWorkspace();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const min = action.input.min_length || 0;
  const tooShort = text.trim().length < Math.max(1, min);
  const submit = async () => {
    if (tooShort) return;
    setBusy(true);
    try {
      if (onSubmit) await onSubmit(text.trim());
      else await act({ action_id: action.id, tool: action.tool ?? undefined, input: { text: text.trim() } }, { kind: "action", actionId: action.id, label: action.label });
      setText("");
    } catch {
      /* toast shown by the workspace */
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {action.label}
      </label>
      <Textarea
        id={id}
        rows={rows}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        placeholder={action.input.placeholder || "Write here…"}
        aria-describedby={`${id}-count`}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        disabled={ended}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-count`} className={cn("text-xs tabular-nums", tooShort && text ? "text-amber-700" : "text-muted-foreground")}>
          {text.trim().length}
          {min ? ` / ${min} characters minimum` : " characters"} · <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> to submit
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" loading={busy} disabled={tooShort || ended || (!!pending && !busy)} leftIcon={<Send />}>
            {submitLabel ?? "Submit"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Toolbar of an app's listed actions, document actions excluded when the panel renders them inline. */
export function ActionBar({ actions, exclude, className }: { actions: ViewAction[]; exclude?: (a: ViewAction) => boolean; className?: string }) {
  const list = actions.filter((a) => !exclude?.(a));
  if (!list.length) return null;
  return (
    <div className={cn("no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible", className)} role="toolbar" aria-label="Actions">
      {list.map((a) => (
        <ActionControl key={a.id} action={a} />
      ))}
    </div>
  );
}
