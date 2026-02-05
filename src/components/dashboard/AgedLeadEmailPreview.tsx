import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Eye } from "lucide-react";

interface AgedLeadEmailPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  sampleFirstName: string;
  onApprove: () => void;
  isLoading?: boolean;
}

// Generate the email HTML preview (matches send-aged-lead-email edge function)
function getEmailPreviewHtml(firstName: string) {
  return `
    <div style="max-width:600px;margin:0 auto;padding:32px 20px;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:24px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
      </div>
      
      <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:28px;border:1px solid rgba(20,184,166,0.2);">
        <h2 style="font-size:22px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
        
        <p style="font-size:16px;line-height:1.7;color:#d1d5db;margin:0 0 16px 0;">
          A new remote sales position just opened up at Apex Financial and we thought of you.
        </p>
        
        <p style="font-size:16px;line-height:1.7;color:#ffffff;margin:0 0 12px 0;font-weight:600;">
          Here's what's on the table:
        </p>
        
        <div style="background:rgba(20,184,166,0.1);border-radius:12px;padding:20px;margin:16px 0;">
          <ul style="margin:0;padding-left:0;list-style:none;color:#d1d5db;">
            <li style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Start at <strong style="color:#ffffff;">70% commission</strong> (up to 145%)
            </li>
            <li style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Free warm leads provided daily
            </li>
            <li style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Complete training program included
            </li>
            <li style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              No cold calling required
            </li>
            <li style="margin-bottom:0;display:flex;align-items:center;gap:8px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Work from anywhere
            </li>
          </ul>
        </div>
        
        <p style="font-size:16px;line-height:1.7;color:#d1d5db;margin:16px 0;">
          Our top performers are earning <strong style="color:#14b8a6;">$10K-$50K+ per month</strong>, and we're looking for motivated individuals to join the team.
        </p>
        
        <div style="text-align:center;margin:28px 0 20px 0;">
          <a href="https://apex-financial.org/apply" 
             style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 40px;text-decoration:none;border-radius:10px;font-weight:bold;font-size:16px;box-shadow:0 4px 20px rgba(20,184,166,0.3);">
            🚀 CLAIM YOUR SPOT
          </a>
        </div>
        
        <p style="font-size:14px;color:#9ca3af;text-align:center;margin:20px 0 0 0;">
          Spots are limited and filling fast.
        </p>
        
        <p style="font-size:14px;color:#9ca3af;margin:20px 0 0 0;">
          – The Apex Financial Team
        </p>
      </div>
      
      <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:24px;">
        © ${new Date().getFullYear()} Apex Financial. All rights reserved.
      </p>
    </div>
  `;
}

export function AgedLeadEmailPreview({
  isOpen,
  onClose,
  sampleFirstName,
  onApprove,
  isLoading = false,
}: AgedLeadEmailPreviewProps) {
  const previewHtml = getEmailPreviewHtml(sampleFirstName || "there");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Email Preview
          </DialogTitle>
          <DialogDescription>
            This is the email that will be sent to each imported lead
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto border rounded-xl bg-black/50">
          <div className="p-4">
            {/* Email metadata preview */}
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">From:</span>
                <span className="text-foreground">Apex Financial &lt;team@apex-financial.org&gt;</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Subject:</span>
                <span className="text-foreground font-medium">🔥 New Remote Sales Position Just Opened – Apply Now</span>
              </div>
            </div>
            
            {/* Email body preview */}
            <div 
              className="rounded-lg overflow-hidden"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={onApprove} 
            disabled={isLoading}
            className="gap-2"
          >
            <Mail className="h-4 w-4" />
            {isLoading ? "Importing..." : "Looks Good, Import Leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
