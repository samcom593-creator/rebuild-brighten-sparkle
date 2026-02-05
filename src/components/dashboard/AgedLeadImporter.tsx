import { useState, useCallback, useMemo, forwardRef } from "react";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  Download,
  Users,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AgedLeadEmailPreview } from "./AgedLeadEmailPreview";

interface Manager {
  id: string;
  name: string;
}

interface ParsedLead {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  instagram_handle?: string;
  motivation?: string;
  license_status: string;
  isValid: boolean;
  errors: string[];
  rowNumber: number;
}

interface AgedLeadImporterProps {
  isOpen: boolean;
  onClose: () => void;
  managers: Manager[];
  onImportComplete: () => void;
}

// Comprehensive column name variations - handles almost any spreadsheet format
const COLUMN_MAPPINGS: Record<string, string[]> = {
  first_name: [
    "first_name", "firstname", "first name", "fname", "first", "given_name", 
    "givenname", "given name", "name_first", "forename", "applicant_first",
    "contact_first", "lead_first", "agent_first"
  ],
  last_name: [
    "last_name", "lastname", "last name", "lname", "last", "surname", 
    "family_name", "familyname", "family name", "name_last", "applicant_last",
    "contact_last", "lead_last", "agent_last"
  ],
  full_name: [
    "full_name", "fullname", "full name", "name", "contact_name", "lead_name",
    "applicant_name", "agent_name", "customer_name", "person_name"
  ],
  email: [
    "email", "e-mail", "email address", "emailaddress", "email_address",
    "mail", "contact_email", "lead_email", "applicant_email", "agent_email",
    "primary_email", "work_email", "personal_email"
  ],
  phone: [
    "phone", "phone number", "phonenumber", "phone_number", "mobile", "cell", 
    "telephone", "tel", "contact_phone", "lead_phone", "applicant_phone",
    "mobile_phone", "cell_phone", "primary_phone", "work_phone", "home_phone",
    "cellphone", "mobilephone"
  ],
  instagram_handle: [
    "instagram", "instagram_handle", "ig", "ig handle", "instagram handle",
    "ig_handle", "insta", "insta_handle", "instagram_username", "ig_username"
  ],
  motivation: [
    "motivation", "notes", "about_me", "about me", "reason", "why", "comments", 
    "note", "description", "bio", "about", "background", "summary", "interests",
    "goals", "objectives", "message"
  ],
  license_status: [
    "license_status", "license", "licensed", "status", "license_type",
    "has_license", "is_licensed", "licensing_status", "agent_license"
  ],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
}

function mapHeader(header: string): string | null {
  const normalized = normalizeHeader(header);
  
  for (const [field, variations] of Object.entries(COLUMN_MAPPINGS)) {
    for (const variation of variations) {
      const normalizedVariation = normalizeHeader(variation);
      // Exact match or contains match
      if (normalized === normalizedVariation || 
          normalized.includes(normalizedVariation) || 
          normalizedVariation.includes(normalized)) {
        return field;
      }
    }
  }
  return null;
}

// Smart phone number cleaning
function cleanPhoneNumber(phone: string): string {
  if (!phone) return "";
  // Remove all non-numeric characters except + at the start
  let cleaned = phone.replace(/[^\d+]/g, "");
  // If it starts with 1 and is 11 digits, it's US format
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

// Smart email validation
function isValidEmail(email: string): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

// Parse full name into first and last
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

// Smart CSV/TSV parser that handles various formats
function parseSpreadsheet(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter (comma, tab, semicolon, pipe)
  const firstLine = lines[0];
  let delimiter = ",";
  if (firstLine.includes("\t") && !firstLine.includes(",")) {
    delimiter = "\t";
  } else if (firstLine.includes(";") && !firstLine.includes(",")) {
    delimiter = ";";
  } else if (firstLine.includes("|") && !firstLine.includes(",")) {
    delimiter = "|";
  }

  // Parse header row
  const headers = parseLine(lines[0], delimiter);

  // Parse data rows
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const values = parseLine(line, delimiter);
    // Only add row if it has at least some data
    if (values.some(v => v.trim())) {
      rows.push(values);
    }
  }

  return { headers, rows };
}

function parseLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      // Check for escaped quotes
      if (line[i + 1] === quoteChar) {
        current += char;
        i++; // Skip next quote
      } else {
        inQuotes = false;
        quoteChar = "";
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim().replace(/^["']|["']$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^["']|["']$/g, ""));
  
  return values;
}

export const AgedLeadImporter = forwardRef<HTMLDivElement, AgedLeadImporterProps>(
  function AgedLeadImporter({
    isOpen,
    onClose,
    managers,
    onImportComplete,
  }, ref) {
    const [csvData, setCsvData] = useState("");
    const [selectedManager, setSelectedManager] = useState("");
    const [defaultLicenseStatus, setDefaultLicenseStatus] = useState("unlicensed");
    const [leadSource, setLeadSource] = useState<"aged" | "new_drip">("aged");
    const [importing, setImporting] = useState(false);
    const [step, setStep] = useState<"input" | "preview" | "email_preview">("input");
    const [showEmailPreview, setShowEmailPreview] = useState(false);

    // Parse and validate the spreadsheet data
    const parsedData = useMemo(() => {
      if (!csvData.trim()) return { leads: [], headerMap: new Map<string, number>(), detectedColumns: [] };

      const { headers, rows } = parseSpreadsheet(csvData);

      // Map headers to our field names
      const headerMap = new Map<string, number>();
      const detectedColumns: string[] = [];
      
      headers.forEach((header, index) => {
        const mappedField = mapHeader(header);
        if (mappedField && !headerMap.has(mappedField)) {
          headerMap.set(mappedField, index);
          detectedColumns.push(`${header} → ${mappedField}`);
        }
      });

      // Parse each row into a lead
      const leads: ParsedLead[] = rows.map((row, rowIndex) => {
        const getValue = (field: string) => {
          const index = headerMap.get(field);
          return index !== undefined && index < row.length ? row[index]?.trim() : undefined;
        };

        const errors: string[] = [];
        
        // Get name - support both separate first/last and full name
        let firstName = getValue("first_name") || "";
        let lastName = getValue("last_name") || "";
        
        // If no first/last name but we have full name, parse it
        if (!firstName && !lastName) {
          const fullName = getValue("full_name");
          if (fullName) {
            const parsed = parseFullName(fullName);
            firstName = parsed.firstName;
            lastName = parsed.lastName;
          }
        }

        const email = getValue("email") || "";
        const phone = cleanPhoneNumber(getValue("phone") || "");

        // Validation with helpful error messages
        if (!firstName) errors.push("Missing first name");
        if (!email) {
          errors.push("Missing email");
        } else if (!isValidEmail(email)) {
          errors.push("Invalid email format");
        }
        if (!phone) errors.push("Missing phone");

        // Determine license status from spreadsheet or use default
        let licenseStatus = getValue("license_status");
        if (licenseStatus) {
          const lower = licenseStatus.toLowerCase();
          if (lower.includes("yes") || lower.includes("licensed") || lower === "true" || lower === "1" || lower === "y") {
            licenseStatus = "licensed";
          } else {
            licenseStatus = "unlicensed";
          }
        } else {
          licenseStatus = defaultLicenseStatus;
        }

        return {
          first_name: firstName,
          last_name: lastName,
          email: email.toLowerCase().trim(),
          phone,
          instagram_handle: getValue("instagram_handle"),
          motivation: getValue("motivation"),
          license_status: licenseStatus,
          isValid: errors.length === 0,
          errors,
          rowNumber: rowIndex + 2, // +2 because row 1 is header, array is 0-indexed
        };
      });

      return { leads, headerMap, detectedColumns };
    }, [csvData, defaultLicenseStatus]);

    const validLeads = parsedData.leads.filter((l) => l.isValid);
    const invalidLeads = parsedData.leads.filter((l) => !l.isValid);
    const licensedCount = validLeads.filter((l) => l.license_status === "licensed").length;
    const unlicensedCount = validLeads.filter((l) => l.license_status === "unlicensed").length;

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Support CSV, TSV, and TXT files
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setCsvData(text);
      };
      reader.onerror = () => {
        toast.error("Failed to read file");
      };
      reader.readAsText(file);
    }, []);

    const handleImport = async () => {
      if (!selectedManager) {
        toast.error("Please select a manager to assign leads to");
        return;
      }

      if (validLeads.length === 0) {
        toast.error("No valid leads to import");
        return;
      }

      setImporting(true);
      let successCount = 0;
      let errorCount = 0;

      try {
        // Batch insert for performance
        const leadsToInsert = validLeads.map((lead) => ({
          first_name: lead.first_name,
          last_name: lead.last_name || null,
          email: lead.email,
          phone: lead.phone,
          instagram_handle: lead.instagram_handle || null,
          notes: lead.motivation || null,
          motivation: lead.motivation || null,
          license_status: lead.license_status,
          assigned_manager_id: selectedManager,
          lead_source: leadSource,
          status: "new",
        }));

        const { error, data } = await supabase.from("aged_leads").insert(leadsToInsert).select("id, email, first_name");

        if (error) throw error;

        successCount = leadsToInsert.length;
        toast.success(`Imported ${successCount} leads successfully!`);

        // Send emails in background (don't await all of them)
        if (data && data.length > 0) {
          // Fire and forget - send emails asynchronously
          data.forEach((lead) => {
            supabase.functions.invoke("send-aged-lead-email", {
              body: { email: lead.email, firstName: lead.first_name },
            }).catch((e) => {
              console.error("Error sending aged lead email:", e);
            });
          });
          toast.info(`Sending outreach emails to ${data.length} leads...`);
        }

        // Reset and close
        setCsvData("");
        setSelectedManager("");
        setLeadSource("aged");
        setStep("input");
        onImportComplete();
        onClose();
      } catch (error: any) {
        console.error("Error importing leads:", error);
        
        // Check for duplicate email errors
        if (error.message?.includes("duplicate") || error.code === "23505") {
          toast.error("Some leads have duplicate emails that already exist in the system");
        } else {
          toast.error("Failed to import leads: " + (error.message || "Unknown error"));
        }
      } finally {
        setImporting(false);
      }
    };

    const handleClose = () => {
      setCsvData("");
      setSelectedManager("");
      setStep("input");
      onClose();
    };

    const downloadTemplate = () => {
      const template = "first_name,last_name,email,phone,instagram,motivation,license_status\nJohn,Doe,john@example.com,555-123-4567,@johndoe,Looking for new career,unlicensed\nJane,Smith,jane@example.com,555-987-6543,@janesmith,Interested in insurance,licensed";
      const blob = new Blob([template], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "aged_leads_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent ref={ref} className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Import Aged Leads
            </DialogTitle>
            <DialogDescription>
              Upload any spreadsheet (CSV, TSV) with lead data. We'll auto-detect columns.
            </DialogDescription>
          </DialogHeader>

          {step === "input" ? (
            <div className="space-y-4 py-4">
              {/* Manager Selection */}
              <div className="space-y-2">
                <Label>Assign to Manager *</Label>
                <Select value={selectedManager} onValueChange={setSelectedManager}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Lead Source Category */}
              <div className="space-y-2">
                <Label>Lead Category *</Label>
                <p className="text-xs text-muted-foreground">
                  Categorize these leads for tracking and filtering
                </p>
                <Select value={leadSource} onValueChange={(v) => setLeadSource(v as "aged" | "new_drip")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aged">Aged Leads</SelectItem>
                    <SelectItem value="new_drip">New Drip-Ins</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Default License Status */}
              <div className="space-y-2">
                <Label>Default License Status</Label>
                <p className="text-xs text-muted-foreground">
                  Used when spreadsheet doesn't specify license status
                </p>
                <Select value={defaultLicenseStatus} onValueChange={setDefaultLicenseStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlicensed">Unlicensed</SelectItem>
                    <SelectItem value="licensed">Licensed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Upload Spreadsheet</Label>
                  <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-xs gap-1">
                    <Download className="h-3 w-3" />
                    Download Template
                  </Button>
                </div>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload" className="cursor-pointer">
                    <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      CSV, TSV, or TXT files • Supports most spreadsheet exports
                    </p>
                  </label>
                </div>
              </div>

              {/* Or paste data */}
              <div className="space-y-2">
                <Label>Or Paste Spreadsheet Data</Label>
                <p className="text-xs text-muted-foreground">
                  Paste directly from Excel, Google Sheets, or any spreadsheet app
                </p>
                <Textarea
                  placeholder="first_name,last_name,email,phone,instagram,motivation&#10;John,Doe,john@example.com,555-1234,@johndoe,Looking for new career"
                  value={csvData}
                  onChange={(e) => setCsvData(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
              </div>

              {/* Detected Columns */}
              {parsedData.detectedColumns.length > 0 && (
                <div className="rounded-lg bg-primary/10 border border-primary/30 p-3">
                  <p className="text-sm font-medium text-primary mb-2">Detected Columns:</p>
                  <div className="flex flex-wrap gap-1">
                    {parsedData.detectedColumns.map((col, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview Button */}
              {csvData.trim() && (
                <Button onClick={() => setStep("preview")} className="w-full" disabled={parsedData.leads.length === 0}>
                  {parsedData.leads.length === 0 
                    ? "No data detected - check format" 
                    : `Preview Import (${parsedData.leads.length} rows)`}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-4">
                <GlassCard className="p-4 text-center">
                  <Users className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="text-2xl font-bold">{validLeads.length}</p>
                  <p className="text-xs text-muted-foreground">Valid Leads</p>
                </GlassCard>
                <GlassCard className="p-4 text-center">
                  <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="text-2xl font-bold">{licensedCount}</p>
                  <p className="text-xs text-muted-foreground">Licensed</p>
                </GlassCard>
                <GlassCard className="p-4 text-center">
                  <AlertCircle className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-2xl font-bold">{unlicensedCount}</p>
                  <p className="text-xs text-muted-foreground">Unlicensed</p>
                </GlassCard>
              </div>

              {/* Invalid Leads Warning */}
              {invalidLeads.length > 0 && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">{invalidLeads.length} rows will be skipped</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
                    {invalidLeads.slice(0, 5).map((lead, i) => (
                      <p key={i}>
                        Row {lead.rowNumber}: {lead.errors.join(", ")}
                      </p>
                    ))}
                    {invalidLeads.length > 5 && (
                      <p>...and {invalidLeads.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Preview Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Email</th>
                        <th className="px-3 py-2 text-left">Phone</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validLeads.slice(0, 10).map((lead, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">{lead.first_name} {lead.last_name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{lead.email}</td>
                          <td className="px-3 py-2 text-muted-foreground">{lead.phone}</td>
                          <td className="px-3 py-2">
                            <Badge variant={lead.license_status === "licensed" ? "default" : "secondary"}>
                              {lead.license_status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validLeads.length > 10 && (
                  <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground text-center">
                    Showing 10 of {validLeads.length} leads
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("input")} className="flex-1">
                  Back
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowEmailPreview(true)}
                  className="gap-2"
                >
                  <Eye className="h-4 w-4" />
                  Preview Email
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || validLeads.length === 0 || !selectedManager}
                  className="flex-1"
                >
                  {importing ? "Importing..." : `Import ${validLeads.length} Leads`}
                </Button>
              </div>

              {/* Email Notice */}
              <div className="rounded-lg bg-primary/10 border border-primary/30 p-3 text-sm text-primary flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  Each imported lead will receive an outreach email inviting them to apply. Use "Preview Email" to see the exact message.
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          </DialogFooter>

          {/* Email Preview Modal */}
          <AgedLeadEmailPreview
            isOpen={showEmailPreview}
            onClose={() => setShowEmailPreview(false)}
            sampleFirstName={validLeads[0]?.first_name || "there"}
            onApprove={() => {
              setShowEmailPreview(false);
              handleImport();
            }}
            isLoading={importing}
          />
        </DialogContent>
      </Dialog>
    );
  }
);
