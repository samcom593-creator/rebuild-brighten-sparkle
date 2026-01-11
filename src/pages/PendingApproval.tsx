import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Clock, Mail, LogOut } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { GradientButton } from "@/components/ui/gradient-button";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

export default function PendingApproval() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <Crown className="h-10 w-10 text-primary" />
            <span className="text-2xl font-bold gradient-text">APEX Financial</span>
          </Link>
        </div>

        <GlassCard className="p-8 text-center">
          <div className="mb-6">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Clock className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Account Pending Approval</h1>
            <p className="text-muted-foreground">
              Your account has been created and is awaiting admin verification.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/50 border border-border mb-6">
            <div className="flex items-center gap-3 text-left">
              <Mail className="h-5 w-5 text-primary flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                You'll receive an email notification once your account has been approved by an administrator.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This usually takes 24-48 hours during business days.
            </p>

            <div className="flex flex-col gap-2">
              <Link to="/">
                <GradientButton className="w-full">
                  Back to Home
                </GradientButton>
              </Link>
              
              <Button 
                variant="ghost" 
                onClick={handleSignOut}
                className="text-muted-foreground"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
