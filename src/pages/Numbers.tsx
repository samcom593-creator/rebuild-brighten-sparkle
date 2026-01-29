import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Mail, Phone, User, LogIn, Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompactProductionEntry } from "@/components/dashboard/CompactProductionEntry";
import { CompactLeaderboard } from "@/components/dashboard/CompactLeaderboard";
import { AgentRankBadge } from "@/components/dashboard/AgentRankBadge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
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
  
  // Signup form state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");

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
        // User exists but no agent record - don't set authenticated
        // This shows login UI instead of broken form
        setAgentId(null);
        setIsAuthenticated(false);
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
    return <SkeletonLoader variant="page" />;
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
            <div className="flex items-center justify-center gap-2 mt-0.5">
              <p className="text-xs text-muted-foreground">
                Welcome, {agentName}
              </p>
              <AgentRankBadge agentId={agentId} size="sm" />
            </div>
          </motion.div>

          {/* Stat Entry */}
          <CompactProductionEntry 
            agentId={agentId} 
            agentName={agentName}
          />

          {/* Leaderboard */}
          <CompactLeaderboard currentAgentId={agentId} />

          {/* Share Link Footer */}
          <div className="text-center text-xs text-muted-foreground py-4 flex items-center justify-center gap-2">
            <Link2 className="h-3 w-3" />
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/numbers`);
                toast.success("Link copied to clipboard!");
              }}
              className="underline hover:text-primary transition-colors"
            >
              Share this page with your team
            </button>
          </div>
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
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
                toast.error("Please fill in all fields");
                return;
              }
              if (newPassword.length < 6) {
                toast.error("Password must be at least 6 characters");
                return;
              }
              
              setAuthenticating(true);
              try {
                const { data, error } = await supabase.functions.invoke("create-new-agent-account", {
                  body: {
                    email: newEmail.trim(),
                    password: newPassword,
                    fullName: newName.trim(),
                    phone: newPhone.trim() || undefined,
                  },
                });

                if (error) throw error;
                if (data.error) throw new Error(data.error);

                toast.success("Account created! Logging you in...");
                
                // Auto-login after account creation
                const { error: signInError } = await supabase.auth.signInWithPassword({
                  email: newEmail.trim().toLowerCase(),
                  password: newPassword,
                });

                if (signInError) {
                  toast.error("Account created but login failed. Please try logging in.");
                  setNeedsAccount(false);
                  setIdentifier(newEmail);
                }
              } catch (error: any) {
                console.error("Signup error:", error);
                toast.error(error.message || "Failed to create account");
              } finally {
                setAuthenticating(false);
              }
            }} className="space-y-3">
              <div className="text-center mb-2">
                <p className="text-sm text-muted-foreground">Create your agent account</p>
              </div>
              <div>
                <Label htmlFor="newName" className="text-xs flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Full Name
                </Label>
                <Input
                  id="newName"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="John Smith"
                  className="h-11"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="newEmail" className="text-xs flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-11"
                />
              </div>
              <div>
                <Label htmlFor="newPhone" className="text-xs flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  Phone (optional)
                </Label>
                <Input
                  id="newPhone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="h-11"
                />
              </div>
              <div>
                <Label htmlFor="newPassword" className="text-xs flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11"
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
                  setNewName("");
                  setNewEmail("");
                  setNewPhone("");
                  setNewPassword("");
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
