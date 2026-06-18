import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Mic,
  MicOff,
  PhoneCall,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  appendNote,
  applyTranscriptHints,
  BUCKETS,
  bucketOf,
  clearDraft,
  createId,
  EMPTY_FORM,
  fmtCallTimer,
  formatPhone,
  inferStateFromPhone,
  leadName,
  loadDraft,
  loadLocalLeads,
  PROBLEM_OPTIONS,
  QUICK_FACTS,
  saveDraft,
  saveLocalLeads,
} from "@/lib/inboundLeads";
import type { DisplayBucket, InboundLead, InboundStage, Urgency } from "@/lib/inboundLeads";
import { cn } from "@/lib/utils";

const STAGE_META: Record<InboundStage, { label: string; icon: typeof PhoneCall }> = {
  new: { label: "New", icon: PhoneCall },
  diagnosing: { label: "New", icon: PhoneCall },
  quoted: { label: "Quoted", icon: DollarSign },
  follow_up: { label: "Follow-up", icon: CalendarClock },
  won: { label: "Closed", icon: CheckCircle2 },
  lost: { label: "Closed", icon: ShieldCheck },
};

export default function InboundLeads() {
  usePageTitle("Inbound Leads · APEX");
  const { user, isAdmin } = useAuth();
  // Section 11 (2026-06-14): inbound lead routing. ?ref=<slug> on the
  // InboundLeads URL credits the captured call to that agent (sets
  // owner_agent_id on insert). Generic inbound with no ref falls through
  // to the capturing user (created_by_user_id), which is the implicit
  // round-robin = whoever is on the floor answers the call. Admin-defined
  // routing is layered as an attribution panel by month (admin-only).
  const [searchParams] = useSearchParams();
  const refSlug = searchParams.get("ref")?.trim() || null;
  const [routedAgentId, setRoutedAgentId] = useState<string | null>(null);
  const [routedAgentName, setRoutedAgentName] = useState<string | null>(null);
  const [leads, setLeads] = useState<InboundLead[]>(() => loadLocalLeads());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<DisplayBucket | "__all__">("__all__");
  const [newClientOpen, setNewClientOpen] = useState(false);
  // v25 hot-fix: restore draft from localStorage on mount so a page
  // reload mid-call doesn't lose Sam's typed/transcribed data.
  const [form, setForm] = useState(() => loadDraft() ?? { ...EMPTY_FORM });
  const [listening, setListening] = useState(false);
  const [callElapsed, setCallElapsed] = useState(0); // live timer (sec)
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number | null>(null);
  // 2026-06-16 BUG-1 v7.6 — orphan recording tracker. stopListening uploads
  // every recording immediately to call-recordings/orphan/{ts}.{ext}. If Sam
  // then saves a lead, the lead row gets a pointer to this orphan path.
  const lastOrphanRecordingRef = useRef<{ path: string; durationSec: number; ts: number } | null>(null);
  const draftRestored = !!loadDraft();

  // v25 hot-fix: auto-save draft to localStorage on every form change so
  // a tab reload/crash doesn't lose live work mid-call.
  useEffect(() => {
    const t = setTimeout(() => saveDraft(form), 400); // debounce 400ms
    return () => clearTimeout(t);
  }, [form]);

  // v25 hot-fix: live call timer · ticks while mic is recording
  useEffect(() => {
    if (!listening || !recordingStartRef.current) {
      setCallElapsed(0);
      return;
    }
    const tick = () => {
      const startedAt = recordingStartRef.current;
      if (!startedAt) return;
      setCallElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [listening]);

  const mergeLeads = useCallback((incoming: InboundLead[]) => {
    setLeads((prev) => {
      const byId = new Map<string, InboundLead>();
      for (const lead of [...incoming, ...prev]) byId.set(lead.id, lead);
      const merged = Array.from(byId.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      saveLocalLeads(merged);
      return merged;
    });
  }, []);

  const loadRemote = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("inbound_leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {

        return;
      }
      mergeLeads(((data ?? []) as InboundLead[]).map((lead) => ({ ...lead, saved_to_supabase: true })));
    } finally {
      setLoading(false);
    }
  }, [mergeLeads, user?.id]);

  useEffect(() => {
    loadRemote();
  }, [loadRemote]);

  // Section 11: resolve ?ref=<slug> → owner_agent_id via resolve-ref-slug
  // edge fn (same path Apply.tsx uses). If resolved, every inbound lead
  // saved on this tab routes to that agent. If unresolved or absent,
  // owner_agent_id stays null and the lead is owned by the capturing user.
  useEffect(() => {
    if (!refSlug) {
      setRoutedAgentId(null);
      setRoutedAgentName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("resolve-ref-slug", {
          body: { slug: refSlug },
        });
        if (cancelled) return;
        if (error) {
          console.error("[InboundLeads] resolve-ref-slug error:", error);
          return;
        }
        const payload = data as { resolved?: boolean; agent_id?: string; display_name?: string };
        if (payload?.resolved && payload.agent_id) {
          setRoutedAgentId(payload.agent_id);
          setRoutedAgentName(payload.display_name ?? null);
          toast.success(`Routing inbound leads to ${payload.display_name ?? "referrer"}`);
        }
      } catch (err) {
        console.error("[InboundLeads] resolve-ref-slug failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [refSlug]);

  // Section 11 (2026-06-14): admin-only Lead Source Attribution by Month.
  // Pulls last 6 months of inbound_leads, buckets by Phoenix-month + source,
  // shows totals and Won counts per cell. Surfaces which channels Sam should
  // double down on. Admin gate via isAdmin — agents never see this panel.
  // Verification: bot-sql confirmed inbound_leads columns id, created_at,
  // stage, source exist (2026-06-14).
  const sourceAttribution = useQuery({
    queryKey: ["inbound-leads", "source-attribution"],
    enabled: !!isAdmin,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 5);
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await (supabase as any)
        .from("inbound_leads")
        .select("id, created_at, source, stage")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        created_at: string;
        source: string | null;
        stage: InboundStage | null;
      }>;

      // Phoenix tz YYYY-MM key for grouping (Sam's permanent rule for any
      // today/week/month query).
      const fmtMonth = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "2-digit",
      });
      const labelMonth = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "short",
      });

      type Cell = { total: number; won: number };
      const matrix = new Map<string, Map<string, Cell>>(); // month → source → cell
      const sourceSet = new Set<string>();
      const monthSet = new Set<string>();
      const monthLabels = new Map<string, string>();

      for (const r of rows) {
        const monthKey = fmtMonth.format(new Date(r.created_at));
        const sourceKey = (r.source && r.source.trim()) || "unattributed";
        const stage = r.stage || "new";
        sourceSet.add(sourceKey);
        monthSet.add(monthKey);
        monthLabels.set(monthKey, labelMonth.format(new Date(r.created_at)));
        let m = matrix.get(monthKey);
        if (!m) { m = new Map(); matrix.set(monthKey, m); }
        let cell = m.get(sourceKey);
        if (!cell) { cell = { total: 0, won: 0 }; m.set(sourceKey, cell); }
        cell.total += 1;
        if (stage === "won") cell.won += 1;
      }

      // Sort months newest → oldest, sources by total descending across the
      // window so the busiest channel sits on top.
      const months = Array.from(monthSet).sort().reverse();
      const sources = Array.from(sourceSet).sort((a, b) => {
        const at = Array.from(matrix.values()).reduce(
          (acc, m) => acc + (m.get(a)?.total ?? 0), 0);
        const bt = Array.from(matrix.values()).reduce(
          (acc, m) => acc + (m.get(b)?.total ?? 0), 0);
        return bt - at;
      });
      return { months, sources, matrix, monthLabels };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (stageFilter !== "__all__" && bucketOf(lead.stage || "new") !== stageFilter) return false;
      if (!q) return true;
      return [
        leadName(lead),
        lead.phone,
        lead.email,
        lead.problem_type,
        lead.state,
        lead.notes,
        lead.transcript,
      ].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [leads, search, stageFilter]);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // v25 GOOGLE VOICE INSTANT FILL
  // When the New Client dialog opens, try to read the clipboard. If the
  // clipboard contains a US phone number (Sam copies it from Google Voice
  // when the call rings — Cmd+C on the caller ID), pre-fill the phone
  // field, infer state from area code, and open TruePeopleSearch in a
  // background tab automatically. Zero manual typing for the most common
  // workflow.
  // v25 AUTO-OPEN ON CLIPBOARD PHONE · zero keystrokes for Sam.
  // Polls the clipboard every 2 seconds while the inbound page is visible
  // and unfocused on the dialog. When a NEW 10-digit US phone number
  // shows up (different from the last one we processed), the page:
  //   1. Opens the New Client dialog automatically
  //   2. Fills phone + infers state from area code
  //   3. Launches TruePeopleSearch in a background tab
  //   4. Auto-starts the mic (recording + transcription)
  //   5. Plays a subtle success animation on the affected fields
  // Sam's only action: Cmd+C the GV caller number. The page does the rest.
  const lastClipboardPhoneRef = useRef<string | null>(null);

  const handlePhoneFromClipboard = useCallback(async (forceOpen = false) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return false;
    try {
      const text = await navigator.clipboard.readText();
      const m = text.match(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
      if (!m) return false;
      const fullPhone = `(${m[1]}) ${m[2]}-${m[3]}`;
      // Skip if we just processed this same number
      if (!forceOpen && lastClipboardPhoneRef.current === fullPhone) return false;
      lastClipboardPhoneRef.current = fullPhone;
      const inferred = inferStateFromPhone(fullPhone);
      setForm((prev) => ({
        ...prev,
        phone: prev.phone.trim() ? prev.phone : fullPhone,
        state: prev.state.trim() ? prev.state : (inferred ?? prev.state),
      }));
      setNewClientOpen(true);
      toast.success(`📞 ${fullPhone}${inferred ? ` · ${inferred}` : ""} · TPS opening · mic starting...`);
      // TPS in background tab
      window.open(
        `https://www.truepeoplesearch.com/results?phoneno=${fullPhone.replace(/\D/g, "")}`,
        "_blank",
        "noopener,noreferrer",
      );
      return true;
    } catch {
      // permission denied, private mode — silent
      return false;
    }
  }, []);

  // Background clipboard poll while the page is visible (but only when the
  // New Client dialog is closed · once it's open the auto-fill on open
  // effect below handles it). 2-second interval = fast enough that Cmd+C
  // → page-reacts is felt as instant.
  useEffect(() => {
    if (newClientOpen) return;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void handlePhoneFromClipboard();
    };
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [newClientOpen, handlePhoneFromClipboard]);

  // When dialog opens (manually OR auto from clipboard), do one more
  // clipboard pull to handle the "user opened dialog before Cmd+C" path.
  useEffect(() => {
    if (!newClientOpen) return;
    const t = setTimeout(() => { void handlePhoneFromClipboard(true); }, 150);
    return () => clearTimeout(t);
  }, [newClientOpen, handlePhoneFromClipboard]);

  // v26 BUG FIX · DO NOT auto-start startListening from useEffect —
  // browsers require getUserMedia to be triggered by a user gesture
  // (or at least a recent one). Auto-fire 300ms after dialog open
  // means the gesture window has closed and the mic permission silently
  // rejects on some browsers. Sam clicks the mic button (or the auto-flow
  // banner) to start recording. Auto-start kept for the CLIPBOARD-PHONE
  // path (handlePhoneFromClipboard) since clipboard read is itself a
  // gesture-initiated browser API.
  useEffect(() => {
    // Only auto-start mic if the dialog opened from the clipboard-poll path
    // (lastClipboardPhoneRef set) AND we're not already listening.
    if (!newClientOpen || listening || !lastClipboardPhoneRef.current) return;
    const t = setTimeout(() => { void startListening(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newClientOpen]);

  // v25 FIELD-FILL CELEBRATION · when the smart parser populates a
  // previously-empty field from the transcript, briefly mark it as
  // "just filled" so the UI can highlight it emerald for 1.2s — Sam
  // SEES the AI catching what he said. Feels rewarding.
  const prevFormRef = useRef(form);
  const [recentlyFilled, setRecentlyFilled] = useState<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevFormRef.current;
    const justFilled = new Set<string>();
    for (const key of Object.keys(form) as Array<keyof typeof form>) {
      const before = String(prev[key] ?? "").trim();
      const after = String(form[key] ?? "").trim();
      if (!before && after) justFilled.add(String(key));
    }
    prevFormRef.current = form;
    if (justFilled.size === 0) return;
    setRecentlyFilled((s) => {
      const next = new Set(s);
      justFilled.forEach((k) => next.add(k));
      return next;
    });
    // Remove the highlight after 1.2s
    const t = setTimeout(() => {
      setRecentlyFilled((s) => {
        const next = new Set(s);
        justFilled.forEach((k) => next.delete(k));
        return next;
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [form]);

  const startListening = async (opts?: { withTabAudio?: boolean }) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // 2026-06-15 v7.4 BUG FIX: was an EARLY RETURN that blocked the recorder
    // entirely on browsers without webkitSpeechRecognition (Firefox, some
    // Safari builds). Sam: "I'm clicking the recorder. It's not recording the
    // audio." Now: skip dictation if unavailable, but RECORDING STILL FIRES.
    const hasDictation = !!SpeechRecognition;
    if (!hasDictation) {
      toast.warning("Dictation not supported in this browser — recording audio only.");
    }

    // v26 BUG FIX · MIC RECORDING DIRECT (no AudioContext mixing by default)
    // The prior path wrapped a mic stream in an AudioContext + MediaStreamDestination
    // to enable optional tab-audio mixing. That introduced two failure modes:
    //   (1) any AudioContext glitch killed the mic recording silently
    //   (2) the catch block swallowed ALL errors so Sam had no idea what failed
    // Now: mic stream → MediaRecorder directly. ALWAYS records the mic, always
    // logs failures. Tab-audio is opt-in via the mic button long-press (TODO).
    //
    // For the "both sides" flow, Sam can re-enable getDisplayMedia by calling
    // startListening({ withTabAudio: true }) — but that path requires a real
    // user-gesture click and shows the browser tab picker.
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as MediaTrackConstraints,
      }).catch((err) => {
        // Mic permission denied or device not available — surface it
        console.error("[mic] getUserMedia failed:", err);
        toast.error(`Mic blocked: ${err?.name ?? "unknown"}. Click the lock icon → allow microphone.`);
        return null;
      });

      if (!micStream) {
        // Continue with transcript-only flow — no audio file will be saved
        setListening(true);
      } else {
        let recordStream: MediaStream = micStream;
        let ctx: AudioContext | null = null;
        let displayStream: MediaStream | null = null;

        // Optional both-sides path · requires explicit opts.withTabAudio = true
        if (opts?.withTabAudio && navigator.mediaDevices.getDisplayMedia) {
          try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });
            displayStream.getVideoTracks().forEach((t) => t.stop());
            if (displayStream.getAudioTracks().length > 0) {
              ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const destination = ctx.createMediaStreamDestination();
              ctx.createMediaStreamSource(micStream).connect(destination);
              ctx.createMediaStreamSource(displayStream).connect(destination);
              recordStream = destination.stream;
              toast.success("🎧 Both-sides audio active · capturing tab + mic");
            } else {
              displayStream.getAudioTracks().forEach((t) => t.stop());
              displayStream = null;
              toast.info("🎤 Mic only · tab didn't share audio");
            }
          } catch (err: any) {
            console.warn("[tab-audio] getDisplayMedia declined:", err?.name);
            // Stay on mic only · no toast (user dismissed picker intentionally)
          }
        }

        audioChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
        const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          // eslint-disable-next-line no-console
          console.log("[BUG-1] ondataavailable · size=", e?.data?.size ?? "no-data");
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };
        recorder.onerror = (e: any) => {
          console.error("[recorder] error:", e);
          toast.error("Recording stopped unexpectedly. Mic may have been revoked.");
        };
        // 2026-06-15 v7.4 BUG FIX: was recorder.start(1000) which means a deal
        // recorded under 1 second would emit ZERO chunks → empty audio file.
        // Sam: "I'm clicking the recorder. It's not recording the audio."
        // 250ms timeslice ensures even short utterances generate at least 1
        // chunk before stop() fires.
        recorder.start(250);
        // Surface success so Sam knows the recorder ACTUALLY started
        toast.success("🔴 Recording started · mic live");
        mediaRecorderRef.current = recorder;
        recordingStartRef.current = Date.now();
        (recorder as any)._sourceStreams = [micStream, displayStream].filter(Boolean);
        (recorder as any)._audioCtx = ctx;
      }
    } catch (err: any) {
      console.error("[audio] startListening failed:", err);
      toast.error(`Audio capture error: ${err?.message?.slice(0, 60) ?? "unknown"}`);
    }

    if (hasDictation) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event: any) => {
        let transcript = form.transcript ? `${form.transcript} ` : "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          transcript += event.results[i][0].transcript;
        }
        setForm((prev) => applyTranscriptHints(transcript.trim(), prev));
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => {
        setListening(false);
        toast.error("Voice capture stopped. You can keep typing manually.");
      };
      recognitionRef.current = recognition;
      try { recognition.start(); } catch (e) { console.error("[dictation] start failed", e); }
    }
    setListening(true);
  };

  const stopListening = () => {
    recognitionRef.current?.stop?.();
    const recorder = mediaRecorderRef.current as any;
    recorder?.stop?.();
    // close mic stream + display stream + AudioContext (v25 both-sides audio)
    recorder?.stream?.getTracks?.().forEach((t: MediaStreamTrack) => t.stop());
    recorder?._sourceStreams?.forEach((s: MediaStream | null) => {
      s?.getTracks().forEach((t) => t.stop());
    });
    try { recorder?._audioCtx?.close?.(); } catch { /* already closed */ }
    setListening(false);

    // 2026-06-16 BUG-1 v7.6 — Sam's audio recording was structurally broken
    // because uploads ONLY fired inside saveLead(). If Sam recorded but never
    // saved the lead (which he often doesn't during quick test calls), the
    // audio was discarded. Now: upload on STOP, independent of lead save.
    // Lands in call-recordings/orphan/{ts}.{ext} and gets re-attributed when
    // the lead is eventually saved.
    void (async () => {
      try {
        const audio = await harvestAudio();
        if (!audio || audio.blob.size === 0) {
          return;
        }
        const ext = audio.blob.type.includes("mp4") ? "mp4" : "webm";
        const ts = Date.now();
        const path = `orphan/${ts}.${ext}`;
        const { error: upErr } = await (supabase as any).storage
          .from("call-recordings")
          .upload(path, audio.blob, { contentType: audio.blob.type, upsert: false });
        if (upErr) {
          toast.error(`Audio upload failed: ${upErr.message?.slice(0, 60) ?? "unknown"}`);
          return;
        }
        // Remember this orphan path so saveLead() can re-attribute it.
        lastOrphanRecordingRef.current = { path, durationSec: audio.durationSec, ts };
        toast.success(`📼 Recording saved (${audio.durationSec}s)`);
      } catch (e: any) {
        toast.error(`Stop-upload error: ${e?.message?.slice(0, 60) ?? "unknown"}`);
      }
    })();
  };

  /**
   * Returns the recorded audio Blob (webm/mp4) or null if no recording was made.
   * Used by saveLead to upload the audio after persisting the lead row.
   *
   * 2026-06-15 v7.4 BUG FIX: was synchronous · MediaRecorder.stop() is async ·
   * the final `dataavailable` event fires AFTER stop() returns. So calling
   * harvestAudio synchronously right after stop() missed the last chunk.
   * Now: wait for the recorder to fully flush before reading chunks.
   * Sam: "I'm clicking the recorder. It's not recording the audio."
   */
  const harvestAudio = async (): Promise<{ blob: Blob; durationSec: number } | null> => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        recorder.addEventListener("stop", finish, { once: true });
        try { recorder.requestData?.(); } catch {/* not supported */}
        try { recorder.stop(); } catch { resolve(); }
        // Hard timeout · don't hang forever if the recorder is broken
        setTimeout(resolve, 1500);
      });
    }
    const chunks = audioChunksRef.current;
    if (chunks.length === 0) return null;
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    const durationSec = recordingStartRef.current
      ? Math.round((Date.now() - recordingStartRef.current) / 1000)
      : 0;
    audioChunksRef.current = [];
    recordingStartRef.current = null;
    return { blob, durationSec };
  };

  const resetForm = () => {
    stopListening();
    setForm({ ...EMPTY_FORM });
    // v25 hot-fix: wipe the autosave draft so a future page reload
    // doesn't restore stale data after a clean save/cancel.
    clearDraft();
  };

  const saveLead = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.phone.trim() && !form.email.trim()) {
      toast.error("Add at least a phone number or email before saving.");
      return;
    }
    if (!form.problem_type.trim()) {
      toast.error("Pick the problem type so this lead lands in the right lane.");
      return;
    }

    setSaving(true);

    // v25 BUG FIX: stop mic + harvest audio IMMEDIATELY so the recording
    // doesn't keep capturing during the network round-trip + Sam can
    // start the next call without waiting on upload to finish.
    // 2026-06-15 v7.4 · harvestAudio is now async (awaits final chunk
    // before reading) so do NOT pre-call recorder.stop() here · let
    // harvestAudio drive the lifecycle so it can listen for the stop
    // event before reading chunks.
    recognitionRef.current?.stop?.();
    setListening(false);
    const audio = await harvestAudio();
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());

    const now = new Date().toISOString();
    const draft: InboundLead = {
      ...form,
      id: createId(),
      phone: formatPhone(form.phone),
      source: "manual_inbound_call",
      created_at: now,
      updated_at: now,
      saved_to_supabase: false,
    };

    try {
      // Section 11 routing payload:
      //   - owner_agent_id ← routedAgentId (from ?ref= slug) when set,
      //     else null (lead is owned by the capturing user via
      //     created_by_user_id default).
      //   - source ← refSlug suffix when present so the attribution
      //     panel splits "manual_inbound_call" vs "manual_inbound_call:ref"
      //     by month without losing the canonical bucket.
      const routedSource = routedAgentId
        ? `${draft.source}:ref`
        : draft.source;
      const { data, error } = await (supabase as any)
        .from("inbound_leads")
        .insert({
          id: draft.id,
          client_first_name: draft.client_first_name,
          client_last_name: draft.client_last_name,
          phone: draft.phone,
          email: draft.email,
          state: draft.state,
          city: draft.city,
          problem_type: draft.problem_type,
          urgency: draft.urgency,
          current_coverage: draft.current_coverage,
          desired_solution: draft.desired_solution,
          budget: draft.budget,
          household: draft.household,
          notes: draft.notes,
          transcript: draft.transcript,
          stage: draft.stage,
          next_action_at: draft.next_action_at || null,
          source: routedSource,
          owner_agent_id: routedAgentId,
        })
        .select("*")
        .maybeSingle();

      if (error) throw error;
      const saved = { ...(data ?? draft), saved_to_supabase: true } as InboundLead;
      mergeLeads([saved]);
      toast.success(audio && audio.blob.size > 0
        ? `Lead saved · audio (${audio.durationSec}s) uploading in background.`
        : "Inbound lead saved.");

      // 2026-06-16 BUG-1 v7.6 — if stopListening already uploaded the orphan
      // recording (the normal path now), just re-attribute it to the saved
      // lead instead of double-uploading.
      const orphan = lastOrphanRecordingRef.current;
      if (orphan && (!audio || audio.blob.size === 0)) {
        void (async () => {
          try {
            const { data: signed } = await (supabase as any).storage
              .from("call-recordings")
              .createSignedUrl(orphan.path, 60 * 60 * 24 * 365);
            await (supabase as any).from("inbound_leads").update({
              recording_url: signed?.signedUrl ?? orphan.path,
              recording_duration_sec: orphan.durationSec,
              recording_started_at: new Date(orphan.ts - orphan.durationSec * 1000).toISOString(),
            }).eq("id", saved.id);
            toast.success(`Audio attached to ${leadName(saved)}`);
            lastOrphanRecordingRef.current = null;
          } catch (e: any) {
            toast.warning(`Orphan-relink error: ${e?.message?.slice(0, 60) ?? "unknown"}`);
          }
        })();
      }

      // v25 BUG FIX: audio upload is FIRE-AND-FORGET so Sam can take
      // the next call immediately. Was blocking 1-4s on the round-trip.
      if (audio && audio.blob.size > 0) {
        void (async () => {
          try {
            const ext = audio.blob.type.includes("mp4") ? "mp4" : "webm";
            const path = `inbound_leads/${saved.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await (supabase as any).storage
              .from("call-recordings")
              .upload(path, audio.blob, { contentType: audio.blob.type, upsert: false });
            if (upErr) {
              toast.warning(`Audio upload failed: ${upErr.message?.slice(0, 60) ?? "unknown"}`);
              return;
            }
            const { data: signed } = await (supabase as any).storage
              .from("call-recordings")
              .createSignedUrl(path, 60 * 60 * 24 * 365);
            await (supabase as any)
              .from("inbound_leads")
              .update({
                recording_url: signed?.signedUrl ?? path,
                recording_duration_sec: audio.durationSec,
                recording_started_at: new Date(Date.now() - audio.durationSec * 1000).toISOString(),
              })
              .eq("id", saved.id);
            toast.success(`Audio attached to ${leadName(saved)}`);
          } catch (e: any) {
            toast.warning(`Audio upload error: ${e?.message?.slice(0, 60) ?? "unknown"}`);
          }
        })();
      }
    } catch (error) {
      mergeLeads([draft]);
      toast.warning("Saved locally. Deploy the inbound_leads migration to sync it across devices.");
    } finally {
      setSaving(false);
      setNewClientOpen(false);
      resetForm();
    }
  };

  const updateStage = async (lead: InboundLead, stage: InboundStage) => {
    const updated = { ...lead, stage, updated_at: new Date().toISOString() };
    setLeads((prev) => {
      const next = prev.map((row) => (row.id === lead.id ? updated : row));
      saveLocalLeads(next);
      return next;
    });
    try {
      await (supabase as any).from("inbound_leads").update({ stage }).eq("id", lead.id);
    } catch {
      // Local state is still the immediate source of truth for tomorrow's intake.
    }
  };

  const deleteLead = async (lead: InboundLead) => {
    const next = leads.filter((row) => row.id !== lead.id);
    setLeads(next);
    saveLocalLeads(next);
    try {
      await (supabase as any).from("inbound_leads").delete().eq("id", lead.id);
    } catch {
      // Ignore unavailable remote table.
    }
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Client Intake"
        eyebrowIcon={<PhoneCall className="h-3 w-3" />}
        title="Inbound Leads"
        subtitle="Fast call capture for people calling live with different problems. Log the situation, identify the solution lane, and push the client through the follow-up board."
        actions={
          <div className="flex items-center gap-2">
            {/* v25 hot-fix: draft restored banner — Sam sees instantly if
                a page reload restored prior work without him touching anything */}
            {draftRestored && !newClientOpen && (
              <Badge variant="outline" className="text-11 border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                Draft restored — open New Client to resume
              </Badge>
            )}
            <Button className="gap-2" onClick={() => setNewClientOpen(true)}>
              <Plus className="h-4 w-4" />
              New Client
            </Button>
          </div>
        }
      />

      {refSlug && (
        <GlassCard className="p-3">
          <div className="flex items-center gap-2 text-12">
            <ArrowRight className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            {routedAgentId ? (
              <span>
                Routing every saved lead to{" "}
                <AgentNameLink
                  agentId={routedAgentId}
                  variant="bare"
                  className="font-semibold text-emerald-600 dark:text-emerald-300 hover:underline"
                >
                  {routedAgentName ?? "the referring agent"}
                </AgentNameLink>{" "}
                <span className="text-muted-foreground">(?ref={refSlug})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Resolving ?ref={refSlug} …
              </span>
            )}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, problem, notes, transcript"
              className="pl-9"
            />
          </div>
          {/* v26 overhaul: 4-bucket filter (was 6 raw stages) */}
          <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as DisplayBucket | "__all__")}>
            <SelectTrigger className="md:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All stages</SelectItem>
              {BUCKETS.map((b) => (
                <SelectItem key={b.key} value={b.key}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      {filteredLeads.length === 0 ? (
        <GlassCard className="p-4 text-13 text-muted-foreground">
          No inbound calls yet.
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="divide-y divide-border/30">
            {filteredLeads.map((lead) => {
              const meta = STAGE_META[lead.stage];
              const StageIcon = meta.icon;
              const urgencyDot =
                lead.urgency === "hot"
                  ? "bg-rose-400"
                  : lead.urgency === "warm"
                    ? "bg-amber-400"
                    : "bg-slate-500";
              return (
                <div
                  key={lead.id}
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  {/* Urgency dot */}
                  <span
                    title={lead.urgency}
                    className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", urgencyDot)}
                  />

                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-14 font-semibold">{leadName(lead)}</p>
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="text-12 text-muted-foreground hover:text-primary">
                          {lead.phone}
                        </a>
                      )}
                    </div>
                    <p className="truncate text-12 text-muted-foreground">
                      {[
                        lead.problem_type || "No problem type",
                        [lead.city, lead.state].filter(Boolean).join(", "),
                        lead.budget,
                        lead.household,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  {/* Stage chip */}
                  <div className="hidden sm:flex shrink-0">
                    {/* v26 overhaul: 4-bucket per-row stage select */}
                    <Select value={bucketOf(lead.stage)} onValueChange={(value) => {
                      const b = BUCKETS.find((x) => x.key === value);
                      if (b) updateStage(lead, b.canonical);
                    }}>
                      <SelectTrigger className="h-8 w-[130px] text-12">
                        <div className="flex items-center gap-2">
                          <StageIcon className="h-3 w-3" />
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {BUCKETS.map((b) => (
                          <SelectItem key={b.key} value={b.key}>
                            {b.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Time + delete */}
                  <span className="hidden md:inline text-12 text-muted-foreground shrink-0 w-20 text-right">
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400"
                    onClick={() => deleteLead(lead)}
                    aria-label="Delete lead"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* Section 11 (2026-06-14): Admin-only Lead Source Attribution by
          Month. Shows which source generated how many leads + Won counts
          by Phoenix-month. Sam uses this to double down on the channels
          actually closing. Agents don't see it. */}
      {isAdmin && (
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-13 font-bold">Lead source attribution · last 6 months</p>
            <Badge variant="outline" className="ml-auto text-10 uppercase tracking-widest">
              Admin · Phoenix
            </Badge>
          </div>
          {sourceAttribution.isLoading ? (
            <p className="text-12 text-muted-foreground">Loading attribution…</p>
          ) : sourceAttribution.error ? (
            <p className="text-12 text-rose-500">
              Attribution unavailable: {(sourceAttribution.error as Error).message}
            </p>
          ) : !sourceAttribution.data || sourceAttribution.data.sources.length === 0 ? (
            <p className="text-12 text-muted-foreground">
              No inbound leads in the last 6 months yet. Save a call to start populating.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-12">
                <thead>
                  <tr className="border-b border-border/40 text-left">
                    <th className="py-2 pr-3 font-semibold text-muted-foreground">Source</th>
                    {sourceAttribution.data.months.map((m) => (
                      <th key={m} className="py-2 px-2 text-right font-semibold text-muted-foreground tabular-nums">
                        {sourceAttribution.data?.monthLabels.get(m) ?? m}
                      </th>
                    ))}
                    <th className="py-2 pl-3 text-right font-semibold text-muted-foreground tabular-nums">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sourceAttribution.data.sources.map((src) => {
                    let rowTotal = 0;
                    let rowWon = 0;
                    return (
                      <tr key={src} className="border-b border-border/20 last:border-0">
                        <td className="py-2 pr-3 font-medium">{src}</td>
                        {sourceAttribution.data!.months.map((m) => {
                          const cell = sourceAttribution.data!.matrix.get(m)?.get(src);
                          rowTotal += cell?.total ?? 0;
                          rowWon += cell?.won ?? 0;
                          return (
                            <td key={m} className="py-2 px-2 text-right tabular-nums">
                              {cell ? (
                                <span>
                                  {cell.total}
                                  {cell.won > 0 && (
                                    <span className="text-emerald-500 ml-1">· {cell.won}w</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 pl-3 text-right font-semibold tabular-nums">
                          {rowTotal}
                          {rowWon > 0 && (
                            <span className="text-emerald-500 ml-1">· {rowWon}w</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-10 text-muted-foreground">
                "w" = leads that reached stage=won. Months bucketed by Phoenix timezone.
                Sources ending in ":ref" came in via a ?ref=&lt;slug&gt; URL.
              </p>
            </div>
          )}
        </GlassCard>
      )}

      <Dialog open={newClientOpen} onOpenChange={(open) => { setNewClientOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-slate-800 bg-white dark:bg-[#0A0A0A]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              New inbound client
            </DialogTitle>
            <DialogDescription>
              Capture the caller while they are live, then move them through the client solution board.
            </DialogDescription>
            {/* v26 overhaul: shrunk auto-flow banner to a single line · less clutter at the top */}
            <p className="mt-2 text-11 text-emerald-700 dark:text-emerald-300">
              🎧 <span className="font-semibold">Cmd+C the GV number</span> → page opens itself, fills phone+state, opens TPS tab, starts mic.
            </p>
          </DialogHeader>

          <form onSubmit={saveLead} className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              {/* v13 mid-call key-details panel — always visible during the call
                  so Sam can see the extracted bullets as he talks. Mirrors the
                  form fields but in a scannable read-only summary. */}
              <CallSnapshot form={form} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name">
                  <div className="flex gap-1">
                    {/* v25 advantage: autoFocus so the moment the New Client
                        dialog opens, Sam can start typing immediately —
                        no extra click to focus the field. */}
                    <Input autoFocus className={cn(recentlyFilled.has("client_first_name") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")} value={form.client_first_name} onChange={(event) => updateForm("client_first_name", event.target.value)} placeholder="Client first name" />
                    <TpsLookup form={form} mode="name" />
                  </div>
                </Field>
                <Field label="Last name">
                  <Input className={cn(recentlyFilled.has("client_last_name") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")} value={form.client_last_name} onChange={(event) => updateForm("client_last_name", event.target.value)} placeholder="Client last name" />
                </Field>
                <Field label="Phone">
                  <div className="flex gap-1">
                    <Input
                      value={form.phone}
                      onChange={(event) => {
                        const formatted = formatPhone(event.target.value);
                        // v25 advantage: area-code → state autofill if state slot empty
                        const inferred = inferStateFromPhone(formatted);
                        setForm((prev) => ({
                          ...prev,
                          phone: formatted,
                          // only fill if user hasn't already set state (don't clobber)
                          state: prev.state.trim() ? prev.state : (inferred ?? prev.state),
                        }));
                      }}
                      placeholder="(555) 123-4567"
                      className={cn(recentlyFilled.has("phone") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")}
                    />
                    <TpsLookup form={form} mode="phone" />
                  </div>
                </Field>
                <Field label="Email">
                  <Input className={cn(recentlyFilled.has("email") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")} value={form.email} onChange={(event) => updateForm("email", event.target.value)} placeholder="client@email.com" />
                </Field>
                <Field label="City">
                  <Input className={cn(recentlyFilled.has("city") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")} value={form.city} onChange={(event) => updateForm("city", event.target.value)} placeholder="Phoenix" />
                </Field>
                <Field label="State">
                  <Input className={cn(recentlyFilled.has("state") && "ring-2 ring-emerald-400 ring-offset-1 animate-pulse")} value={form.state} onChange={(event) => updateForm("state", event.target.value.toUpperCase().slice(0, 2))} placeholder="AZ" />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Problem type">
                  <Select value={form.problem_type} onValueChange={(value) => updateForm("problem_type", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose lane" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROBLEM_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Urgency">
                  <Select value={form.urgency} onValueChange={(value) => updateForm("urgency", value as Urgency)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hot">Hot · solve now</SelectItem>
                      <SelectItem value="warm">Warm · this week</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Stage">
                  {/* v26 overhaul: 4 buckets (canonical stage value behind each) */}
                  <Select value={bucketOf(form.stage)} onValueChange={(value) => {
                    const b = BUCKETS.find((x) => x.key === value);
                    if (b) updateForm("stage", b.canonical);
                  }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUCKETS.map((b) => (
                        <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* v26 overhaul: Budget always visible (top-of-mind for sales);
                  Current coverage / Household / Desired solution / Next action
                  hidden under a "More details" disclosure to declutter. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Monthly budget">
                  <Input value={form.budget} onChange={(event) => updateForm("budget", event.target.value)} placeholder="$75/mo" />
                </Field>
                <Field label="Next callback">
                  <Input type="datetime-local" value={form.next_action_at} onChange={(event) => updateForm("next_action_at", event.target.value)} />
                </Field>
              </div>

              <details className="rounded-md border border-border bg-muted/30 px-3 py-2 group">
                <summary className="cursor-pointer text-12 font-semibold text-muted-foreground hover:text-foreground transition-base list-none flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  More details (current coverage · household · desired outcome)
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Current coverage">
                      <Input value={form.current_coverage} onChange={(event) => updateForm("current_coverage", event.target.value)} placeholder="None, term policy, group life..." />
                    </Field>
                    <Field label="Household">
                      <Input value={form.household} onChange={(event) => updateForm("household", event.target.value)} placeholder="Spouse, kids, mortgage, income..." />
                    </Field>
                  </div>
                  <Field label="Desired solution">
                    <Textarea value={form.desired_solution} onChange={(event) => updateForm("desired_solution", event.target.value)} placeholder="What outcome are they looking for?" className="min-h-[72px]" />
                  </Field>
                </div>
              </details>

              <Field label="Notes">
                {/* v25 hot-fix quick-fact chips · one tap appends to notes
                    (or removes if already there). Saves 15-20 sec typing
                    on common boolean facts mid-call. */}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {QUICK_FACTS.map((fact) => {
                    const active = form.notes.toLowerCase().includes(fact.toLowerCase());
                    return (
                      <button
                        key={fact}
                        type="button"
                        onClick={() => updateForm("notes", appendNote(form.notes, fact))}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-11 font-medium transition-base",
                          active
                            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                            : "border-border bg-muted text-muted-foreground hover:bg-slate-200 dark:hover:bg-slate-700"
                        )}
                      >
                        {active ? "✓ " : ""}{fact}
                      </button>
                    );
                  })}
                </div>
                <Textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} placeholder="Decision makers, objections, health notes, callback promise, carrier fit..." className="min-h-[120px]" />
              </Field>
            </div>

            <div className="space-y-4">
              <GlassCard className="p-4" variant="strong">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">Voice assist</p>
                    <p className="text-xs text-muted-foreground">
                      Tap the mic during a call. It will capture transcript text and auto-fill obvious fields.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* v25 live call timer · visible only while mic recording */}
                    {listening && (
                      <span className="flex items-center gap-1.5 text-12 font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                        {fmtCallTimer(callElapsed)}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant={listening ? "destructive" : "outline"}
                      className="gap-2"
                      onClick={() => {
                        toast.info(listening ? "🛑 Stop tapped" : "🎤 Mic tapped");
                        if (listening) {
                          stopListening();
                        } else {
                          void startListening();
                        }
                      }}
                    >
                      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {listening ? "Stop" : "Mic"}
                    </Button>
                    {!listening && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-11 px-2"
                        onClick={() => void startListening({ withTabAudio: true })}
                        title="Both-sides audio · captures mic + Google Voice tab audio together"
                      >
                        🎧 Both sides
                      </Button>
                    )}
                  </div>
                </div>
                <Textarea
                  value={form.transcript}
                  onChange={(event) => setForm((prev) => applyTranscriptHints(event.target.value, prev))}
                  placeholder="Transcript lands here. You can also paste call notes and the parser will fill what it can."
                  className="mt-4 min-h-[260px]"
                />
              </GlassCard>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setNewClientOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="gap-2" disabled={saving}>
                  {saving ? <Save className="h-4 w-4 animate-pulse" /> : <Save className="h-4 w-4" />}
                  Save inbound lead
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * TpsLookup — opens TruePeopleSearch in a new tab with phone or name.
 * Sam: "double points if you can build in a link to truepeoplesearch."
 * Phone lookup beats name lookup when both available — fewer false matches.
 */
function TpsLookup({ form, mode }: { form: typeof EMPTY_FORM; mode: "phone" | "name" }) {
  const phone = form.phone.replace(/\D/g, "");
  const fullName = [form.client_first_name, form.client_last_name].filter(Boolean).join(" ").trim();
  const stateZip = form.state ? `&citystatezip=${encodeURIComponent(form.state)}` : "";

  const url =
    mode === "phone" && phone.length >= 10
      ? `https://www.truepeoplesearch.com/results?phoneno=${phone}`
      : mode === "name" && fullName
      ? `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(fullName)}${stateZip}`
      : null;

  const disabled = !url;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
      title={disabled ? `Enter ${mode} first` : `Look up on TruePeopleSearch`}
      className="shrink-0"
    >
      <Search className="h-4 w-4" />
    </Button>
  );
}

/**
 * CallSnapshot — always-visible bullet summary of the extracted caller info.
 * Sam: "live mid call, start to list out in bullet points clearly in my
 * face, the important details from the call itself. So I can look at easy."
 * Reads directly from form state — every transcript-parsed field appears
 * here the moment it's extracted. Empty fields are skipped (no clutter).
 */
function CallSnapshot({ form }: { form: typeof EMPTY_FORM }) {
  const bullets: Array<{ label: string; value: string }> = [];
  const name = [form.client_first_name, form.client_last_name].filter(Boolean).join(" ");
  if (name) bullets.push({ label: "Name", value: name });
  if (form.phone) bullets.push({ label: "Phone", value: form.phone });
  if (form.email) bullets.push({ label: "Email", value: form.email });
  if (form.city || form.state) bullets.push({ label: "Location", value: [form.city, form.state].filter(Boolean).join(", ") });
  if (form.problem_type) bullets.push({ label: "Need", value: form.problem_type });
  if (form.current_coverage) bullets.push({ label: "Has now", value: form.current_coverage });
  if (form.desired_solution) bullets.push({ label: "Wants", value: form.desired_solution });
  if (form.budget) bullets.push({ label: "Budget", value: form.budget });
  if (form.household) bullets.push({ label: "Household", value: form.household });
  if (form.urgency && form.urgency !== "normal") bullets.push({ label: "Urgency", value: form.urgency.toUpperCase() });
  if (form.next_action_at) bullets.push({ label: "Next action", value: form.next_action_at });

  if (bullets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        Start the call — bullets appear here as info comes in (voice transcript auto-fills the form).
      </div>
    );
  }

  return (
    // v24 audit fix: CallSnapshot panel was 5th green inside the dialog
    // (border-emerald-500/40 bg-emerald-500/5). Mono now · emerald only
    // on the small count badge inside.
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-2">
        Call snapshot · {bullets.length} {bullets.length === 1 ? "detail" : "details"} captured
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {bullets.map((b) => (
          <li key={b.label} className="text-xs flex gap-1.5">
            <span className="text-muted-foreground shrink-0">{b.label}:</span>
            <span className="font-medium truncate">{b.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
