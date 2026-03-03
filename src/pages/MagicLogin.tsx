import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, CheckCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type LoginState = "verifying" | "signing-in" | "success" | "error";

interface ErrorInfo {
  message: string;
  code: string;
}

export default function MagicLogin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoginState>("verifying");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [destination, setDestination] = useState<string>("agent-portal");
  const [showResendForm, setShowResendForm] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setError({ message: "No login token provided", code: "MISSING_TOKEN" });
      setState("error");
      return;
    }

    verifyAndLogin(token);
  }, [searchParams]);

  const verifyAndLogin = async (token: string) => {
    try {
      setState("verifying");

      // Call verify edge function to get tokenHash
      const response = await supabase.functions.invoke("verify-magic-link", {
        body: { token },
      });

      const data = response.data;
      const fnError = response.error;

      if (fnError || !data?.success) {
        // Extract real error from edge function response body
        let errorMsg = "Failed to verify link";
        let errorCode = "UNKNOWN_ERROR";
        if (data?.error) {
          errorMsg = data.error;
          errorCode = data.code || "UNKNOWN_ERROR";
        } else if (fnError?.message) {
          errorMsg = fnError.message;
        }
        setError({ message: errorMsg, code: errorCode });
        setState("error");
        return;
      }

      const dest = data.destination === "numbers" 
        ? "apex-daily-numbers" 
        : data.destination === "course" 
          ? "onboarding-course" 
          : "agent-portal";
      setDestination(dest);
      setState("signing-in");

      // Use verifyOtp directly - no external redirect needed
      if (data.tokenHash && data.email) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: "magiclink",
        });

        if (verifyError) {
          console.error("verifyOtp error:", verifyError);
          
          // Auto-retry once on OTP expiry - get a fresh token
          if (verifyError.message?.includes("otp_expired") || verifyError.message?.includes("expired")) {
            console.log("OTP expired, retrying with fresh token...");
            const { data: retryData, error: retryFnError } = await supabase.functions.invoke("verify-magic-link", {
              body: { token },
            });
            
            if (!retryFnError && retryData?.success && retryData.tokenHash) {
              const { error: retryVerifyError } = await supabase.auth.verifyOtp({
                token_hash: retryData.tokenHash,
                type: "magiclink",
              });
              
              if (!retryVerifyError) {
                // Retry succeeded
                setState("success");
                setTimeout(() => navigate(`/${dest}`, { replace: true }), 500);
                return;
              }
            }
          }
          
          setError({
            message: "Session creation failed. Please try signing in manually.",
            code: "VERIFY_OTP_ERROR",
          });
          setState("error");
          return;
        }

        // Success! Navigate to destination
        setState("success");
        
        // Small delay for UX then navigate
        setTimeout(() => {
          navigate(`/${dest}`, { replace: true });
        }, 500);
        return;
      }

      // Fallback: If no tokenHash, show error
      setError({
        message: "Login link generation failed. Please try again.",
        code: "NO_TOKEN_HASH",
      });
      setState("error");
    } catch (err: any) {
      console.error("Magic login error:", err);
      setError({
        message: err.message || "An unexpected error occurred",
        code: "UNKNOWN_ERROR",
      });
      setState("error");
    }
  };

  const handleResendLink = async () => {
    if (!resendEmail.trim()) {
      toast.error("Please enter your email address");
      return;
    }

    setResending(true);
    try {
      // Find the agent by email and send a new magic link
      const { error: fnError } = await supabase.functions.invoke("send-password-reset", {
        body: { email: resendEmail.trim(), type: "magic_link" },
      });

      if (fnError) {
        toast.error("Failed to send new link. Please try again.");
      } else {
        toast.success("New login link sent! Check your email.");
        setShowResendForm(false);
      }
    } catch (err) {
      toast.error("Failed to send new link. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const handleRetry = () => {
    const token = searchParams.get("token");
    if (token) {
      setError(null);
      verifyAndLogin(token);
    }
  };

  const getErrorMessage = () => {
    if (!error) return "";

    switch (error.code) {
      case "EXPIRED":
        return "This login link has expired. Please request a new one or sign in manually.";
      case "ALREADY_USED":
        return "This link has already been used. Please sign in manually or request a new link.";
      case "INVALID_TOKEN":
        return "This link is invalid. Please check your email for the correct link.";
      case "NO_ACCOUNT":
        return "No account found. Please contact your manager to set up your portal access.";
      case "VERIFY_OTP_ERROR":
        return "We couldn't create your session. Please sign in manually.";
      default:
        return error.message;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {state === "verifying" && "Verifying Your Link..."}
              {state === "signing-in" && "Signing You In..."}
              {state === "success" && "Welcome Back!"}
              {state === "error" && "Login Issue"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {state === "verifying" && "Please wait while we verify your access."}
              {state === "signing-in" && "Creating your session..."}
              {state === "success" && "Redirecting to your portal..."}
              {state === "error" && "We encountered a problem with your login link."}
            </p>
          </div>

          {/* Status Display */}
          <div className="flex justify-center mb-8">
            {(state === "verifying" || state === "signing-in") && (
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            )}
            {state === "success" && (
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-accent-foreground" />
              </div>
            )}
            {state === "error" && (
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
            )}
          </div>

          {/* Error Details */}
          {state === "error" && (
            <div className="space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm text-foreground">{getErrorMessage()}</p>
              </div>

              {/* Resend Link Form */}
              {showResendForm ? (
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Enter your email to receive a new login link:</p>
                  <Input
                    type="email"
                    placeholder="your.email@example.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    className="w-full"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleResendLink}
                      disabled={resending}
                      className="flex-1"
                    >
                      {resending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Send Link
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowResendForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    className="w-full"
                  >
                    Try Again
                  </Button>
                  <Button
                    onClick={() => navigate("/agent-login")}
                    className="w-full"
                  >
                    Sign In Manually
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowResendForm(true)}
                    className="w-full text-muted-foreground"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send Me a Fresh Link
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Success message */}
          {state === "success" && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Taking you to your {destination === "apex-daily-numbers" ? "Daily Numbers" : destination === "onboarding-course" ? "Training Course" : "Agent Portal"}...
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              APEX Financial Empire
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
