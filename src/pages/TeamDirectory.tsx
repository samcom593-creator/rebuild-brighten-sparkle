import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  Phone,
  Instagram,
  Users,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ManagersPanel } from "@/components/dashboard/ManagersPanel";

interface ManagerProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  instagramHandle?: string;
  avatarUrl?: string;
  city?: string;
  state?: string;
}

export default function TeamDirectory() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [manager, setManager] = useState<ManagerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchManagerInfo = async () => {
      if (!user) return;

      // Admins/managers see the full panel, agents see their specific manager
      if (isAdmin || isManager) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Get the current user's agent record
        const { data: agentData, error: agentError } = await supabase
          .from("agents")
          .select("invited_by_manager_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (agentError) {
          console.error("Error fetching agent:", agentError);
          setError("Could not load your team information.");
          setLoading(false);
          return;
        }

        if (!agentData?.invited_by_manager_id) {
          setError("You haven't been assigned to a manager yet.");
          setLoading(false);
          return;
        }

        // Get the manager's agent record to find their user_id
        const { data: managerAgent, error: managerAgentError } = await supabase
          .from("agents")
          .select("user_id")
          .eq("id", agentData.invited_by_manager_id)
          .maybeSingle();

        if (managerAgentError || !managerAgent?.user_id) {
          console.error("Error fetching manager agent:", managerAgentError);
          setError("Could not load manager information.");
          setLoading(false);
          return;
        }

        // Get the manager's profile
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", managerAgent.user_id)
          .maybeSingle();

        if (profileError || !profileData) {
          console.error("Error fetching manager profile:", profileError);
          setError("Could not load manager profile.");
          setLoading(false);
          return;
        }

        setManager({
          id: profileData.id,
          fullName: profileData.full_name || "Your Manager",
          email: profileData.email,
          phone: profileData.phone || undefined,
          instagramHandle: profileData.instagram_handle || undefined,
          avatarUrl: profileData.avatar_url || undefined,
          city: profileData.city || undefined,
          state: profileData.state || undefined,
        });
      } catch (err) {
        console.error("Unexpected error:", err);
        setError("An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    fetchManagerInfo();
  }, [user, isAdmin, isManager]);

  if (authLoading || loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  // Admin/Manager View - show all managers
  if (isAdmin || isManager) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Users className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">Team Directory</h1>
            </div>
            <p className="text-muted-foreground">
              View and manage all managers in your organization
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <ManagersPanel />
          </motion.div>
        </div>
      </DashboardLayout>
    );
  }

  // Agent View - show their specific manager
  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Team Directory</h1>
          </div>
          <p className="text-muted-foreground">
            Connect with your manager and get support
          </p>
        </motion.div>

        {error ? (
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Manager Assigned</h3>
            <p className="text-muted-foreground">{error}</p>
          </GlassCard>
        ) : manager ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <GlassCard className="p-8">
              <div className="flex flex-col items-center text-center mb-8">
                <Avatar className="h-24 w-24 mb-4 border-4 border-primary/20">
                  <AvatarImage src={manager.avatarUrl} alt={manager.fullName} />
                  <AvatarFallback className="text-2xl bg-primary/20 text-primary">
                    {manager.fullName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-2xl font-bold">{manager.fullName}</h2>
                <p className="text-muted-foreground">Your Manager</p>
                {manager.city && manager.state && (
                  <p className="text-sm text-muted-foreground mt-1">
                    📍 {manager.city}, {manager.state}
                  </p>
                )}
              </div>

              <div className="space-y-4">
                {/* Email */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground">Email</p>
                    <a
                      href={`mailto:${manager.email}`}
                      className="font-medium text-primary hover:underline truncate block"
                    >
                      {manager.email}
                    </a>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`mailto:${manager.email}`}>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>

                {/* Phone */}
                {manager.phone && (
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Phone className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <a
                        href={`tel:${manager.phone}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {manager.phone}
                      </a>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${manager.phone}`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                )}

                {/* Instagram */}
                {manager.instagramHandle && (
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Instagram className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Instagram</p>
                      <a
                        href={`https://instagram.com/${manager.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        @{manager.instagramHandle}
                      </a>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`https://instagram.com/${manager.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                )}

                {/* No phone or Instagram */}
                {!manager.phone && !manager.instagramHandle && (
                  <div className="p-4 rounded-lg bg-muted/30 border border-border text-center">
                    <p className="text-sm text-muted-foreground">
                      Your manager hasn't added their phone or Instagram yet.
                      You can reach out via email for now.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-border">
                <div className="bg-primary/10 rounded-lg p-4 text-center">
                  <p className="text-sm text-primary font-medium">
                    💡 Need help with training, leads, or onboarding? Reach out
                    to your manager anytime!
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
