import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Save,
  Loader2,
  Bell,
  Check,
  KeyRound,
  Instagram,
  Eye,
  EyeOff,
  Trash2,
  BellRing,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/glass-card";
import { AvatarUpload } from "@/components/dashboard/AvatarUpload";
import { toast } from "@/hooks/use-toast";
import { getAllFlags, setFeatureFlag, FEATURE_FLAG_LABELS, type FeatureFlagName } from "@/lib/featureFlags";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARRIER_OPTIONS } from "@/lib/carrierOptions";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { MessageSquare } from "lucide-react";

function DiscordWebhookSection() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("automation_settings" as any)
        .select("*")
        .eq("name", "Discord Webhook")
        .maybeSingle();
      if (data) setWebhookUrl((data as any).description || "");
      setLoaded(true);
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("automation_settings" as any)
        .select("id")
        .eq("name", "Discord Webhook")
        .maybeSingle();

      if (existing) {
        await (supabase.from("automation_settings" as any) as any)
          .update({ description: webhookUrl })
          .eq("id", (existing as any).id);
      } else {
        await supabase.from("automation_settings" as any).insert({
          name: "Discord Webhook",
          description: webhookUrl,
          schedule: "On events",
          enabled: !!webhookUrl,
        } as any);
      }
      toast({ title: "Discord webhook saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <GlassCard className="p-6">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-indigo-400" />
        Discord Integration
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Paste your Discord channel webhook URL to receive deal alerts, hire announcements, and milestone notifications.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="https://discord.com/api/webhooks/..."
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="flex-1"
        />
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save
        </Button>
      </div>
    </GlassCard>
  );
}

export function ProfileSettings() {
  const { user, profile, refreshProfile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const passwordSectionRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const isRecovery = searchParams.get("recovery") === "true";
  const forcePasswordChange = searchParams.get("force_password_change") === "true";
  const { supported: pushSupported, isSubscribed, loading: pushLoading, subscribe, unsubscribe } = usePushNotifications();
  
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    bio: "",
    instagramHandle: "",
    carrier: "",
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [notifications, setNotifications] = useState({
    emailNewApplication: true,
    emailTeamUpdates: true,
    emailWeeklyDigest: false,
  });

  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem("apex_sound_enabled") !== "false"; } catch { return true; }
  });

  const [featureFlagsState, setFeatureFlagsState] = useState(() => getAllFlags());

  useEffect(() => {
    if (profile) {
      setFormData({
        fullName: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        city: profile.city || "",
        state: profile.state || "",
        bio: profile.bio || "",
        instagramHandle: profile.instagram_handle || "",
        carrier: (profile as any).carrier || "",
      });
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile]);

  // Auto-scroll to password section when arriving from recovery link or forced change
  useEffect(() => {
    if ((isRecovery || forcePasswordChange) && passwordSectionRef.current) {
      setTimeout(() => {
        passwordSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 500);
    }
  }, [isRecovery, forcePasswordChange]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      // Clean Instagram handle (remove @ if present)
      let instagramHandle = formData.instagramHandle.trim();
      if (instagramHandle.startsWith("@")) {
        instagramHandle = instagramHandle.substring(1);
      }

      // Check if email changed
      const emailChanged = formData.email !== profile?.email;

      // Update profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          city: formData.city,
          state: formData.state,
          bio: formData.bio,
          instagram_handle: instagramHandle || null,
          carrier: formData.carrier || null,
        } as any)
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      // If email changed, also update auth email
      if (emailChanged) {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
            body: JSON.stringify({ newEmail: formData.email }),
          }
        );

        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "Failed to update email");
        }
      }

      await refreshProfile();
      setSaved(true);
      toast({
        title: "Profile Updated",
        description: emailChanged 
          ? "Your profile and email have been saved successfully."
          : "Your profile has been saved successfully.",
      });

      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      console.error("Error updating profile:", err);
      toast({
        title: "Error",
        description: err.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword.length < 6) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords Don't Match",
        description: "Please make sure both passwords match.",
        variant: "destructive",
      });
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      // Mark portal_password_set = true in the agents table
      if (user) {
        await supabase
          .from("agents")
          .update({ portal_password_set: true })
          .eq("user_id", user.id);
      }

      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      toast({
        title: "Password Updated! 🔐",
        description: "Your password has been changed successfully.",
      });

      // If this was a forced password change, redirect to dashboard
      if (forcePasswordChange) {
        setTimeout(() => navigate("/dashboard", { replace: true }), 1000);
        return;
      }

      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: any) {
      console.error("Error updating password:", err);
      toast({
        title: "Error",
        description: err.message || "Failed to update password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!formData.email) {
      toast({
        title: "No Email",
        description: "Please enter your email address first.",
        variant: "destructive",
      });
      return;
    }

    setResetLoading(true);
    try {
      // Use our custom edge function to send branded reset email via Resend
      const { error } = await supabase.functions.invoke("send-password-reset", {
        body: { email: formData.email, type: "reset" },
      });

      if (error) throw error;

      toast({
        title: "Password Reset Sent! 📧",
        description: `Check ${formData.email} for a link to reset your password.`,
      });
    } catch (err: any) {
      console.error("Error sending password reset:", err);
      toast({
        title: "Error",
        description: err.message || "Failed to send password reset. Please try again.",
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {forcePasswordChange && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 mb-4"
        >
          <h3 className="font-bold text-amber-400 flex items-center gap-2 mb-1">
            🔐 Change Your Password
          </h3>
          <p className="text-sm text-muted-foreground">
            For security, you must change your default password before continuing. Scroll down to the password section below.
          </p>
        </motion.div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-2xl font-bold mb-2">Profile Settings</h2>
        <p className="text-muted-foreground mb-4">
          Update your contact information and preferences
        </p>
        {!forcePasswordChange && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <p className="text-sm text-muted-foreground">
              💡 <strong>Quick tip:</strong> Only your name and email are required. All other fields (phone, Instagram, bio, photo) are optional and can be completed at any time.
            </p>
          </div>
        )}
      </motion.div>

      {/* Profile Form */}
      <GlassCard className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Upload Section */}
          <div className="flex flex-col items-center pb-6 border-b border-border">
            {user && (
              <AvatarUpload
                userId={user.id}
                currentAvatarUrl={avatarUrl}
                fullName={formData.fullName}
                onAvatarChange={(newUrl) => {
                  setAvatarUrl(newUrl);
                  refreshProfile();
                }}
              />
            )}
            <div className="text-center mt-4">
              <h3 className="font-semibold">{formData.fullName || "Your Name"}</h3>
              <p className="text-sm text-muted-foreground">{formData.email}</p>
              {formData.instagramHandle && (
                <a 
                  href={`https://instagram.com/${formData.instagramHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  @{formData.instagramHandle}
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleChange}
                  className="pl-10"
                  placeholder="John Doe"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="pl-10"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="pl-10"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="pl-10"
                  placeholder="Los Angeles"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                name="state"
                value={formData.state}
                onChange={handleChange}
                placeholder="CA"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="instagramHandle" className="flex items-center gap-2">
              <Instagram className="h-4 w-4 text-primary" />
              Instagram Handle
            </Label>
            <Input
              id="instagramHandle"
              name="instagramHandle"
              value={formData.instagramHandle}
              onChange={handleChange}
              placeholder="@yourhandle"
            />
            <p className="text-xs text-muted-foreground">
              Your Instagram is shared with applicants who select you as their referrer
            </p>
          </div>

          {/* Mobile Carrier */}
          <div className="space-y-2">
            <Label htmlFor="carrier" className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              Mobile Carrier
            </Label>
            <Select
              value={formData.carrier || undefined}
              onValueChange={(value) => {
                setFormData((prev) => ({ ...prev, carrier: value }));
                setSaved(false);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select your carrier" />
              </SelectTrigger>
              <SelectContent>
                {CARRIER_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Enables text message alerts for deals, milestones, and reminders
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              name="bio"
              value={formData.bio}
              onChange={handleChange}
              placeholder="Tell us a bit about yourself..."
              rows={3}
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {loading ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </Button>

          {/* Password Change Section */}
          <div ref={passwordSectionRef} className="pt-4 border-t border-border space-y-4">
            {isRecovery && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                🔐 <strong>Password Recovery:</strong> Set your new password below.
              </div>
            )}
            <h4 className="font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Change Password
            </h4>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="button"
                onClick={handlePasswordChange}
                disabled={passwordLoading || !newPassword || !confirmPassword}
                className="w-full"
              >
                {passwordLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : passwordSaved ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                {passwordLoading ? "Updating..." : passwordSaved ? "Updated!" : "Update Password"}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Or{" "}
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={resetLoading}
                  className="text-primary hover:underline"
                >
                  {resetLoading ? "Sending..." : "send a reset link to your email"}
                </button>
              </p>
            </div>
          </div>
        </form>
      </GlassCard>

      {/* Push Notifications */}
      {pushSupported && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" />
            Push Notifications
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {isSubscribed ? "Notifications Enabled" : "Enable Push Notifications"}
              </p>
              <p className="text-sm text-muted-foreground">
                {isSubscribed
                  ? "You'll receive instant alerts for deals, milestones, and reminders"
                  : "Get instant alerts on your device — no app download needed"}
              </p>
            </div>
            <Button
              variant={isSubscribed ? "outline" : "default"}
              size="sm"
              disabled={pushLoading}
              onClick={async () => {
                if (isSubscribed) {
                  await unsubscribe();
                  toast({ title: "Notifications Disabled", description: "You won't receive push notifications anymore." });
                } else {
                  const success = await subscribe();
                  if (success) {
                    toast({ title: "Notifications Enabled! 🔔", description: "You'll now receive instant alerts." });
                  } else {
                    toast({ title: "Permission Denied", description: "Please allow notifications in your browser settings.", variant: "destructive" });
                  }
                }
              }}
            >
              {pushLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isSubscribed ? (
                "Disable"
              ) : (
                "Enable"
              )}
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Notification Preferences */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Notification Preferences
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">New Application Alerts</p>
              <p className="text-sm text-muted-foreground">
                Get notified when new applications come in
              </p>
            </div>
            <Switch
              checked={notifications.emailNewApplication}
              onCheckedChange={(checked) =>
                setNotifications((prev) => ({
                  ...prev,
                  emailNewApplication: checked,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Team Updates</p>
              <p className="text-sm text-muted-foreground">
                Receive updates about your team members
              </p>
            </div>
            <Switch
              checked={notifications.emailTeamUpdates}
              onCheckedChange={(checked) =>
                setNotifications((prev) => ({
                  ...prev,
                  emailTeamUpdates: checked,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Weekly Digest</p>
              <p className="text-sm text-muted-foreground">
                Get a weekly summary of your performance
              </p>
            </div>
            <Switch
              checked={notifications.emailWeeklyDigest}
              onCheckedChange={(checked) =>
                setNotifications((prev) => ({
                  ...prev,
                  emailWeeklyDigest: checked,
                }))
              }
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Note: Notification preferences are stored locally for now.
        </p>
      </GlassCard>

      {/* Sound Effects Toggle */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          🔊 Sound Effects
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Enable Sound Effects</p>
            <p className="text-sm text-muted-foreground">
              Play sounds on actions like stage changes, XP gains, and celebrations
            </p>
          </div>
          <Switch
            checked={soundEnabled}
            onCheckedChange={(checked) => {
              setSoundEnabled(checked);
              localStorage.setItem("apex_sound_enabled", String(checked));
            }}
          />
        </div>
      </GlassCard>

      {/* Feature Flags — Admin Only */}
      {isAdmin && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            ⚙️ Feature Flags
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Toggle system features on or off. Changes take effect immediately.
          </p>
          <div className="space-y-3">
            {(Object.keys(featureFlagsState) as FeatureFlagName[]).map((flag) => (
              <div key={flag} className="flex items-center justify-between">
                <p className="font-medium text-sm">{FEATURE_FLAG_LABELS[flag]}</p>
                <Switch
                  checked={featureFlagsState[flag]}
                  onCheckedChange={(checked) => {
                    setFeatureFlag(flag, checked);
                    setFeatureFlagsState((prev) => ({ ...prev, [flag]: checked }));
                  }}
                />
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Admin Only: WhatsApp Group Link */}
      {isAdmin && (
        <WhatsAppGroupSection />
      )}

      {/* Admin Only: Discord Webhook */}
      {isAdmin && (
        <DiscordWebhookSection />
      )}

      {/* Admin Only: Deleted Leads Vault */}
      {isAdmin && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Deleted Leads Vault
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            View, restore, or permanently delete leads that have been removed from the Lead Center.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/dashboard/settings/deleted-leads")}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            View Deleted Leads
          </Button>
        </GlassCard>
      )}
    </div>
  );
}
