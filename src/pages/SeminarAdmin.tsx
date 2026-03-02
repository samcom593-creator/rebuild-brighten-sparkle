import { useState, useEffect } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  Users, Mail, Phone, Search, CheckCircle, XCircle, Plus, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Registration {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  license_status: string;
  source: string;
  registered_at: string;
  attended: boolean;
}

export default function SeminarAdmin() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const fetchRegistrations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("seminar_registrations")
      .select("*")
      .order("registered_at", { ascending: false }) as any;
    setRegistrations(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRegistrations(); }, []);

  const toggleAttended = async (reg: Registration) => {
    await supabase.from("seminar_registrations")
      .update({ attended: !reg.attended } as any)
      .eq("id", reg.id);
    setRegistrations(prev =>
      prev.map(r => r.id === reg.id ? { ...r, attended: !r.attended } : r)
    );
  };

  const handleManualAdd = async () => {
    if (!newFirst || !newLast || !newEmail) return;
    const { error } = await supabase.from("seminar_registrations").insert({
      first_name: newFirst.trim(),
      last_name: newLast.trim(),
      email: newEmail.trim().toLowerCase(),
      phone: newPhone.trim() || null,
      source: "manual_add",
    } as any);
    if (error) { toast.error("Failed to add"); return; }
    toast.success("Registrant added!");
    setNewFirst(""); setNewLast(""); setNewEmail(""); setNewPhone("");
    setShowAdd(false);
    fetchRegistrations();
  };

  const filtered = registrations.filter(r => {
    const q = search.toLowerCase();
    return `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q);
  });

  const totalRegs = registrations.length;
  const attendedCount = registrations.filter(r => r.attended).length;
  const showRate = totalRegs > 0 ? Math.round((attendedCount / totalRegs) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Seminar Dashboard</h1>
            <p className="text-muted-foreground text-sm">Weekly Thursday Seminar — 7 PM CST</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Registrant
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{totalRegs}</p>
            <p className="text-xs text-muted-foreground">Total Registered</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{attendedCount}</p>
            <p className="text-xs text-muted-foreground">Attended</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{showRate}%</p>
            <p className="text-xs text-muted-foreground">Show Rate</p>
          </GlassCard>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search registrants..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Registrant List */}
        <div className="space-y-2">
          {filtered.map(reg => (
            <motion.div
              key={reg.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
            >
              <button
                onClick={() => toggleAttended(reg)}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors flex-shrink-0",
                  reg.attended
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                {reg.attended ? <CheckCircle className="h-4 w-4" /> : null}
              </button>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{reg.first_name} {reg.last_name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 truncate">
                    <Mail className="h-3 w-3" /> {reg.email}
                  </span>
                  {reg.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {reg.phone}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="text-[10px]">
                  {reg.source === "manual_add" ? "Manual" : "Landing Page"}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(reg.registered_at), "MMM d")}
                </span>
              </div>
            </motion.div>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No registrants found</p>
            </div>
          )}
        </div>
      </div>

      {/* Manual Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Registrant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Input value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="First Name" />
              <Input value={newLast} onChange={e => setNewLast(e.target.value)} placeholder="Last Name" />
            </div>
            <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" />
            <Input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone (optional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleManualAdd} disabled={!newFirst || !newLast || !newEmail}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
