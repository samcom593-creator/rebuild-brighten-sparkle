import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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

export function ProfileSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    bio: "",
    instagramHandle: "",
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [notifications, setNotifications] = useState({
    emailNewApplication: true,
    emailTeamUpdates: true,
    emailWeeklyDigest: false,
  });

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
      });
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile]);

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
        })
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
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
        redirectTo: "https://apex-financial.org/agent-portal",
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-2xl font-bold mb-2">Profile Settings</h2>
        <p className="text-muted-foreground mb-4">
          Update your contact information and preferences
        </p>
        {/* Optional fields banner */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-sm text-muted-foreground">
            💡 <strong>Quick tip:</strong> Only your name and email are required. All other fields (phone, Instagram, bio, photo) are optional and can be completed at any time.
          </p>
        </div>
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

          {/* Password Reset Section */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Need to change your password?</p>
                <p className="text-sm text-muted-foreground">
                  We'll send a reset link to your email
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handlePasswordReset}
                disabled={resetLoading}
              >
                {resetLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                {resetLoading ? "Sending..." : "Reset Password"}
              </Button>
            </div>
          </div>
        </form>
      </GlassCard>

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
    </div>
  );
}
