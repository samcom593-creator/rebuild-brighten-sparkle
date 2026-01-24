import { useEffect, useState } from "react";
import { Clock, Mail, Phone, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ContactHistory {
  id: string;
  contact_type: string;
  created_at: string;
  email_template: string | null;
}

interface LastContactedBadgeProps {
  applicationId: string;
  className?: string;
}

export function LastContactedBadge({ applicationId, className }: LastContactedBadgeProps) {
  const [lastContact, setLastContact] = useState<ContactHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLastContact();
  }, [applicationId]);

  const fetchLastContact = async () => {
    try {
      const { data, error } = await supabase
        .from("contact_history")
        .select("id, contact_type, created_at, email_template")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setLastContact(data);
      }
    } catch (err) {
      console.error("Error fetching last contact:", err);
    } finally {
      setLoading(false);
    }
  };

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // Return formatted date for older contacts
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getContactIcon = (type: string) => {
    switch (type) {
      case "email":
      case "cold_outreach":
      case "followup":
        return <Mail className="h-3 w-3" />;
      case "call":
        return <Phone className="h-3 w-3" />;
      default:
        return <MessageSquare className="h-3 w-3" />;
    }
  };

  const getContactLabel = (contact: ContactHistory) => {
    if (contact.email_template) {
      const templateLabels: Record<string, string> = {
        cold_licensed: "Cold (L)",
        cold_unlicensed: "Cold (UL)",
        followup1_licensed: "F/U #1",
        followup2_licensed: "F/U #2",
      };
      return templateLabels[contact.email_template] || contact.contact_type;
    }
    return contact.contact_type;
  };

  if (loading || !lastContact) {
    return null;
  }

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md",
      className
    )}>
      {getContactIcon(lastContact.contact_type)}
      <span>Last: {getContactLabel(lastContact)}</span>
      <span className="text-muted-foreground/70">•</span>
      <span>{getTimeAgo(lastContact.created_at)}</span>
    </div>
  );
}
