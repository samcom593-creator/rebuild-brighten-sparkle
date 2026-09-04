// PublicAgentLanding · /agent/:userId — the actual PUBLIC landing page that
// shows when prospects open an agent's calling-card link. No auth required.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Phone, Mail, MapPin, Instagram, Globe, Sparkles, Shield, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PublicProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
  photo_url: string | null;
}

interface AgentStatus {
  license_status: string | null;
  status: string | null;
}

export default function PublicAgentLanding() {
  const { userId } = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!userId) { setLoading(false); return; }
      try {
        const [profileRes, agentRes] = await Promise.all([
          supabase
            .from("profiles" as any)
            .select("full_name, email, phone, avatar_url, bio, city, state, instagram_handle, photo_url")
            .eq("user_id", userId)
            .maybeSingle(),
          // Wave-6 brand-truth: data-bind the "Licensed · Active Producer" badge
          // to actual agent state. Without this, the badge ships always-on for
          // any profile that happens to render — a fake credential claim on a
          // public surface (regulator-visible if an unlicensed agent shares
          // their card link before getting their NPN).
          supabase
            .from("agents" as any)
            .select("license_status, status")
            .eq("user_id", userId)
            .maybeSingle(),
        ]);
        setProfile(profileRes.data as unknown as PublicProfile);
        setAgent(agentRes.data as unknown as AgentStatus);
        if (profileRes.data) {
          const name = (profileRes.data as any).full_name || "APEX Agent";
          document.title = `${name} · APEX Financial`;
        }
      } catch {
        setProfile(null);
        setAgent(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <p className="text-amber-400 text-13 animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center p-6">
        <div className="text-center">
          <Shield className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-22 text-foreground font-bold mb-2">APEX Financial</h1>
          <p className="text-13 text-white/70">This producer profile is not available.</p>
          <a href="https://apex-financial.org" className="inline-block mt-4 px-4 py-2 bg-amber-500 text-slate-900 rounded-lg text-13 font-bold">
            Visit Apex Financial →
          </a>
        </div>
      </div>
    );
  }

  const name = profile.full_name || "APEX Producer";
  const avatar = profile.avatar_url || profile.photo_url;

  return (
    <div className="min-h-screen bg-card text-foreground">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-amber-900 px-6 pt-16 pb-12 text-center">
        {avatar ? (
          <img src={avatar} alt={name} className="h-28 w-28 rounded-full object-cover mx-auto ring-4 ring-amber-400/40 mb-4" />
        ) : (
          <div className="h-28 w-28 rounded-full bg-amber-500/30 mx-auto ring-4 ring-amber-400/40 mb-4 flex items-center justify-center text-28 font-bold">
            {name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
        )}
        <p className="text-11 uppercase tracking-[0.3em] text-amber-300 mb-2">APEX Financial Producer</p>
        <h1 className="text-26 font-bold leading-tight">{name}</h1>
        {(profile.city || profile.state) && (
          <p className="text-13 text-white/60 mt-2 flex items-center justify-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {[profile.city, profile.state].filter(Boolean).join(", ")}
          </p>
        )}
        {agent?.license_status === "licensed" && agent?.status === "active" ? (
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-slate-900 rounded-full text-11 font-bold">
            <Star className="h-3 w-3" /> Licensed · Active Producer
          </div>
        ) : null}
      </div>

      {/* Bio */}
      {profile.bio && (
        <div className="max-w-2xl mx-auto px-6 py-8 border-b border-border">
          <p className="text-10 uppercase tracking-[0.25em] text-amber-400 mb-3 text-center">About Me</p>
          <p className="text-14 text-white/85 leading-relaxed whitespace-pre-line text-center">
            {profile.bio}
          </p>
        </div>
      )}

      {/* Contact CTAs */}
      <div className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-10 uppercase tracking-[0.25em] text-amber-400 mb-4 text-center">Get in Touch</p>
        <div className="space-y-3">
          {profile.phone && (
            <a href={`tel:${profile.phone}`} className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500 text-white font-bold text-15 hover:bg-emerald-600 transition-all shadow-lg">
              <Phone className="h-5 w-5" />
              <span>Call {profile.phone}</span>
            </a>
          )}
          {profile.email && (
            <a href={`mailto:${profile.email}`} className="flex items-center gap-3 p-4 rounded-xl bg-amber-500 text-slate-900 font-bold text-15 hover:bg-amber-600 transition-all shadow-lg">
              <Mail className="h-5 w-5" />
              <span className="truncate">Email Me</span>
            </a>
          )}
          {profile.instagram_handle && (
            <a
              href={`https://instagram.com/${profile.instagram_handle.replace("@", "")}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-xl bg-foreground/10 border border-border text-foreground font-bold text-15 hover:bg-white/20 transition-all"
            >
              <Instagram className="h-5 w-5" />
              <span>{profile.instagram_handle}</span>
            </a>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-6 py-8 text-center">
        <p className="text-11 text-foreground/40 uppercase tracking-[0.25em]">Hold the Standard · Average is the disease</p>
        <p className="text-10 text-foreground/30 mt-2">
          APEX Financial · <a href="https://apex-financial.org" className="text-amber-400 hover:underline">apex-financial.org</a>
        </p>
      </div>
    </div>
  );
}
