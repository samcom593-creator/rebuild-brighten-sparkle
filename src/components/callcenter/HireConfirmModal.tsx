import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface HireConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (boughtCourse: boolean, npn: string) => void | Promise<void>;
  applicantName: string;
  isUnlicensed: boolean;
  initialNpn?: string;
}

export function HireConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  applicantName,
  isUnlicensed,
  initialNpn = "",
}: HireConfirmModalProps) {
  const [boughtCourse, setBoughtCourse] = useState(false);
  const [npn, setNpn] = useState(initialNpn);

  useEffect(() => {
    if (open) setNpn(initialNpn);
  }, [initialNpn, open]);

  const handleConfirm = () => {
    if (!isUnlicensed && !/^\d{5,10}$/.test(npn.replace(/\D+/g, ""))) return;
    void onConfirm(boughtCourse, npn);
    setBoughtCourse(false);
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) setBoughtCourse(false);
    onOpenChange(val);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            {isUnlicensed && (
              <div className="p-2 rounded-full bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
            )}
            {!isUnlicensed && (
              <div className="space-y-1.5">
                <Label htmlFor="hire-confirm-npn">NPN *</Label>
                <Input
                  id="hire-confirm-npn"
                  inputMode="numeric"
                  value={npn}
                  onChange={(event) => setNpn(event.target.value)}
                  placeholder="5–10 digit NPN"
                />
                <p className="text-xs text-muted-foreground">Required to create the account and start contracting.</p>
              </div>
            )}
            <AlertDialogTitle>
              {isUnlicensed ? "Hiring Unlicensed Applicant" : "Confirm Hire"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left space-y-3">
            <p>
              You are marking <strong>{applicantName}</strong> as hired
              {isUnlicensed && (
                <>
                  . They are currently <span className="text-amber-500 font-medium">unlicensed</span> and will need to complete the licensing process before selling.
                </>
              )}
              .
            </p>

            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/50">
              <Checkbox
                id="bought-course"
                checked={boughtCourse}
                onCheckedChange={(checked) => setBoughtCourse(checked === true)}
              />
              <Label htmlFor="bought-course" className="flex items-center gap-2 cursor-pointer text-sm font-medium leading-normal">
                <BookOpen className="h-4 w-4 text-primary shrink-0" />
                Bought the course on the phone
              </Label>
            </div>

            {isUnlicensed && (
              <p className="text-xs text-muted-foreground">
                They will receive licensing instructions via email after being hired.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!isUnlicensed && !/^\d{5,10}$/.test(npn.replace(/\D+/g, ""))}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Yes, Mark as Hired
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
