import { useState, useEffect } from "react";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Plus, Check, Trash2, Clock, Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CATEGORIES = [
  { key: "recruiting", label: "Recruiting", color: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30" },
  { key: "sales", label: "Sales", color: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30" },
  { key: "content", label: "Content", color: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/30" },
  { key: "admin", label: "Admin", color: "bg-muted-foreground", text: "text-muted-foreground", border: "border-border" },
  { key: "fitness", label: "Fitness", color: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/30" },
  { key: "personal", label: "Personal", color: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/30" },
] as const;

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM - 10 PM

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

function getCategoryStyle(key: string) {
  return CATEGORIES.find(c => c.key === key) || CATEGORIES[3];
}

function formatHour(h: number) {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function generateICS(blocks: CalendarBlock[], dateStr: string) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//APEX//Calendar//EN",
  ];
  blocks.forEach(b => {
    const d = dateStr.replace(/-/g, "");
    const sh = String(b.start_hour).padStart(2, "0");
    const eh = String(b.end_hour).padStart(2, "0");
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:${d}T${sh}0000`,
      `DTEND:${d}T${eh}0000`,
      `SUMMARY:${b.title}`,
      `CATEGORIES:${b.category}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export default function AdminCalendar() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStartHour, setNewStartHour] = useState(9);
  const [newEndHour, setNewEndHour] = useState(10);
  const [newCategory, setNewCategory] = useState("admin");

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const fetchBlocks = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("admin_calendar_blocks")
      .select("*")
      .eq("user_id", user.id)
      .eq("block_date", dateStr)
      .order("start_hour", { ascending: true }) as any;
    setBlocks(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchBlocks(); }, [user?.id, dateStr]);

  const completedCount = blocks.filter(b => b.completed).length;
  const completionPct = blocks.length > 0 ? Math.round((completedCount / blocks.length) * 100) : 0;

  const handleAddBlock = async () => {
    if (!newTitle.trim() || !user) return;
    const { error } = await supabase.from("admin_calendar_blocks").insert({
      user_id: user.id,
      title: newTitle.trim(),
      start_hour: newStartHour,
      end_hour: newEndHour,
      block_date: dateStr,
      category: newCategory,
    } as any);
    if (error) { toast.error("Failed to add block"); return; }
    toast.success("Block added!");
    setNewTitle("");
    setShowAdd(false);
    fetchBlocks();
  };

  const toggleComplete = async (block: CalendarBlock) => {
    await supabase.from("admin_calendar_blocks")
      .update({ completed: !block.completed } as any)
      .eq("id", block.id);
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, completed: !b.completed } : b));
  };

  const deleteBlock = async (id: string) => {
    await supabase.from("admin_calendar_blocks").delete().eq("id", id);
    setBlocks(prev => prev.filter(b => b.id !== id));
    toast.success("Block removed");
  };

  const exportICS = () => {
    const ics = generateICS(blocks, dateStr);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-schedule-${dateStr}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Calendar exported!");
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Day Planner</h1>
            <p className="text-muted-foreground text-sm">Block your day for maximum productivity</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportICS} disabled={blocks.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              Export .ics
            </Button>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Block
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

        {/* Hour Grid */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {HOURS.map(hour => {
            const hourBlocks = blocks.filter(b => b.start_hour <= hour && b.end_hour > hour);
            return (
              <div key={hour} className="flex border-b border-border/50 min-h-[56px]">
                {/* Time label */}
                <div className="w-20 flex-shrink-0 px-3 py-2 text-xs text-muted-foreground border-r border-border/50 flex items-start pt-3">
                  {formatHour(hour)}
                </div>
                {/* Blocks */}
                <div className="flex-1 p-1 flex gap-1">
                  <AnimatePresence>
                    {hourBlocks
                      .filter(b => b.start_hour === hour) // Only render at start hour
                      .map(block => {
                        const cat = getCategoryStyle(block.category);
                        const span = block.end_hour - block.start_hour;
                        return (
                          <motion.div
                            key={block.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className={cn(
                              "flex-1 rounded-lg border px-3 py-2 transition-all group",
                              cat.border,
                              block.completed
                                ? "bg-muted/30 opacity-60"
                                : "bg-card hover:shadow-md"
                            )}
                            style={{ minHeight: span > 1 ? `${span * 56 - 8}px` : undefined }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={cn("w-2 h-2 rounded-full flex-shrink-0", cat.color)} />
                                <span className={cn(
                                  "text-sm font-medium truncate",
                                  block.completed && "line-through text-muted-foreground"
                                )}>
                                  {block.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => toggleComplete(block)}
                                >
                                  <Check className={cn("h-3.5 w-3.5", block.completed ? "text-emerald-400" : "text-muted-foreground")} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-red-400"
                                  onClick={() => deleteBlock(block.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {formatHour(block.start_hour)} – {formatHour(block.end_hour)}
                            </div>
                          </motion.div>
                        );
                      })}
                  </AnimatePresence>
                  {hourBlocks.length === 0 && (
                    <button
                      onClick={() => { setNewStartHour(hour); setNewEndHour(hour + 1); setShowAdd(true); }}
                      className="flex-1 rounded-lg border border-dashed border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-colors flex items-center justify-center text-xs text-muted-foreground/40"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Block Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Time Block</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Cold Call Session"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Start</label>
                <Select value={String(newStartHour)} onValueChange={v => setNewStartHour(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => (
                      <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">End</label>
                <Select value={String(newEndHour)} onValueChange={v => setNewEndHour(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.filter(h => h > newStartHour).map(h => (
                      <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                    ))}
                    <SelectItem value="23">{formatHour(23)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAddBlock} disabled={!newTitle.trim()}>Add Block</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
