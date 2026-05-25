import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { CheckCircle2, Mail, Phone, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type QuickLicenseStatus = "licensed" | "unlicensed";

interface QuickQualifyStepProps {
  firstNameInput: UseFormRegisterReturn<"firstName">;
  emailInput: UseFormRegisterReturn<"email">;
  phoneInput: UseFormRegisterReturn<"phone">;
  firstNameError?: FieldError;
  emailError?: FieldError;
  phoneError?: FieldError;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  onLicenseStatusChange: (value: QuickLicenseStatus) => void;
}

export function QuickQualifyStep({
  firstNameInput,
  emailInput,
  phoneInput,
  firstNameError,
  emailError,
  phoneError,
  licenseStatus,
  onLicenseStatusChange,
}: QuickQualifyStepProps) {
  const options: Array<{ value: QuickLicenseStatus; label: string }> = [
    { value: "licensed", label: "Yes" },
    { value: "unlicensed", label: "No" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Quick Qualify</h2>
        <p className="text-muted-foreground">Start here. The full application opens after this.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="quickFirstName" className="flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          First Name *
        </Label>
        <Input id="quickFirstName" {...firstNameInput} placeholder="John" className="bg-input" />
        {firstNameError && <p className="text-sm text-destructive">{firstNameError.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="quickPhone" className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          Phone Number *
        </Label>
        <Input id="quickPhone" type="tel" {...phoneInput} placeholder="(555) 123-4567" className="bg-input" />
        {phoneError && <p className="text-sm text-destructive">{phoneError.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="quickEmail" className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Email Address *
        </Label>
        <Input id="quickEmail" type="email" {...emailInput} placeholder="john@example.com" className="bg-input" />
        {emailError && <p className="text-sm text-destructive">{emailError.message}</p>}
      </div>

      <div className="space-y-3">
        <Label>Are you licensed? *</Label>
        <div className="grid grid-cols-2 gap-3">
          {options.map((option) => {
            const active = licenseStatus === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onLicenseStatusChange(option.value)}
                className={`h-12 rounded-lg border text-sm font-semibold transition-all ${
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.24)]"
                    : "border-border bg-muted/40 text-foreground hover:border-primary/60"
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {active && <CheckCircle2 className="h-4 w-4" />}
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
