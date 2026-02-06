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
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [managerId, setManagerId] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<"licensed" | "unlicensed" | "in_progress">("unlicensed");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");

  useEffect(() => {
    if (open) {
      fetchManagers();
    }
  }, [open]);

  const fetchManagers = async () => {
    setLoadingManagers(true);
    try {
      // Use the edge function that bypasses RLS
      const { data, error } = await supabase.functions.invoke("get-active-managers");

      if (error) {
        console.error("Error fetching managers:", error);
        toast.error("Failed to load managers");
        return;
      }

      if (data?.managers && Array.isArray(data.managers)) {
        setManagers(data.managers);

        // Pre-select current user's agent record if they're a manager
        if (user) {
          const { data: currentAgent } = await supabase
            .from("agents")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();

          if (currentAgent) {
            const isCurrentUserManager = data.managers.some((m: Manager) => m.id === currentAgent.id);
            if (isCurrentUserManager) {
              setManagerId(currentAgent.id);
            } else if (data.managers.length > 0) {
              setManagerId(data.managers[0].id);
            }
          } else if (data.managers.length > 0) {
            setManagerId(data.managers[0].id);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching managers:", error);
      toast.error("Failed to load managers");
    } finally {
      setLoadingManagers(false);
    }
  };

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName || !lastName || !email || !phone || !managerId) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("add-agent", {
        body: {
          firstName,
          lastName,
          email,
          phone,
          managerId,
          licenseStatus,
          notes: notes.trim() || undefined,
          startDate: startDate || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          instagramHandle: instagramHandle.trim() || undefined,
        },
      });

      if (error) {
        console.error("Error adding agent:", error);
        toast.error(error.message || "Failed to add agent");
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success(data?.message || "Agent added successfully!");
      setOpen(false);
      resetForm();
      onAgentAdded?.();
    } catch (error: unknown) {
      console.error("Error adding agent:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to add agent";
      toast.error(errorMessage);
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
    setLicenseStatus("unlicensed");
    setNotes("");
    setStartDate("");
    setCity("");
    setState("");
    setInstagramHandle("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          Add Agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Name Row */}
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

          {/* Contact Row */}
          <div className="grid grid-cols-2 gap-4">
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
                onChange={handlePhoneChange}
                placeholder="(555) 123-4567"
                required
              />
            </div>
          </div>

          {/* Manager & License Status Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="manager">Assign to Manager *</Label>
              <Select value={managerId} onValueChange={setManagerId} required>
                <SelectTrigger>
                  <SelectValue placeholder={loadingManagers ? "Loading..." : "Select a manager"} />
                </SelectTrigger>
                <SelectContent>
                  {loadingManagers ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : managers.length === 0 ? (
                    <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                      No managers available
                    </div>
                  ) : (
                    managers.map((manager) => (
                      <SelectItem key={manager.id} value={manager.id}>
                        {manager.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseStatus">License Status</Label>
              <Select value={licenseStatus} onValueChange={(v) => setLicenseStatus(v as typeof licenseStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlicensed">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Unlicensed</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="in_progress">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>In Progress</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="licensed">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Licensed</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {licenseStatus === "licensed" 
                  ? "Agent already has their insurance license"
                  : licenseStatus === "in_progress"
                  ? "Agent is currently working on getting licensed"
                  : "Agent needs to complete the licensing process"}
              </p>
            </div>
          </div>

          {/* Location Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="New York"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="NY"
              />
            </div>
          </div>

          {/* Start Date & Instagram Row */}
          <div className="grid grid-cols-2 gap-4">
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
              <Label htmlFor="instagram">Instagram Handle</Label>
              <Input
                id="instagram"
                value={instagramHandle}
                onChange={(e) => setInstagramHandle(e.target.value)}
                placeholder="@username"
              />
            </div>
          </div>

          {/* Notes */}
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

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || managers.length === 0}>
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
