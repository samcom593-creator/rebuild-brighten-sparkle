import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, StickyNote, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ApplicantNotesProps {
  applicationId: string;
  applicantName: string;
  initialNotes: string | null;
  onClose: () => void;
  onSave: (notes: string) => void;
}

export function ApplicantNotes({
  applicationId,
  applicantName,
  initialNotes,
  onClose,
  onSave,
}: ApplicantNotesProps) {
  const [notes, setNotes] = useState(initialNotes || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    
    const { error } = await supabase
      .from("applications")
      .update({ notes })
      .eq("id", applicationId);

    if (error) {
      toast.error("Failed to save notes");
    } else {
      toast.success("Notes saved");
      onSave(notes);
    }
    
    setIsSaving(false);
  };

  const addTimestamp = () => {
    const timestamp = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    setNotes((prev) => `${prev}${prev ? "\n" : ""}[${timestamp}] `);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg"
        >
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <StickyNote className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Notes for {applicantName}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about calls, interviews, follow-ups..."
              className="min-h-[200px] bg-input mb-4 resize-none"
            />

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={addTimestamp}
              >
                Add Timestamp
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Notes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
