import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Mail, Phone, User, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompactProductionEntry } from "@/components/dashboard/CompactProductionEntry";
import { CompactLeaderboard } from "@/components/dashboard/CompactLeaderboard";
import { cn } from "@/lib/utils";

export default function Numbers() {
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  
  // Auth state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [crmData, setCrmData] = useState<{ name?: string; email?: string }>({});
  const [newName, setNewName] = useState("");

  // Check session on mount
  useEffect(() => {
    checkSession();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        loadAgentData(session.user.id);
      } else {
        setIsAuthenticated(false);
        setAgentId(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadAgentData(session.user.id);
    } else {
      setLoading(false);
    }
  };

  const loadAgentData = async (userId: string) => {
    try {
      const { data: agent } = await supabase
        .from("agents")
        .select("id, profile:profiles!agents_profile_id_fkey(full_name)")
        .eq("user_id", userId)
        .maybeSingle();

      if (agent) {
        setAgentId(agent.id);
        setAgentName(agent.profile?.full_name || "Agent");
        setIsAuthenticated(true);
      } else {
        // User exists but no agent record - could be new signup
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", userId)
          .maybeSingle();
        
        setAgentName(profile?.full_name || "Agent");
        // Still show as authenticated even without agent record
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error("Error loading agent data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSimpleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      toast.error("Please enter your email or phone");
      return;
    }

    setAuthenticating(true);

    try {
      const { data, error } = await supabase.functions.invoke("simple-login", {
        body: { identifier: identifier.trim(), password: password || undefined },
      });

      if (error) throw error;

      if (data.needsAccount) {
        setNeedsAccount(true);
        setCrmData({ name: data.crmName, email: data.crmEmail });
        toast.info(data.message || "Account setup needed");
        setAuthenticating(false);
        return;
      }

      if (data.requiresPassword) {
        setRequiresPassword(true);
        setCrmData({ name: data.name, email: data.email });
        toast.info("Please enter your password");
        setAuthenticating(false);
        return;
      }

      if (data.success && data.session) {
        // Password login returned a session directly
        await supabase.auth.setSession(data.session);
        toast.success(`Welcome back, ${data.name}!`);
        return;
      }

      if (data.success && data.tokenHash) {
        // Simple login - verify OTP
        const { data: otpResult, error: otpError } = await supabase.auth.verifyOtp({
          email: data.email,
          token: data.tokenHash,
          type: "magiclink",
        });

        if (otpError) {
          console.error("OTP verification failed:", otpError);
          toast.error("Login failed. Please try again.");
          setAuthenticating(false);
          return;
        }

        toast.success(`Welcome, ${data.name}!`);
      }
    } catch (error: any) {
      console.error("Simple login error:", error);
      toast.error(error.message || "Login failed");
    } finally {
      setAuthenticating(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      toast.error("Please enter your password");
      return;
    }

    setAuthenticating(true);

    try {
      const { data, error } = await supabase.functions.invoke("simple-login", {
        body: { identifier: crmData.email || identifier, password },
      });

      if (error) throw error;

      if (data.success && data.session) {
        await supabase.auth.setSession(data.session);
        toast.success(`Welcome back, ${data.name}!`);
      } else {
        toast.error("Invalid password");
      }
    } catch (error: any) {
      console.error("Password login error:", error);
      toast.error(error.message || "Login failed");
    } finally {
      setAuthenticating(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Authenticated view - show entry + leaderboard
  if (isAuthenticated && agentId) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-lg mx-auto p-4 space-y-4">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-2"
          >
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
              APEX Daily Numbers
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Welcome, {agentName}
            </p>
          </motion.div>

          {/* Stat Entry */}
          <CompactProductionEntry 
            agentId={agentId} 
            agentName={agentName}
          />

          {/* Leaderboard */}
          <CompactLeaderboard currentAgentId={agentId} />
        </div>
      </div>
    );
  }

  // Login view
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm"
      >
        <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border/50 p-6">
          {/* Logo */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
              APEX Daily Numbers
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter numbers in under 30 seconds
            </p>
          </div>

          {/* Password required form */}
          {requiresPassword ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-sm">Welcome back, <span className="font-semibold text-primary">{crmData.name}</span></p>
              </div>
              <div>
                <Label htmlFor="password" className="text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-12"
                  autoFocus
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 gap-2"
                disabled={authenticating}
              >
                {authenticating ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="h-5 w-5" />
                )}
                Sign In
              </Button>
              <button
                type="button"
                onClick={() => {
                  setRequiresPassword(false);
                  setPassword("");
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Use different account
              </button>
            </form>
          ) : needsAccount ? (
            /* Create account form */
            <form onSubmit={(e) => {
              e.preventDefault();
              toast.info("Account creation coming soon - please contact your manager");
            }} className="space-y-4">
              <div>
                <Label htmlFor="newName" className="text-xs">Your Name</Label>
                <Input
                  id="newName"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  className="h-12"
                  autoFocus
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 gap-2"
                disabled={authenticating}
              >
                {authenticating ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <User className="h-5 w-5" />
                )}
                Create Account
              </Button>
              <button
                type="button"
                onClick={() => {
                  setNeedsAccount(false);
                  setCrmData({});
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Use different email/phone
              </button>
            </form>
          ) : (
            /* Simple login form */
            <form onSubmit={handleSimpleLogin} className="space-y-4">
              <div>
                <Label htmlFor="identifier" className="text-xs flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email or Phone
                </Label>
                <Input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="email@example.com or (555) 123-4567"
                  className="h-12 text-base"
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 gap-2 text-base font-semibold"
                disabled={authenticating}
              >
                {authenticating ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="h-5 w-5" />
                )}
                Continue
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                No password required • Just enter & go
              </p>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
