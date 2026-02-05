 import { useState, useCallback, useMemo } from "react";
 import {
   Upload,
   FileText,
   AlertCircle,
   CheckCircle2,
   X,
   Download,
   Users,
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
 }
 
 interface AgedLeadImporterProps {
   isOpen: boolean;
   onClose: () => void;
   managers: Manager[];
   onImportComplete: () => void;
 }
 
 // Column name variations we accept
 const COLUMN_MAPPINGS: Record<string, string[]> = {
   first_name: ["first_name", "firstname", "first name", "fname", "first"],
   last_name: ["last_name", "lastname", "last name", "lname", "last", "surname"],
   email: ["email", "e-mail", "email address", "emailaddress"],
   phone: ["phone", "phone number", "phonenumber", "mobile", "cell", "telephone"],
   instagram_handle: ["instagram", "instagram_handle", "ig", "ig handle", "instagram handle"],
   motivation: ["motivation", "notes", "about_me", "about me", "reason", "why", "comments", "note"],
   license_status: ["license_status", "license", "licensed", "status"],
 };
 
 function normalizeHeader(header: string): string {
   return header.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
 }
 
 function mapHeader(header: string): string | null {
   const normalized = normalizeHeader(header);
   for (const [field, variations] of Object.entries(COLUMN_MAPPINGS)) {
     if (variations.some((v) => normalizeHeader(v) === normalized || normalized.includes(normalizeHeader(v)))) {
       return field;
     }
   }
   return null;
 }
 
 function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
   const lines = csvText.trim().split(/\r?\n/);
   if (lines.length === 0) return { headers: [], rows: [] };
 
   // Parse header row
   const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
 
   // Parse data rows
   const rows: string[][] = [];
   for (let i = 1; i < lines.length; i++) {
     const line = lines[i];
     if (!line.trim()) continue;
 
     // Simple CSV parsing (handles basic quoted strings)
     const values: string[] = [];
     let current = "";
     let inQuotes = false;
 
     for (const char of line) {
       if (char === '"' && !inQuotes) {
         inQuotes = true;
       } else if (char === '"' && inQuotes) {
         inQuotes = false;
       } else if (char === "," && !inQuotes) {
         values.push(current.trim());
         current = "";
       } else {
         current += char;
       }
     }
     values.push(current.trim());
     rows.push(values);
   }
 
   return { headers, rows };
 }
 
 export function AgedLeadImporter({
   isOpen,
   onClose,
   managers,
   onImportComplete,
 }: AgedLeadImporterProps) {
   const [csvData, setCsvData] = useState("");
   const [selectedManager, setSelectedManager] = useState("");
   const [defaultLicenseStatus, setDefaultLicenseStatus] = useState("unlicensed");
   const [importing, setImporting] = useState(false);
   const [step, setStep] = useState<"input" | "preview">("input");
 
   // Parse and validate the CSV
   const parsedData = useMemo(() => {
     if (!csvData.trim()) return { leads: [], headerMap: new Map<string, number>() };
 
     const { headers, rows } = parseCSV(csvData);
 
     // Map headers to our field names
     const headerMap = new Map<string, number>();
     headers.forEach((header, index) => {
       const mappedField = mapHeader(header);
       if (mappedField) {
         headerMap.set(mappedField, index);
       }
     });
 
     // Parse each row into a lead
     const leads: ParsedLead[] = rows.map((row) => {
       const getValue = (field: string) => {
         const index = headerMap.get(field);
         return index !== undefined ? row[index]?.trim() : undefined;
       };
 
       const errors: string[] = [];
       const firstName = getValue("first_name");
       const lastName = getValue("last_name");
       const email = getValue("email");
       const phone = getValue("phone");
 
       if (!firstName) errors.push("Missing first name");
       if (!lastName) errors.push("Missing last name");
       if (!email) errors.push("Missing email");
       if (!phone) errors.push("Missing phone");
 
       // Determine license status from CSV or use default
       let licenseStatus = getValue("license_status");
       if (licenseStatus) {
         licenseStatus = licenseStatus.toLowerCase();
         if (licenseStatus.includes("yes") || licenseStatus.includes("licensed") || licenseStatus === "true") {
           licenseStatus = "licensed";
         } else {
           licenseStatus = "unlicensed";
         }
       } else {
         licenseStatus = defaultLicenseStatus;
       }
 
       return {
         first_name: firstName || "",
         last_name: lastName || "",
         email: email || "",
         phone: phone || "",
         instagram_handle: getValue("instagram_handle"),
         motivation: getValue("motivation"),
         license_status: licenseStatus,
         isValid: errors.length === 0,
         errors,
       };
     });
 
     return { leads, headerMap };
   }, [csvData, defaultLicenseStatus]);
 
   const validLeads = parsedData.leads.filter((l) => l.isValid);
   const invalidLeads = parsedData.leads.filter((l) => !l.isValid);
   const licensedCount = validLeads.filter((l) => l.license_status === "licensed").length;
   const unlicensedCount = validLeads.filter((l) => l.license_status === "unlicensed").length;
 
   const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;
 
     const reader = new FileReader();
     reader.onload = (event) => {
       const text = event.target?.result as string;
       setCsvData(text);
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
     try {
       const leadsToInsert = validLeads.map((lead) => ({
         first_name: lead.first_name,
         last_name: lead.last_name,
         email: lead.email,
         phone: lead.phone,
         instagram_handle: lead.instagram_handle || null,
         notes: lead.motivation || null, // Motivation goes into notes
         motivation: lead.motivation || null,
         license_status: lead.license_status,
         assigned_manager_id: selectedManager,
         status: "new",
       }));
 
       const { error } = await supabase.from("aged_leads").insert(leadsToInsert);
 
       if (error) throw error;
 
       toast.success(`Imported ${validLeads.length} leads successfully!`);
 
       // Trigger emails for each lead
       for (const lead of leadsToInsert) {
         try {
           await supabase.functions.invoke("send-aged-lead-email", {
             body: { email: lead.email, firstName: lead.first_name },
           });
         } catch (e) {
           console.error("Error sending aged lead email:", e);
         }
       }
 
       // Reset and close
       setCsvData("");
       setSelectedManager("");
       setStep("input");
       onImportComplete();
       onClose();
     } catch (error) {
       console.error("Error importing leads:", error);
       toast.error("Failed to import leads");
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
 
   return (
     <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
       <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
         <DialogHeader>
           <DialogTitle className="flex items-center gap-2">
             <Upload className="h-5 w-5 text-primary" />
             Import Aged Leads
           </DialogTitle>
           <DialogDescription>
             Upload a CSV file with lead data. Required columns: first_name, last_name, email, phone
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
 
             {/* Default License Status */}
             <div className="space-y-2">
               <Label>Default License Status</Label>
               <p className="text-xs text-muted-foreground">
                 Used when CSV doesn't specify license status
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
               <Label>Upload CSV File</Label>
               <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                 <input
                   type="file"
                   accept=".csv,text/csv"
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
                     CSV files only
                   </p>
                 </label>
               </div>
             </div>
 
             {/* Or paste CSV */}
             <div className="space-y-2">
               <Label>Or Paste CSV Data</Label>
               <p className="text-xs text-muted-foreground">
                 Columns: first_name, last_name, email, phone, instagram (optional), motivation (optional), license_status (optional)
               </p>
               <Textarea
                 placeholder="first_name,last_name,email,phone,instagram,motivation&#10;John,Doe,john@example.com,555-1234,@johndoe,Looking for new career"
                 value={csvData}
                 onChange={(e) => setCsvData(e.target.value)}
                 className="min-h-[150px] font-mono text-sm"
               />
             </div>
 
             {/* Preview Button */}
             {csvData.trim() && (
               <Button onClick={() => setStep("preview")} className="w-full">
                 Preview Import ({parsedData.leads.length} rows)
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
                       Row {parsedData.leads.indexOf(lead) + 2}: {lead.errors.join(", ")}
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
                 Each imported lead will receive an outreach email inviting them to apply or schedule a call.
               </span>
             </div>
           </div>
         )}
 
         <DialogFooter className="flex-col sm:flex-row gap-2">
           <Button variant="ghost" onClick={handleClose}>
             Cancel
           </Button>
         </DialogFooter>
       </DialogContent>
     </Dialog>
   );
 }