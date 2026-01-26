import { useState, useEffect } from "react";
import { AlertTriangle, Phone, Mail, Clock, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface AbandonedLead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  stepCompleted: number;
  createdAt: string;
  followupSentAt: string | null;
}

export function AbandonedLeadsPanel() {
  const [leads, setLeads] = useState<AbandonedLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingFollowup, setSendingFollowup] = useState<string | null>(null);

  const fetchAbandonedLeads = async () => {
    setIsLoading(true);
    try {
      console.log("Fetching abandoned leads from partial_applications...");
      
      const { data, error, count } = await supabase
        .from("partial_applications")
        .select("*", { count: "exact" })
        .is("converted_at", null)
        .order("created_at", { ascending: false });

      console.log("Abandoned leads query result:", { 
        count, 
        dataLength: data?.length,
        error: error?.message 
      });

      if (error) throw error;

      const mappedLeads: AbandonedLead[] = (data || []).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        state: row.state,
        stepCompleted: row.step_completed,
        createdAt: row.created_at,
        followupSentAt: (row.form_data as any)?.followup_sent_at || null,
      }));

      console.log(`Found ${mappedLeads.length} abandoned applications`);
      setLeads(mappedLeads);
    } catch (error) {
      console.error("Error fetching abandoned leads:", error);
      toast.error("Failed to load abandoned leads");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendFollowup = async (lead: AbandonedLead) => {
    if (!lead.email) {
      toast.error("No email address for this lead");
      return;
    }

    setSendingFollowup(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-abandoned-followup", {
        body: { partialApplicationId: lead.id },
      });

      if (error) throw error;

      toast.success(`Follow-up email sent to ${lead.email}`);
      fetchAbandonedLeads(); // Refresh to show updated status
    } catch (error: any) {
      console.error("Error sending follow-up:", error);
      toast.error(error.message || "Failed to send follow-up email");
    } finally {
      setSendingFollowup(null);
    }
  };

  useEffect(() => {
    fetchAbandonedLeads();
  }, []);

  const getStepBadge = (step: number) => {
    const colors = [
      "bg-red-500/20 text-red-400 border-red-500/30",
      "bg-orange-500/20 text-orange-400 border-orange-500/30",
      "bg-amber-500/20 text-amber-400 border-amber-500/30",
      "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    ];
    return (
      <Badge className={colors[step - 1] || colors[0]}>
        Step {step}/5
      </Badge>
    );
  };

  const getName = (lead: AbandonedLead) => {
    if (lead.firstName && lead.lastName) {
      return `${lead.firstName} ${lead.lastName}`;
    }
    if (lead.firstName) return lead.firstName;
    if (lead.email) return lead.email.split("@")[0];
    return "Unknown";
  };

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Abandoned Applications</h3>
          {leads.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {leads.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchAbandonedLeads}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : leads.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No abandoned applications. All leads are completing the form! 🎉
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    {getName(lead)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm">
                      {lead.email && (
                        <span className="text-muted-foreground">{lead.email}</span>
                      )}
                      {lead.phone && (
                        <span className="text-muted-foreground">{lead.phone}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.city && lead.state
                      ? `${lead.city}, ${lead.state}`
                      : lead.state || "—"}
                  </TableCell>
                  <TableCell>{getStepBadge(lead.stepCompleted)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-muted-foreground text-sm">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {lead.email && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 gap-1 text-xs"
                          onClick={() => handleSendFollowup(lead)}
                          disabled={sendingFollowup === lead.id}
                        >
                          <Send className={`h-3 w-3 ${sendingFollowup === lead.id ? "animate-pulse" : ""}`} />
                          {lead.followupSentAt ? "Resend" : "Follow Up"}
                        </Button>
                      )}
                      {lead.phone && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          asChild
                        >
                          <a href={`tel:${lead.phone}`}>
                            <Phone className="h-3.5 w-3.5 text-primary" />
                          </a>
                        </Button>
                      )}
                      {lead.email && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          asChild
                        >
                          <a href={`mailto:${lead.email}`}>
                            <Mail className="h-3.5 w-3.5 text-primary" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </GlassCard>
  );
}
