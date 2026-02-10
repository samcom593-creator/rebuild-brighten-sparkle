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

function getEmailPreviewHtml(firstName: string) {
  return `
    <div style="max-width:600px;margin:0 auto;padding:32px 20px;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;border-radius:16px;word-break:break-word;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:24px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
      </div>
      
      <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:28px;border:1px solid rgba(20,184,166,0.2);">
        <h2 style="font-size:20px;margin:0 0 16px 0;color:#ffffff;">Hey ${firstName}, a lot has changed since you applied.</h2>
        
        <p style="font-size:15px;line-height:1.7;color:#d1d5db;margin:0 0 20px 0;">
          You applied to Apex Financial before — and since then, our team has been on a tear. The results speak for themselves:
        </p>
        
        <!-- Stats Block -->
        <div style="display:flex;gap:12px;margin:0 0 24px 0;">
          <div style="flex:1;background:linear-gradient(135deg,rgba(20,184,166,0.15),rgba(20,184,166,0.05));border:1px solid rgba(20,184,166,0.3);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:22px;font-weight:bold;color:#14b8a6;margin-bottom:4px;">$20,000+</div>
            <div style="font-size:12px;color:#d1d5db;line-height:1.4;">produced by every<br>agent last month</div>
          </div>
          <div style="flex:1;background:linear-gradient(135deg,rgba(14,165,233,0.15),rgba(14,165,233,0.05));border:1px solid rgba(14,165,233,0.3);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:22px;font-weight:bold;color:#0ea5e9;margin-bottom:4px;">$10,000+</div>
            <div style="font-size:12px;color:#d1d5db;line-height:1.4;">deposited by every<br>agent last month</div>
          </div>
        </div>
        
        <p style="font-size:15px;line-height:1.7;color:#ffffff;margin:0 0 10px 0;font-weight:600;">
          Here's what you get when you join:
        </p>
        
        <div style="background:rgba(20,184,166,0.08);border-radius:12px;padding:20px;margin:0 0 20px 0;">
          <ul style="margin:0;padding-left:0;list-style:none;color:#d1d5db;">
            <li style="margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:14px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Start at <strong style="color:#ffffff;margin-left:4px;">70% commission</strong>&nbsp;(up to 145%)
            </li>
            <li style="margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:14px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Unlimited warm leads provided daily
            </li>
            <li style="margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:14px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              Complete training + mentorship included
            </li>
            <li style="margin-bottom:0;display:flex;align-items:center;gap:8px;font-size:14px;">
              <span style="color:#14b8a6;font-weight:bold;">✓</span>
              No cold calling — work from anywhere
            </li>
          </ul>
        </div>
        
        <div style="text-align:center;margin:24px 0 16px 0;">
          <a href="https://apex-financial.org/apply" 
             style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:bold;font-size:16px;box-shadow:0 4px 20px rgba(20,184,166,0.3);letter-spacing:0.5px;max-width:100%;box-sizing:border-box;">
            REAPPLY NOW →
          </a>
        </div>
        
        <p style="font-size:13px;color:#f59e0b;text-align:center;margin:16px 0 0 0;font-weight:600;">
          ⚡ We're only accepting a limited number of new agents this month.
        </p>
        
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:24px;padding-top:16px;">
          <p style="font-size:14px;color:#9ca3af;margin:0;">
            – The Apex Financial Team
          </p>
        </div>
      </div>
      
      <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:24px;">
        Powered by Apex Financial · © ${new Date().getFullYear()}
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
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">From:</span>
                <span className="text-foreground">APEX Financial &lt;noreply@apex-financial.org&gt;</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Subject:</span>
                <span className="text-foreground font-medium">We've Grown Since You Applied — See What's Changed</span>
              </div>
            </div>
            
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
