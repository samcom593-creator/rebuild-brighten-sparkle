import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Download, Smartphone, Check, Share, Plus, MoreVertical, Crown, Mail, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Install() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/agent-portal", { replace: true });
        return;
      }
      setCheckingAuth(false);
    };
    checkAuth();

    // Check for stored email
    const storedEmail = localStorage.getItem("apex_agent_email");
    if (storedEmail) {
      setEmail(storedEmail);
    }

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Detect Android
    const android = /Android/.test(navigator.userAgent);
    setIsAndroid(android);

    // Listen for install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // Listen for app installed
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, [navigate]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter your email");
      return;
    }

    setIsLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      localStorage.setItem("apex_agent_email", normalizedEmail);

      // Call simple-login to get token for instant auth
      const { data, error } = await supabase.functions.invoke("simple-login", {
        body: { identifier: normalizedEmail }
      });

      if (error) throw error;

      // No account found - redirect to signup
      if (data?.needsAccount) {
        toast.error("No account found. Please sign up first.");
        navigate("/agent-signup");
        return;
      }

      // Password required - redirect to login page
      if (data?.requiresPassword) {
        toast.info("Password required for this account.");
        navigate("/agent-login");
        return;
      }

      // Success - verify OTP token to create session instantly
      if (data?.success && data?.tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: data.email,
          token_hash: data.tokenHash,
          type: "magiclink"
        });

        if (verifyError) {
          console.error("OTP verify error:", verifyError);
          toast.error("Login failed. Please try again.");
          return;
        }

        toast.success(`Welcome back${data.name ? `, ${data.name.split(' ')[0]}` : ''}!`);
        navigate("/agent-portal", { replace: true });
        return;
      }

      // Session returned directly (password login)
      if (data?.session) {
        await supabase.auth.setSession(data.session);
        toast.success(`Welcome back${data.name ? `, ${data.name.split(' ')[0]}` : ''}!`);
        navigate("/agent-portal", { replace: true });
        return;
      }

      toast.error("Login failed. Please try again.");
    } catch (err: any) {
      console.error("Login error:", err);
      toast.error("Failed to log in");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="glass border-border">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
                <Crown className="w-10 h-10 text-primary-foreground" />
              </div>
            </div>
            <CardTitle className="text-2xl gradient-text">APEX Numbers</CardTitle>
            <CardDescription>
              Enter your email to access your portal
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Email Login Form */}
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12 text-base"
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-semibold"
                disabled={isLoading}
              >
              {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  "Log In"
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Install for quick access
                </span>
              </div>
            </div>

            {isInstalled ? (
              <div className="text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  App installed! Open from home screen.
                </p>
              </div>
            ) : deferredPrompt ? (
              <Button onClick={handleInstall} variant="outline" className="w-full gap-2">
                <Download className="w-4 h-4" />
                Add to Home Screen
              </Button>
            ) : isIOS ? (
              <div className="space-y-3 text-sm">
                <p className="text-center font-medium text-muted-foreground">
                  <Smartphone className="w-4 h-4 inline mr-1" />
                  Install on iPhone
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Share className="w-4 h-4 shrink-0" />
                  <span>Tap Share → Add to Home Screen</span>
                </div>
              </div>
            ) : isAndroid ? (
              <div className="space-y-3 text-sm">
                <p className="text-center font-medium text-muted-foreground">
                  <Smartphone className="w-4 h-4 inline mr-1" />
                  Install on Android
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MoreVertical className="w-4 h-4 shrink-0" />
                  <span>Tap menu → Install app</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Works offline • Fast loading • One-tap access
        </p>
      </motion.div>
    </div>
  );
}