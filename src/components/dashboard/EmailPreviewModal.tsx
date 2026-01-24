import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Eye, Edit, Loader2 } from "lucide-react";

interface EmailPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  subject: string;
  htmlContent: string;
  recipientEmail: string;
  recipientName: string;
  onSend: (customSubject?: string, customBody?: string) => Promise<void>;
  isSending: boolean;
}

export function EmailPreviewModal({
  open,
  onOpenChange,
  templateName,
  subject,
  htmlContent,
  recipientEmail,
  recipientName,
  onSend,
  isSending,
}: EmailPreviewModalProps) {
  const [editedSubject, setEditedSubject] = useState(subject);
  const [editedBody, setEditedBody] = useState(htmlContent);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "edit">("preview");

  const handleSend = async () => {
    const customSubject = editedSubject !== subject ? editedSubject : undefined;
    const customBody = editedBody !== htmlContent ? editedBody : undefined;
    await onSend(customSubject, customBody);
  };

  const resetEdits = () => {
    setEditedSubject(subject);
    setEditedBody(htmlContent);
    setIsEditing(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) resetEdits();
      onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Email Preview: {templateName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Recipient Info */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">To:</span>{" "}
            <span className="font-medium">{recipientName}</span>{" "}
            <span className="text-muted-foreground">&lt;{recipientEmail}&gt;</span>
          </div>

          {/* Subject Line */}
          <div className="space-y-2">
            <Label htmlFor="subject" className="text-sm font-medium">Subject Line</Label>
            <Input
              id="subject"
              value={editedSubject}
              onChange={(e) => {
                setEditedSubject(e.target.value);
                setIsEditing(true);
              }}
              className="font-medium"
            />
          </div>

          {/* Tabs for Preview/Edit */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "preview" | "edit")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="preview" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="edit" className="flex items-center gap-2">
                <Edit className="h-4 w-4" />
                Edit HTML
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="mt-4">
              <div 
                className="rounded-lg border bg-white overflow-hidden"
                style={{ minHeight: "400px" }}
              >
                <iframe
                  srcDoc={editedBody}
                  className="w-full h-[400px] border-0"
                  title="Email Preview"
                />
              </div>
            </TabsContent>

            <TabsContent value="edit" className="mt-4">
              <Textarea
                value={editedBody}
                onChange={(e) => {
                  setEditedBody(e.target.value);
                  setIsEditing(true);
                }}
                className="min-h-[400px] font-mono text-sm"
                placeholder="HTML content..."
              />
            </TabsContent>
          </Tabs>

          {isEditing && (
            <p className="text-sm text-amber-500 flex items-center gap-2">
              <Edit className="h-4 w-4" />
              You've made edits to this email
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          {isEditing && (
            <Button
              variant="outline"
              onClick={resetEdits}
              disabled={isSending}
            >
              Reset to Template
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={isSending}
            className="gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
