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

  // Auto-expand and fetch on mount
  useEffect(() => {
    fetchNotes();
  }, [agentId]);

  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-primary" />
          Notes
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground">({notes.length})</span>
          )}
        </h4>
        
        {!readOnly && !showInput && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInput(true)}
            className="gap-1.5 h-7 text-xs"
          >
            <MessageSquarePlus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {/* Add note input */}
      {showInput && !readOnly && (
        <div className="mb-3 p-3 bg-muted/30 rounded-lg border border-border/50">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            className="text-sm resize-none bg-background mb-2"
            rows={2}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowInput(false);
                setNewNote("");
              }}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!newNote.trim() || submitting}
              className="h-7 text-xs gap-1"
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Save
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
        <p className="text-xs text-muted-foreground text-center py-3 bg-muted/20 rounded-md">
          No notes yet
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {notes.slice(0, expanded ? notes.length : 3).map((note) => (
            <div
              key={note.id}
              className="bg-muted/30 rounded-lg p-3 text-sm border border-border/30"
            >
              <p className="text-foreground leading-relaxed">{note.note}</p>
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium text-primary">
                  {note.createdBy.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <span>{note.createdBy}</span>
                <span>•</span>
                <span>{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}</span>
              </div>
            </div>
          ))}
          
          {notes.length > 3 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full text-xs text-primary hover:text-primary/80 py-2 flex items-center justify-center gap-1"
            >
              <ChevronDown className="h-3 w-3" />
              Show {notes.length - 3} more
            </button>
          )}
          
          {expanded && notes.length > 3 && (
            <button
              onClick={() => setExpanded(false)}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1"
            >
              <ChevronUp className="h-3 w-3" />
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
