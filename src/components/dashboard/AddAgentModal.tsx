import { useState, useEffect } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Manager {
  id: string;
  name: string;
}

interface AddAgentModalProps {
  onAgentAdded?: () => void;
}

export function AddAgentModal({ onAgentAdded }: AddAgentModalProps) {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  
  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [managerId, setManagerId] = useState("");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    if (open) {
      fetchManagers();
    }
  }, [open]);

  const fetchManagers = async () => {
    try {
      // Fetch managers with their profiles
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managerRoles?.length) return;

      const managerUserIds = managerRoles.map(r => r.user_id);

      // Get agent IDs for managers
      const { data: managerAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active");

      if (!managerAgents?.length) return;

      // Get profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      const managerList: Manager[] = managerAgents.map(agent => ({
        id: agent.id,
        name: profileMap.get(agent.user_id) || "Unknown Manager",
      }));

      setManagers(managerList);

      // Pre-select current user if they're a manager
      if (user) {
        const currentAgent = managerAgents.find(a => a.user_id === user.id);
        if (currentAgent) {
          setManagerId(currentAgent.id);
        } else if (managerList.length > 0) {
          setManagerId(managerList[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!firstName || !lastName || !email || !phone || !managerId) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      // Create a profile first (without user_id since we're adding manually)
      // For manually added agents, we'll create a placeholder user_id
      const tempUserId = crypto.randomUUID();

      // Create profile
      const { error: profileError } = await supabase
        .from("profiles")
        .insert({
          user_id: tempUserId,
          full_name: `${firstName} ${lastName}`,
          email,
          phone,
        });

      if (profileError) throw profileError;

      // Create agent record
      const { error: agentError } = await supabase
        .from("agents")
        .insert({
          user_id: tempUserId,
          invited_by_manager_id: managerId,
          status: "active",
          license_status: "licensed",
          onboarding_stage: "onboarding",
          start_date: startDate || null,
        });

      if (agentError) throw agentError;

      // Add initial note if provided
      if (notes.trim()) {
        const { data: newAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", tempUserId)
          .single();

        if (newAgent) {
          await supabase
            .from("agent_notes")
            .insert({
              agent_id: newAgent.id,
              note: notes,
              created_by: user?.id,
            });
        }
      }

      // Send welcome email
      try {
        await supabase.functions.invoke("welcome-new-agent", {
          body: { agentName: `${firstName} ${lastName}`, agentEmail: email },
        });
      } catch (emailError) {
        console.log("Welcome email skipped:", emailError);
      }

      toast.success("Agent added successfully!");
      setOpen(false);
      resetForm();
      onAgentAdded?.();
    } catch (error: any) {
      console.error("Error adding agent:", error);
      toast.error(error.message || "Failed to add agent");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setManagerId("");
    setNotes("");
    setStartDate("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          Add Agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manager">Assign to Manager *</Label>
            <Select value={managerId} onValueChange={setManagerId} required>
              <SelectTrigger>
                <SelectValue placeholder="Select a manager" />
              </SelectTrigger>
              <SelectContent>
                {managers.map((manager) => (
                  <SelectItem key={manager.id} value={manager.id}>
                    {manager.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Initial Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any initial notes about this agent..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Agent"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
