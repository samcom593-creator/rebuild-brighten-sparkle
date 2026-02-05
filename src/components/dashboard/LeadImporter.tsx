import { useState, useRef } from "react";
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ParsedLead {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  license_status: "licensed" | "unlicensed";
  instagram_handle?: string;
}

interface Manager {
  id: string;
  name: string;
}

export function LeadImporter({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManager, setSelectedManager] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchManagers = async () => {
    setLoadingManagers(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-active-managers");
      if (error) throw error;
      setManagers(data?.managers || []);
    } catch (err) {
      console.error("Failed to fetch managers:", err);
      toast.error("Failed to load managers");
      setManagers([]);
    } finally {
      setLoadingManagers(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      fetchManagers();
    } else {
      // Reset state
      setFile(null);
      setParsedLeads([]);
      setSelectedManager("");
      setParseError(null);
      setLoadingManagers(false);
    }
  };

  const parseCSV = (csvText: string): ParsedLead[] => {
    const lines = csvText.trim().split("\n");
    if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row");

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const requiredHeaders = ["first_name", "last_name", "email", "phone"];
    
    for (const required of requiredHeaders) {
      if (!headers.includes(required) && !headers.includes(required.replace("_", " "))) {
        throw new Error(`Missing required column: ${required}`);
      }
    }

    const leads: ParsedLead[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      
      if (values.length < headers.length) continue;

      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header.replace(" ", "_")] = values[idx] || "";
      });

      if (!row.first_name || !row.last_name || !row.email || !row.phone) continue;

      leads.push({
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        city: row.city || undefined,
        state: row.state || undefined,
        license_status: row.license_status === "licensed" ? "licensed" : "unlicensed",
        instagram_handle: row.instagram_handle || row.instagram || undefined,
      });
    }

    return leads;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setParseError(null);

    try {
      const text = await selectedFile.text();
      const leads = parseCSV(text);
      
      if (leads.length === 0) {
        throw new Error("No valid leads found in CSV");
      }
      
      setParsedLeads(leads);
    } catch (err: any) {
      setParseError(err.message);
      setParsedLeads([]);
    }
  };

  const handleImport = async () => {
    if (!selectedManager || parsedLeads.length === 0) {
      toast.error("Please select a manager and upload a valid CSV");
      return;
    }

    setImporting(true);
    let successCount = 0;
    let errorCount = 0;

    for (const lead of parsedLeads) {
      const { error } = await supabase.from("applications").insert({
        ...lead,
        assigned_agent_id: selectedManager,
        status: "new",
      });

      if (error) {
        console.error("Error importing lead:", error);
        errorCount++;
      } else {
        successCount++;
      }
    }

    setImporting(false);

    if (successCount > 0) {
      toast.success(`Imported ${successCount} leads successfully`);
    }
    if (errorCount > 0) {
      toast.error(`Failed to import ${errorCount} leads`);
    }

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Upload className="h-4 w-4 mr-2" />
          Import Leads
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Leads from CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file with columns: first_name, last_name, email, phone (required).
            Optional: city, state, license_status, instagram_handle.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          <div>
            <Label>CSV File</Label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "mt-2 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                file ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setParsedLeads([]);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload or drag and drop
                  </p>
                </>
              )}
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Preview */}
          {parsedLeads.length > 0 && (
            <div className="text-sm">
              <p className="text-muted-foreground mb-2">
                Found <span className="font-semibold text-foreground">{parsedLeads.length}</span> leads to import
              </p>
              <div className="max-h-32 overflow-y-auto bg-muted/50 rounded-lg p-2 text-xs">
                {parsedLeads.slice(0, 5).map((lead, i) => (
                  <div key={i} className="py-1 border-b border-border/50 last:border-0">
                    {lead.first_name} {lead.last_name} - {lead.email}
                  </div>
                ))}
                {parsedLeads.length > 5 && (
                  <div className="text-muted-foreground pt-1">
                    ...and {parsedLeads.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manager Selection */}
          <div>
            <Label>Assign to Manager</Label>
            <Select value={selectedManager} onValueChange={setSelectedManager} disabled={loadingManagers}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder={loadingManagers ? "Loading managers..." : "Select a manager..."} />
              </SelectTrigger>
              <SelectContent>
                {managers.length === 0 && !loadingManagers ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">No managers available</div>
                ) : (
                  managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || parsedLeads.length === 0 || !selectedManager}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import {parsedLeads.length} Leads
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
