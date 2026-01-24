import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquarePlus, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Note {
  id: string;
  note: string;
  createdAt: string;
  createdBy: string;
}

interface AgentNotesProps {
  agentId: string;
  onNoteAdded?: () => void;
  readOnly?: boolean;
}

export function AgentNotes({ agentId, onNoteAdded, readOnly = false }: AgentNotesProps) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (expanded) {
      fetchNotes();
    }
  }, [expanded, agentId]);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_notes")
        .select("id, note, created_at, created_by")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      // Fetch creator names
      const creatorIds = [...new Set(data?.map(n => n.created_by).filter(Boolean) || [])];
      let creatorMap = new Map<string, string>();
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", creatorIds);
        
        creatorMap = new Map(profiles?.map(p => [p.user_id, p.full_name || "Unknown"]) || []);
      }

      const notesWithCreators: Note[] = (data || []).map(n => ({
        id: n.id,
        note: n.note,
        createdAt: n.created_at,
        createdBy: n.created_by ? (creatorMap.get(n.created_by) || "Unknown") : "System",
      }));

      setNotes(notesWithCreators);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !user) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("agent_notes")
        .insert({
          agent_id: agentId,
          note: newNote.trim(),
          created_by: user.id,
        });

      if (error) throw error;

      toast.success("Note added");
      setNewNote("");
      setShowInput(false);
      fetchNotes();
      onNoteAdded?.();

      // Trigger notification to manager
      try {
        await supabase.functions.invoke("notify-notes-added", {
          body: { agentId, note: newNote.trim() },
        });
      } catch (notifyError) {
        console.log("Note notification skipped:", notifyError);
      }
    } catch (error) {
      console.error("Error adding note:", error);
      toast.error("Failed to add note");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          Notes ({notes.length > 0 ? notes.length : "..."})
        </button>
        
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(true);
              setShowInput(true);
            }}
            className="gap-1 h-7 text-xs"
          >
            <MessageSquarePlus className="h-3 w-3" />
            Add Note
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Add note input */}
          {showInput && !readOnly && (
            <div className="flex gap-2">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note about this agent..."
                className="text-sm resize-none"
                rows={2}
              />
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || submitting}
                  className="h-8"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowInput(false);
                    setNewNote("");
                  }}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Notes list */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              No notes yet
            </p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-muted/50 rounded-md p-2 text-sm"
                >
                  <p className="text-foreground">{note.note}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {note.createdBy} • {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
