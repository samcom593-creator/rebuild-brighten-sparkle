import { useState, useEffect, useCallback, useRef } from "react";
import { format, addDays, subDays, getDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, Plus, Check, Trash2, Clock, Download,
  Camera, Pencil, GripVertical, Loader2, Repeat, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

const CATEGORIES = [
  { key: "recruiting", label: "Recruiting", color: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30" },
  { key: "sales", label: "Sales", color: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30" },
  { key: "content", label: "Content", color: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/30" },
  { key: "admin", label: "Admin", color: "bg-muted-foreground", text: "text-muted-foreground", border: "border-border" },
  { key: "fitness", label: "Fitness", color: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/30" },
  { key: "personal", label: "Personal", color: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/30" },
] as const;

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface CalendarBlock {
  id: string;
  title: string;
  start_hour: number;
  end_hour: number;
  block_date: string;
  category: string;
  completed: boolean;
  notes: string | null;
}

interface RecurringBlock {
  id: string;
  title: string;
  start_hour: number;
  end_hour: number;
  category: string;
  notes: string | null;
  recurrence_type: string;
  day_of_week: number | null;
  is_active: boolean;
}

interface ParsedBlock {
  title: string;
  start_hour: number;
  end_hour: number;
  category: string;
}

function getCategoryStyle(key: string) {
  return CATEGORIES.find(c => c.key === key) || CATEGORIES[3];
}

function formatHour(h: number) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function generateICS(blocks: CalendarBlock[], dateStr: string) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//APEX//Calendar//EN"];
  blocks.forEach(b => {
    const d = dateStr.replace(/-/g, "");
    const sh = String(b.start_hour).padStart(2, "0");
    const eh = String(b.end_hour).padStart(2, "0");
    lines.push("BEGIN:VEVENT", `DTSTART:${d}T${sh}0000`, `DTEND:${d}T${eh}0000`, `SUMMARY:${b.title}`, `CATEGORIES:${b.category}`, "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// Draggable block component
function DraggableBlock({ block, isMobile, onToggle, onDelete, onEdit, isRecurringOrigin }: {
  block: CalendarBlock; isMobile: boolean; isRecurringOrigin?: boolean;
  onToggle: () => void; onDelete: () => void; onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: block.id, data: { block } });
  const cat = getCategoryStyle(block.category);
  const span = block.end_hour - block.start_hour;

  return (
    <motion.div
      ref={setNodeRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: isDragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 transition-all group cursor-grab active:cursor-grabbing",
        cat.border,
        block.completed ? "bg-muted/30 opacity-60" : "bg-card hover:shadow-md"
      )}
      style={{ minHeight: span > 1 ? `${span * 56 - 8}px` : undefined }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <button {...listeners} {...attributes} className="touch-none flex-shrink-0 text-muted-foreground/50 hover:text-muted-foreground">
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", cat.color)} />
          <span className={cn("text-sm font-medium truncate", block.completed && "line-through text-muted-foreground")}>
            {block.title}
          </span>
          {isRecurringOrigin && (
            <Repeat className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
          )}
        </div>
        <div className={cn("flex items-center gap-0.5", isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100 transition-opacity")}>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEdit}>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onToggle}>
            <Check className={cn("h-3.5 w-3.5", block.completed ? "text-emerald-400" : "text-muted-foreground")} />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
        <Clock className="h-2.5 w-2.5" />
        {formatHour(block.start_hour)} – {formatHour(block.end_hour)}
      </div>
      {block.notes && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{block.notes}</p>}
    </motion.div>
  );
}

// Droppable hour slot
function DroppableHourSlot({ hour, children, isOver }: { hour: number; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: dropping } = useDroppable({ id: `hour-${hour}` });
  const active = isOver || dropping;
  return (
    <div ref={setNodeRef} className={cn("flex-1 p-1 flex gap-1 min-h-[56px] transition-colors rounded", active && "bg-primary/10 ring-1 ring-primary/30")}>
      {children}
    </div>
  );
}

export default function AdminCalendar() {
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const isMobile = useIsMobile();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit dialog state
  const [showAdd, setShowAdd] = useState(false);
  const [editingBlock, setEditingBlock] = useState<CalendarBlock | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formStartHour, setFormStartHour] = useState(9);
  const [formEndHour, setFormEndHour] = useState(10);
  const [formCategory, setFormCategory] = useState("admin");
  const [formNotes, setFormNotes] = useState("");
  const [formRepeat, setFormRepeat] = useState<"none" | "daily" | "weekly">("none");

  // AI scan state
  const [showScan, setShowScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [parsedBlocks, setParsedBlocks] = useState<ParsedBlock[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DnD state
  const [activeBlock, setActiveBlock] = useState<CalendarBlock | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Recurring blocks state
  const [recurringBlocks, setRecurringBlocks] = useState<RecurringBlock[]>([]);
  const [showRecurring, setShowRecurring] = useState(false);
  const [pendingRecurring, setPendingRecurring] = useState<RecurringBlock[]>([]);
  const [recurringAppliedDates, setRecurringAppliedDates] = useState<Set<string>>(new Set());

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeek = getDay(selectedDate); // 0=Sunday

  const fetchRecurringBlocks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("recurring_calendar_blocks")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true) as any;
    setRecurringBlocks(data || []);
  }, [user?.id]);

  const fetchBlocks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("admin_calendar_blocks")
      .select("*")
      .eq("user_id", user.id)
      .eq("block_date", dateStr)
      .order("start_hour", { ascending: true }) as any;
    const dayBlocks: CalendarBlock[] = data || [];
    setBlocks(dayBlocks);

    // Check for applicable recurring blocks if day is empty
    if (dayBlocks.length === 0 && !recurringAppliedDates.has(dateStr)) {
      const matching = recurringBlocks.filter(rb => {
        if (rb.recurrence_type === "daily") return true;
        if (rb.recurrence_type === "weekly" && rb.day_of_week === dayOfWeek) return true;
        return false;
      });
      setPendingRecurring(matching);
    } else {
      setPendingRecurring([]);
    }

    setLoading(false);
  }, [user?.id, dateStr, recurringBlocks, dayOfWeek, recurringAppliedDates]);

  useEffect(() => { fetchRecurringBlocks(); }, [fetchRecurringBlocks]);
  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  const completedCount = blocks.filter(b => b.completed).length;
  const completionPct = blocks.length > 0 ? Math.round((completedCount / blocks.length) * 100) : 0;

  // Apply recurring blocks to current day
  const applyRecurringBlocks = async () => {
    if (!user || pendingRecurring.length === 0) return;
    const inserts = pendingRecurring.map(rb => ({
      user_id: user.id,
      title: rb.title,
      start_hour: rb.start_hour,
      end_hour: rb.end_hour,
      block_date: dateStr,
      category: rb.category,
      notes: rb.notes,
    }));
    const { error } = await supabase.from("admin_calendar_blocks").insert(inserts as any);
    if (error) { toast.error("Failed to apply recurring blocks"); playSound("error"); return; }
    toast.success(`${pendingRecurring.length} recurring blocks applied!`); playSound("success");
    setPendingRecurring([]);
    setRecurringAppliedDates(prev => new Set(prev).add(dateStr));
    fetchBlocks();
  };

  // Open add dialog for a specific hour
  const openAddDialog = (hour?: number) => {
    setEditingBlock(null);
    setFormTitle("");
    setFormStartHour(hour ?? 9);
    setFormEndHour((hour ?? 9) + 1);
    setFormCategory("admin");
    setFormNotes("");
    setFormRepeat("none");
    setShowAdd(true);
  };

  // Open edit dialog
  const openEditDialog = (block: CalendarBlock) => {
    setEditingBlock(block);
    setFormTitle(block.title);
    setFormStartHour(block.start_hour);
    setFormEndHour(block.end_hour);
    setFormCategory(block.category);
    setFormNotes(block.notes || "");
    setFormRepeat("none");
    setShowAdd(true);
  };

  const handleSaveBlock = async () => {
    if (!formTitle.trim() || !user) return;

    // Save recurring block if repeat is set
    if (formRepeat !== "none" && !editingBlock) {
      const recurringInsert: any = {
        user_id: user.id,
        title: formTitle.trim(),
        start_hour: formStartHour,
        end_hour: formEndHour,
        category: formCategory,
        notes: formNotes || null,
        recurrence_type: formRepeat,
        day_of_week: formRepeat === "weekly" ? dayOfWeek : null,
      };
      const { error: recError } = await supabase.from("recurring_calendar_blocks").insert(recurringInsert);
      if (recError) { toast.error("Failed to save recurring block"); playSound("error"); return; }

      // Also insert as a regular block for today
      const { error } = await supabase.from("admin_calendar_blocks").insert({
        user_id: user.id, title: formTitle.trim(), start_hour: formStartHour, end_hour: formEndHour,
        block_date: dateStr, category: formCategory, notes: formNotes || null,
      } as any);
      if (error) { toast.error("Failed to add block"); playSound("error"); return; }
      toast.success(`Recurring ${formRepeat} block created!`); playSound("success");
      fetchRecurringBlocks();
    } else if (editingBlock) {
      const { error } = await supabase.from("admin_calendar_blocks")
        .update({ title: formTitle.trim(), start_hour: formStartHour, end_hour: formEndHour, category: formCategory, notes: formNotes || null } as any)
        .eq("id", editingBlock.id);
      if (error) { toast.error("Failed to update"); playSound("error"); return; }
      toast.success("Block updated!"); playSound("success");
    } else {
      const { error } = await supabase.from("admin_calendar_blocks").insert({
        user_id: user.id, title: formTitle.trim(), start_hour: formStartHour, end_hour: formEndHour,
        block_date: dateStr, category: formCategory, notes: formNotes || null,
      } as any);
      if (error) { toast.error("Failed to add block"); playSound("error"); return; }
      toast.success("Block added!"); playSound("success");
    }
    setShowAdd(false);
    fetchBlocks();
  };

  const toggleComplete = async (block: CalendarBlock) => {
    await supabase.from("admin_calendar_blocks").update({ completed: !block.completed } as any).eq("id", block.id);
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, completed: !b.completed } : b));
  };

  const deleteBlock = async (id: string) => {
    await supabase.from("admin_calendar_blocks").delete().eq("id", id);
    setBlocks(prev => prev.filter(b => b.id !== id));
    toast.success("Block removed"); playSound("click");
  };

  const exportICS = () => {
    const ics = generateICS(blocks, dateStr);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `apex-schedule-${dateStr}.ics`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Calendar exported!"); playSound("success");
  };

  // Recurring block management
  const toggleRecurringBlock = async (id: string, isActive: boolean) => {
    await supabase.from("recurring_calendar_blocks").update({ is_active: !isActive } as any).eq("id", id);
    fetchRecurringBlocks();
    toast.success(isActive ? "Recurring block paused" : "Recurring block activated"); playSound("click");
  };

  const deleteRecurringBlock = async (id: string) => {
    await supabase.from("recurring_calendar_blocks").delete().eq("id", id);
    setRecurringBlocks(prev => prev.filter(b => b.id !== id));
    toast.success("Recurring block deleted"); playSound("click");
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const block = event.active.data.current?.block as CalendarBlock;
    setActiveBlock(block || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveBlock(null);
    const { active, over } = event;
    if (!over) return;
    const block = active.data.current?.block as CalendarBlock;
    if (!block) return;
    const targetHour = parseInt(String(over.id).replace("hour-", ""));
    if (isNaN(targetHour) || targetHour === block.start_hour) return;

    const duration = block.end_hour - block.start_hour;
    const newEnd = Math.min(targetHour + duration, 23);
    
    await supabase.from("admin_calendar_blocks")
      .update({ start_hour: targetHour, end_hour: newEnd } as any)
      .eq("id", block.id);
    
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, start_hour: targetHour, end_hour: newEnd } : b));
    toast.success(`Moved to ${formatHour(targetHour)}`); playSound("whoosh");
  };

  // AI Screenshot scan
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setShowScan(false);

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("parse-schedule-image", {
        body: { imageBase64: base64, mimeType: file.type },
      });

      if (error) throw error;
      const parsed = data?.blocks || [];
      if (parsed.length === 0) {
        toast.error("No schedule blocks detected in image"); playSound("error");
        setScanning(false);
        return;
      }
      setParsedBlocks(parsed);
      setShowPreview(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse schedule image"); playSound("error");
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmParsedBlocks = async () => {
    if (!user) return;
    const inserts = parsedBlocks.map(b => ({
      user_id: user.id,
      title: b.title,
      start_hour: b.start_hour,
      end_hour: b.end_hour,
      block_date: dateStr,
      category: b.category,
    }));
    const { error } = await supabase.from("admin_calendar_blocks").insert(inserts as any);
    if (error) { toast.error("Failed to add blocks"); playSound("error"); return; }
    toast.success(`${parsedBlocks.length} blocks added from scan!`); playSound("celebrate");
    setShowPreview(false);
    setParsedBlocks([]);
    fetchBlocks();
  };

  const removeParsedBlock = (idx: number) => {
    setParsedBlocks(prev => prev.filter((_, i) => i !== idx));
  };

  // Check if a block title matches any recurring block (simple heuristic)
  const isRecurringOrigin = (block: CalendarBlock) => {
    return recurringBlocks.some(rb =>
      rb.title === block.title && rb.start_hour === block.start_hour && rb.end_hour === block.end_hour
    );
  };

  return (
    <>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className={cn("flex items-center justify-between mb-6", isMobile && "flex-col items-start gap-3")}>
          <div>
            <h1 className="text-2xl font-bold">Day Planner</h1>
            <p className="text-muted-foreground text-sm">Block your day for maximum productivity</p>
          </div>
          <div className={cn("flex items-center gap-2", isMobile && "w-full flex-wrap")}>
            <Button variant="outline" size="sm" onClick={() => setShowRecurring(true)}>
              <Repeat className="h-4 w-4 mr-1" /> Recurring
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setShowScan(true); }} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Camera className="h-4 w-4 mr-1" />}
              {scanning ? "Scanning…" : "AI Scan"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportICS} disabled={blocks.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button size="sm" onClick={() => openAddDialog()}>
              <Plus className="h-4 w-4 mr-1" /> Add Block
            </Button>
          </div>
        </div>

        {/* Date Navigator */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setSelectedDate(d => subDays(d, 1))}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="text-center">
            <p className="text-lg font-semibold">{format(selectedDate, "EEEE")}</p>
            <p className="text-sm text-muted-foreground">{format(selectedDate, "MMMM d, yyyy")}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSelectedDate(d => addDays(d, 1))}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Recurring Blocks Banner */}
        {pendingRecurring.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className="h-4 w-4 text-primary flex-shrink-0" />
              <p className="text-sm text-foreground">
                <span className="font-medium">{pendingRecurring.length} recurring block{pendingRecurring.length !== 1 ? "s" : ""}</span>
                {" "}available for {format(selectedDate, "EEEE")}
              </p>
            </div>
            <Button size="sm" onClick={applyRecurringBlocks}>
              Apply
            </Button>
          </motion.div>
        )}

        {/* Day Progress */}
        <div className="mb-6 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Day Completion</span>
            <span className="text-sm text-muted-foreground">{completedCount}/{blocks.length} blocks</span>
          </div>
          <Progress value={completionPct} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">{completionPct}% done</p>
        </div>

        {/* Category Legend */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map(c => (
            <Badge key={c.key} variant="outline" className={cn("text-xs", c.text, c.border)}>
              <div className={cn("w-2 h-2 rounded-full mr-1.5", c.color)} />
              {c.label}
            </Badge>
          ))}
        </div>

        {/* Hour Grid with DnD */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {HOURS.map(hour => {
              const hourBlocks = blocks.filter(b => b.start_hour === hour);
              const occupied = blocks.some(b => b.start_hour <= hour && b.end_hour > hour);
              return (
                <div key={hour} className="flex border-b border-border/50 min-h-[56px]">
                  <div className="w-16 md:w-20 flex-shrink-0 px-2 md:px-3 py-2 text-xs text-muted-foreground border-r border-border/50 flex items-start pt-3">
                    {formatHour(hour)}
                  </div>
                  <DroppableHourSlot hour={hour}>
                    <AnimatePresence>
                      {hourBlocks.map(block => (
                        <DraggableBlock
                          key={block.id}
                          block={block}
                          isMobile={isMobile}
                          isRecurringOrigin={isRecurringOrigin(block)}
                          onToggle={() => toggleComplete(block)}
                          onDelete={() => deleteBlock(block.id)}
                          onEdit={() => openEditDialog(block)}
                        />
                      ))}
                    </AnimatePresence>
                    {!occupied && hourBlocks.length === 0 && (
                      <button
                        onClick={() => openAddDialog(hour)}
                        className="flex-1 rounded-lg border border-dashed border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-colors flex items-center justify-center text-xs text-muted-foreground/40 min-h-[48px]"
                      >
                        +
                      </button>
                    )}
                  </DroppableHourSlot>
                </div>
              );
            })}
          </div>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeBlock && (() => {
              const cat = getCategoryStyle(activeBlock.category);
              return (
                <div className={cn("rounded-lg border px-3 py-2 shadow-lg bg-card", cat.border)} style={{ width: 260 }}>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", cat.color)} />
                    <span className="text-sm font-medium">{activeBlock.title}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatHour(activeBlock.start_hour)} – {formatHour(activeBlock.end_hour)}
                  </div>
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Hidden file input for AI scan */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* AI Scan Dialog */}
      <Dialog open={showScan} onOpenChange={setShowScan}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI Schedule Scan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Upload a screenshot of your schedule and AI will automatically extract time blocks.
            </p>
            <Button className="w-full" onClick={() => { fileInputRef.current?.click(); }}>
              <Camera className="h-4 w-4 mr-2" /> Choose Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Parsed Blocks Preview */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scanned Blocks ({parsedBlocks.length})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4 max-h-[50vh] overflow-y-auto">
            {parsedBlocks.map((b, i) => {
              const cat = getCategoryStyle(b.category);
              return (
                <div key={i} className={cn("flex items-center justify-between rounded-lg border p-3", cat.border)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-2 h-2 rounded-full flex-shrink-0", cat.color)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.title}</p>
                      <p className="text-[10px] text-muted-foreground">{formatHour(b.start_hour)} – {formatHour(b.end_hour)} · {cat.label}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => removeParsedBlock(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {parsedBlocks.length === 0 && <p className="text-sm text-muted-foreground text-center">No blocks to add</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
            <Button onClick={confirmParsedBlocks} disabled={parsedBlocks.length === 0}>
              Add {parsedBlocks.length} Block{parsedBlocks.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Block Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBlock ? "Edit Time Block" : "Add Time Block"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. Cold Call Session" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Start</label>
                <Select value={String(formStartHour)} onValueChange={v => setFormStartHour(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">End</label>
                <Select value={String(formEndHour)} onValueChange={v => setFormEndHour(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.filter(h => h > formStartHour).map(h => <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>)}
                    <SelectItem value="23">{formatHour(23)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.key} value={c.key}>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", c.color)} />
                        {c.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Any details…" className="mt-1" rows={2} />
            </div>
            {/* Repeat Toggle - only for new blocks */}
            {!editingBlock && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Repeat</label>
                <Select value={formRepeat} onValueChange={v => setFormRepeat(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly ({DAY_NAMES[dayOfWeek]}s)</SelectItem>
                  </SelectContent>
                </Select>
                {formRepeat !== "none" && (
                  <p className="text-xs text-muted-foreground">
                    This block will auto-populate on {formRepeat === "daily" ? "every day" : `every ${DAY_NAMES[dayOfWeek]}`} when the day is empty.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleSaveBlock} disabled={!formTitle.trim()}>
              {editingBlock ? "Save Changes" : formRepeat !== "none" ? "Create Recurring" : "Add Block"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Recurring Blocks Dialog */}
      <Dialog open={showRecurring} onOpenChange={setShowRecurring}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat className="h-5 w-5" /> Recurring Blocks
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4 max-h-[50vh] overflow-y-auto">
            {recurringBlocks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recurring blocks yet. Add a block with "Repeat" enabled to create one.
              </p>
            )}
            {recurringBlocks.map(rb => {
              const cat = getCategoryStyle(rb.category);
              return (
                <div key={rb.id} className={cn("flex items-center justify-between rounded-lg border p-3", cat.border, !rb.is_active && "opacity-50")}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-2 h-2 rounded-full flex-shrink-0", cat.color)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{rb.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatHour(rb.start_hour)} – {formatHour(rb.end_hour)} · {rb.recurrence_type === "daily" ? "Every day" : `Every ${DAY_NAMES[rb.day_of_week ?? 0]}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={rb.is_active}
                      onCheckedChange={() => toggleRecurringBlock(rb.id, rb.is_active)}
                    />
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => deleteRecurringBlock(rb.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
