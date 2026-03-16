import { useState } from "react";
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

interface HireConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (boughtCourse: boolean) => void;
  applicantName: string;
  isUnlicensed: boolean;
}

export function HireConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  applicantName,
  isUnlicensed,
}: HireConfirmModalProps) {
  const [boughtCourse, setBoughtCourse] = useState(false);

  const handleConfirm = () => {
    onConfirm(boughtCourse);
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
          <AlertDialogAction onClick={handleConfirm} className="bg-emerald-600 hover:bg-emerald-700">
            Yes, Mark as Hired
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
