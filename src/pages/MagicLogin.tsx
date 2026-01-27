import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

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

      // Call verify edge function
      const { data, error: fnError } = await supabase.functions.invoke("verify-magic-link", {
        body: { token },
      });

      if (fnError || !data?.success) {
        const errorData = data || {};
        setError({
          message: errorData.error || fnError?.message || "Failed to verify link",
          code: errorData.code || "UNKNOWN_ERROR",
        });
        setState("error");
        return;
      }

      setDestination(data.destination === "numbers" ? "apex-daily-numbers" : "agent-portal");
      setState("signing-in");

      // Use the auth link returned from the edge function
      if (data.authLink) {
        // Redirect to Supabase auth link which will handle the session
        window.location.href = data.authLink;
        return;
      }

      // Fallback: try OTP verification if we have the token hash
      if (data.tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: "magiclink",
        });

        if (verifyError) {
          console.error("OTP verification failed:", verifyError);
          setError({
            message: "Login failed. Please try again or use manual login.",
            code: "AUTH_FAILED",
          });
          setState("error");
          return;
        }
      }

      setState("success");

      // Redirect to destination after brief success display
      setTimeout(() => {
        navigate(`/${data.destination === "numbers" ? "apex-daily-numbers" : "agent-portal"}`, {
          replace: true,
        });
      }, 1000);
    } catch (err: any) {
      console.error("Magic login error:", err);
      setError({
        message: err.message || "An unexpected error occurred",
        code: "UNKNOWN_ERROR",
      });
      setState("error");
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
              {state === "signing-in" && "Setting up your session..."}
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
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
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

              <div className="space-y-3">
                <Button
                  onClick={() => navigate("/agent-login")}
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  Sign In Manually
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/")}
                  className="w-full"
                >
                  Go to Homepage
                </Button>
              </div>
            </div>
          )}

          {/* Success message */}
          {state === "success" && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Taking you to your {destination === "apex-daily-numbers" ? "Daily Numbers" : "Agent Portal"}...
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
