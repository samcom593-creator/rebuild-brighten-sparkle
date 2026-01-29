import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Hash, Phone, LogOut, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import apexIcon from "@/assets/apex-icon.png";
import type { User } from "@supabase/supabase-js";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

interface AccountLinkFormProps {
  user: User | null;
  profile: Profile | null;
  onSuccess: () => void;
  onLogout: () => void;
}

export function AccountLinkForm({ user, profile, onSuccess, onLogout }: AccountLinkFormProps) {
  const [email, setEmail] = useState(profile?.email || user?.email || "");
  const [agentCode, setAgentCode] = useState("");
  const [phone, setPhone] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleLink = async (method: "email" | "code" | "phone") => {
    setIsLinking(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setError("You must be logged in to link your account");
        setIsLinking(false);
        return;
      }

      const payload = method === "email" 
        ? { email: email.trim() } 
        : method === "phone"
        ? { phone: phone.trim() }
        : { agentCode: agentCode.trim() };

      const { data, error: fnError } = await supabase.functions.invoke("link-account", {
        body: payload,
      });

      if (fnError) {
        console.error("Link error:", fnError);
        setError(fnError.message || "Failed to link account");
        setIsLinking(false);
        return;
      }

      if (data?.error) {
        setError(data.error);
        setIsLinking(false);
        return;
      }

      setSuccess(true);
      toast.success("Account linked successfully!");
      
      // Reload to refresh agent data
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      console.error("Link error:", err);
      setError(err.message || "An unexpected error occurred");
      setIsLinking(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md w-full"
        >
          <GlassCard className="p-8">
            <CheckCircle className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Account Linked!</h1>
            <p className="text-muted-foreground">
              Redirecting to your portal...
            </p>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md w-full"
      >
        <GlassCard className="p-8">
          <div className="relative mb-6">
            <img 
              src={apexIcon} 
              alt="Apex" 
              className="h-16 w-16 mx-auto"
            />
          </div>
          <h1 className="text-2xl font-bold mb-2">Link Your Account</h1>
          <p className="text-muted-foreground mb-6">
            Connect your login to your agent profile using your email or agent code.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Tabs defaultValue="email" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </TabsTrigger>
              <TabsTrigger value="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone
              </TabsTrigger>
              <TabsTrigger value="code" className="flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Code
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-4">
              <div className="text-left">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  Your registered email
                </label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full"
                />
              </div>
              <Button
                onClick={() => handleLink("email")}
                disabled={isLinking || !email.trim()}
                className="w-full"
                size="lg"
              >
                {isLinking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  "Link with Email"
                )}
              </Button>
            </TabsContent>

            <TabsContent value="phone" className="space-y-4">
              <div className="text-left">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  Your registered phone number
                </label>
                <Input
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter the phone number on file with your manager
                </p>
              </div>
              <Button
                onClick={() => handleLink("phone")}
                disabled={isLinking || phone.replace(/\D/g, "").length < 10}
                className="w-full"
                size="lg"
              >
                {isLinking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  "Link with Phone"
                )}
              </Button>
            </TabsContent>

            <TabsContent value="code" className="space-y-4">
              <div className="text-left">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  Agent code from your manager
                </label>
                <Input
                  type="text"
                  placeholder="ABC123"
                  value={agentCode}
                  onChange={(e) => setAgentCode(e.target.value.toUpperCase())}
                  className="w-full font-mono"
                />
              </div>
              <Button
                onClick={() => handleLink("code")}
                disabled={isLinking || !agentCode.trim()}
                className="w-full"
                size="lg"
              >
                {isLinking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  "Link with Code"
                )}
              </Button>
            </TabsContent>
          </Tabs>

          <div className="mt-6 pt-6 border-t border-border">
            <Button variant="ghost" onClick={onLogout} className="w-full">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
