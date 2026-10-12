"use client";

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea, toast } from "@praxis/ui";
import { Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";

interface Msg {
  id: string;
  role: string;
  content: string;
  mode: string | null;
}

/** Right-side AI tutor drawer (minimal version; replaced by the full chat shortly). */
export function TutorPanel({
  courseId,
  lessonId,
  open,
  onOpenChange,
}: {
  courseId?: string;
  lessonId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      let sid = sessionId;
      if (!sid) {
        const s = await api.post<{ id: string }>("/ai/tutor/sessions", { course_id: courseId ?? null, lesson_id: lessonId ?? null });
        sid = s.id;
        setSessionId(sid);
      }
      const ex = await api.post<{ user_message: Msg; assistant_message: Msg }>(`/ai/tutor/sessions/${sid}/messages`, {
        content,
        lesson_id: lessonId ?? null,
      });
      setMessages((m) => [...m, ex.user_message, ex.assistant_message]);
      setText("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg gap-0 p-0">
        <SheetHeader className="border-b border-slate-200 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-600" aria-hidden /> AI tutor
          </SheetTitle>
          <SheetDescription>Ask about this lesson. Answers cite your course materials.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-10 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm text-white" : "mr-6 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200"}>
              {m.role === "user" ? m.content : <Markdown className="text-sm">{m.content}</Markdown>}
            </div>
          ))}
        </div>
        <form
          className="flex items-end gap-2 border-t border-slate-200 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the tutor…" aria-label="Message the tutor" rows={2} />
          <Button type="submit" size="icon" loading={busy} aria-label="Send">
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
