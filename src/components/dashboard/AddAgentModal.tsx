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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface Manager {
  id: string;
  name: string;
}

interface AddAgentModalProps {
  onAgentAdded?: () => void;
}

export function AddAgentModal({ onAgentAdded }: AddAgentModalProps) {
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);

  // Simplified form state - essentials only
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [managerId, setManagerId] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");

  useEffect(() => {
    if (open) {
      fetchManagers();
    }
  }, [open]);

  const fetchManagers = async () => {
    setLoadingManagers(true);
    try {
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
          licenseStatus: "unlicensed", // Default to unlicensed
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

      playSound("celebrate");
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Name Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                required
              />
            </div>
            <div className="space-y-1.5">
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

          {/* Email */}
          <div className="space-y-1.5">
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

          {/* Phone */}
          <div className="space-y-1.5">
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

          {/* Manager */}
          <div className="space-y-1.5">
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

          {/* Instagram (Optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="instagram">Instagram (optional)</Label>
            <Input
              id="instagram"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@username"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
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
