import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock } from "lucide-react";

interface SessionWarningDialogProps {
  open: boolean;
  secondsRemaining: number;
  onStay: () => void;
  onSignOut: () => void;
}

export function SessionWarningDialog({ open, secondsRemaining, onStay, onSignOut }: SessionWarningDialogProps) {
  const mm = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
  const ss = (secondsRemaining % 60).toString().padStart(2, "0");

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="border-border/60 bg-background">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <AlertDialogTitle>Still there?</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                You'll be signed out automatically in{" "}
                <span className="font-mono font-semibold text-foreground">
                  {mm}:{ss}
                </span>{" "}
                due to inactivity.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onSignOut}>Sign out</AlertDialogCancel>
          <AlertDialogAction onClick={onStay}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
