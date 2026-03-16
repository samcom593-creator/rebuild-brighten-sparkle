import { useState, useCallback, useEffect, useMemo } from "react";

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}
 import { motion, AnimatePresence } from "framer-motion";
 import {
   X,
   Phone,
   CheckCircle2,
   XCircle,
   GraduationCap,
   FileText,
   PhoneOff,
   Mail,
   Instagram,
   ChevronRight,
   Loader2,
   Copy,
   Check,
 } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { GlassCard } from "@/components/ui/glass-card";
 import { Progress } from "@/components/ui/progress";
 import { supabase } from "@/integrations/supabase/client";
 import { toast } from "sonner";
 import { cn } from "@/lib/utils";
 
  interface Lead {
    id: string;
    firstName: string;
    lastName?: string;
    email: string;
    phone?: string;
    instagramHandle?: string;
    notes?: string;
    motivation?: string;
    licenseStatus: string;
    referredBy?: string;
    assignedManagerName?: string;
  }
 
 interface CallModeInterfaceProps {
   isOpen: boolean;
   onClose: () => void;
   licenseFilter: "licensed" | "unlicensed";
   managerId?: string;
   isAdmin: boolean;
   onLeadProcessed: () => void;
 }
 
 const statusActions = [
   { id: "hired", label: "Hired", icon: CheckCircle2, color: "text-green-500 border-green-500/30 hover:bg-green-500/10" },
   { id: "contracted", label: "Contracted", icon: FileText, color: "text-primary border-primary/30 hover:bg-primary/10" },
   { id: "licensing", label: "Licensing", icon: GraduationCap, color: "text-purple-500 border-purple-500/30 hover:bg-purple-500/10", unlicensedOnly: true },
   { id: "not_qualified", label: "Not Qualified", icon: XCircle, color: "text-red-500 border-red-500/30 hover:bg-red-500/10" },
   { id: "no_pickup", label: "No Pickup", icon: PhoneOff, color: "text-amber-500 border-amber-500/30 hover:bg-amber-500/10" },
 ];
 
 export function CallModeInterface({
   isOpen,
   onClose,
   licenseFilter,
   managerId,
   isAdmin,
   onLeadProcessed,
 }: CallModeInterfaceProps) {
   const [leads, setLeads] = useState<Lead[]>([]);
   const [currentIndex, setCurrentIndex] = useState(0);
   const [loading, setLoading] = useState(true);
   const [processing, setProcessing] = useState(false);
 
   const currentLead = leads[currentIndex];
   const totalLeads = leads.length;
   const progressPercent = totalLeads > 0 ? ((currentIndex) / totalLeads) * 100 : 0;
 
   // Fetch leads when opened
   useEffect(() => {
     if (isOpen) {
       fetchLeads();
     }
   }, [isOpen, licenseFilter, managerId, isAdmin]);
 
   const fetchLeads = async () => {
     setLoading(true);
     try {
        let query = supabase
          .from("aged_leads")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, motivation, license_status, assigned_manager_id, agents!aged_leads_assigned_manager_id_fkey(display_name)")
         .eq("license_status", licenseFilter)
         .in("status", ["new", "contacted", "no_pickup"])
         .order("created_at", { ascending: true });
 
       // If not admin, filter by manager assignment
       if (!isAdmin && managerId) {
         query = query.eq("assigned_manager_id", managerId);
       }
 
       const { data, error } = await query;
 
       if (error) throw error;
 
        setLeads(
           (data || []).map((lead: any) => ({
             id: lead.id,
             firstName: lead.first_name,
             lastName: lead.last_name || undefined,
             email: lead.email,
             phone: lead.phone || undefined,
             instagramHandle: lead.instagram_handle || undefined,
             notes: lead.notes || undefined,
             motivation: lead.motivation || undefined,
             licenseStatus: lead.license_status || "unknown",
             assignedManagerName: lead.agents?.display_name || undefined,
           }))
         );
       setCurrentIndex(0);
     } catch (error) {
       console.error("Error fetching leads for call mode:", error);
       toast.error("Failed to load leads");
     } finally {
       setLoading(false);
     }
   };
 
   const handleAction = useCallback(async (actionId: string) => {
     if (!currentLead || processing) return;
 
     setProcessing(true);
     try {
       const { error } = await supabase
         .from("aged_leads")
         .update({
           status: actionId,
           processed_at: new Date().toISOString(),
         })
         .eq("id", currentLead.id);
 
       if (error) throw error;
 
       // Remove the lead from local state (optimistic update)
       setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
       
       // Notify parent to refresh stats
       onLeadProcessed();
 
       toast.success(`Lead marked as ${actionId.replace("_", " ")}`);
 
       // If no more leads, close the modal
       if (leads.length <= 1) {
         toast.info("All leads processed!");
         onClose();
       }
     } catch (error) {
       console.error("Error updating lead:", error);
       toast.error("Failed to update lead");
     } finally {
       setProcessing(false);
     }
   }, [currentLead, processing, leads.length, onClose, onLeadProcessed]);
 
   const handleCall = useCallback(() => {
     if (currentLead?.phone) {
       window.open(`tel:${currentLead.phone}`, "_self");
     }
   }, [currentLead]);
 
   // Keyboard shortcuts
   useEffect(() => {
     if (!isOpen) return;
 
     const handleKeyDown = (e: KeyboardEvent) => {
       if (processing) return;
       
       switch (e.key) {
         case "1":
           handleAction("hired");
           break;
         case "2":
           handleAction("contracted");
           break;
         case "3":
           if (licenseFilter === "unlicensed") handleAction("licensing");
           break;
         case "4":
           handleAction("not_qualified");
           break;
         case "5":
           handleAction("no_pickup");
           break;
         case "Escape":
           onClose();
           break;
       }
     };
 
     window.addEventListener("keydown", handleKeyDown);
     return () => window.removeEventListener("keydown", handleKeyDown);
   }, [isOpen, processing, handleAction, licenseFilter, onClose]);
 
   if (!isOpen) return null;
 
   return (
     <AnimatePresence>
       <motion.div
         initial={{ opacity: 0 }}
         animate={{ opacity: 1 }}
         exit={{ opacity: 0 }}
         className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
       >
         <div className="flex flex-col h-full max-w-2xl mx-auto p-4">
           {/* Header */}
           <div className="flex items-center justify-between mb-4">
             <div>
               <h2 className="text-xl font-bold flex items-center gap-2">
                 <Phone className="h-5 w-5 text-primary" />
                 Call Mode: {licenseFilter === "licensed" ? "Licensed" : "Unlicensed"} Leads
               </h2>
               <p className="text-sm text-muted-foreground">
                 {totalLeads - currentIndex} leads remaining
               </p>
             </div>
             <Button variant="ghost" size="icon" onClick={onClose}>
               <X className="h-5 w-5" />
             </Button>
           </div>
 
           {/* Progress Bar */}
           <div className="mb-6">
             <Progress value={progressPercent} className="h-2" />
             <p className="text-xs text-muted-foreground mt-1 text-right">
               {currentIndex} / {totalLeads} processed
             </p>
           </div>
 
           {/* Content */}
           {loading ? (
             <div className="flex-1 flex items-center justify-center">
               <Loader2 className="h-8 w-8 animate-spin text-primary" />
             </div>
           ) : !currentLead ? (
             <div className="flex-1 flex flex-col items-center justify-center text-center">
               <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
               <h3 className="text-2xl font-bold mb-2">All Done!</h3>
               <p className="text-muted-foreground mb-6">
                 No more {licenseFilter} leads to process.
               </p>
               <Button onClick={onClose}>Exit Call Mode</Button>
             </div>
           ) : (
             <>
               {/* Lead Card */}
               <GlassCard className="flex-1 p-6 mb-4 overflow-y-auto">
                 <div className="space-y-4">
                    {/* Name */}
                     <div>
                       <h3 className="text-2xl font-bold">
                         {currentLead.firstName} {currentLead.lastName || ""}
                       </h3>
                       {currentLead.assignedManagerName && (
                         <p className="text-sm text-indigo-400 mt-1 flex items-center gap-1.5">
                           <span className="inline-block w-3 h-3 rounded-full bg-indigo-500/20 text-center text-[10px] leading-3">🏢</span>
                           Manager: {currentLead.assignedManagerName}
                         </p>
                       )}
                       {currentLead.referredBy && (
                         <p className="text-sm text-purple-400 mt-1 flex items-center gap-1.5">
                           <span className="inline-block w-3 h-3 rounded-full bg-purple-500/20 text-center text-[10px] leading-3">👤</span>
                           Referred by: {currentLead.referredBy}
                         </p>
                       )}
                     </div>
 
                   {/* Contact Info */}
                   <div className="space-y-3">
                     <a
                       href={`mailto:${currentLead.email}`}
                       className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                     >
                       <Mail className="h-5 w-5 text-primary" />
                       <span>{currentLead.email}</span>
                     </a>
 
                     {currentLead.phone && (
                       <button
                         onClick={handleCall}
                         className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                       >
                         <Phone className="h-5 w-5 text-green-500" />
                         <span className="font-medium">{formatPhoneDisplay(currentLead.phone)}</span>
                         <span className="ml-auto text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded">
                           Tap to Call
                         </span>
                       </button>
                     )}
 
                     {currentLead.instagramHandle && (
                       <a
                         href={`https://instagram.com/${currentLead.instagramHandle.replace("@", "")}`}
                         target="_blank"
                         rel="noopener noreferrer"
                         className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                       >
                         <Instagram className="h-5 w-5 text-pink-500" />
                         <span>@{currentLead.instagramHandle.replace("@", "")}</span>
                       </a>
                     )}
                   </div>
 
                   {/* Notes / Motivation */}
                   {(currentLead.notes || currentLead.motivation) && (
                     <div className="pt-4 border-t border-border">
                       <p className="text-sm font-medium mb-2">Notes:</p>
                       <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                         {currentLead.motivation || currentLead.notes}
                       </p>
                     </div>
                   )}
                 </div>
               </GlassCard>
 
               {/* Action Buttons */}
               <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                 {statusActions
                   .filter((action) => !action.unlicensedOnly || licenseFilter === "unlicensed")
                   .map((action, index) => (
                     <Button
                       key={action.id}
                       variant="outline"
                       size="lg"
                       disabled={processing}
                       onClick={() => handleAction(action.id)}
                       className={cn("gap-2 h-14 text-sm font-medium", action.color)}
                     >
                       <action.icon className="h-5 w-5" />
                       {action.label}
                       <span className="text-[10px] opacity-60 ml-auto hidden sm:inline">
                         [{index + 1}]
                       </span>
                     </Button>
                   ))}
               </div>
 
               {/* Keyboard hint */}
               <p className="text-xs text-muted-foreground text-center mt-4 hidden sm:block">
                 Press 1-5 for quick actions • ESC to exit
               </p>
             </>
           )}
         </div>
       </motion.div>
     </AnimatePresence>
   );
 }