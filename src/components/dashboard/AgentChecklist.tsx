import { useState } from "react";
import { Check, X, BookOpen, Phone, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AgentChecklistProps {
  agentId: string;
  hasTrainingCourse: boolean;
  hasDialerLogin: boolean;
  hasDiscordAccess: boolean;
  onUpdate?: () => void;
  readOnly?: boolean;
}

export function AgentChecklist({
  agentId,
  hasTrainingCourse,
  hasDialerLogin,
  hasDiscordAccess,
  onUpdate,
  readOnly = false,
}: AgentChecklistProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  const handleToggle = async (field: string, currentValue: boolean) => {
    if (readOnly) return;
    setUpdating(field);
    
    try {
      const { error } = await supabase
        .from("agents")
        .update({ [field]: !currentValue })
        .eq("id", agentId);

      if (error) throw error;
      
      toast.success(`${field.replace(/_/g, " ")} updated`);
      onUpdate?.();
    } catch (error) {
      console.error("Error updating checklist:", error);
      toast.error("Failed to update");
    } finally {
      setUpdating(null);
    }
  };

  const items = [
    {
      key: "has_training_course",
      label: "Training Course",
      icon: BookOpen,
      checked: hasTrainingCourse,
    },
    {
      key: "has_dialer_login",
      label: "Dialer Login",
      icon: Phone,
      checked: hasDialerLogin,
    },
    {
      key: "has_discord_access",
      label: "Discord Access",
      icon: MessageSquare,
      checked: hasDiscordAccess,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => handleToggle(item.key, item.checked)}
          disabled={readOnly || updating === item.key}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border",
            item.checked
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              : "bg-muted/50 text-muted-foreground border-border/50",
            !readOnly && "hover:opacity-80 cursor-pointer",
            updating === item.key && "opacity-50"
          )}
        >
          <item.icon className="h-3.5 w-3.5" />
          <span>{item.label}</span>
          {item.checked ? (
            <Check className="h-3 w-3 ml-1" />
          ) : (
            <X className="h-3 w-3 ml-1 opacity-50" />
          )}
        </button>
      ))}
    </div>
  );
}
