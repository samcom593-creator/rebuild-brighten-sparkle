import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizeQuickAddAgent,
  quickAddAgentSchema,
  type QuickAddAgentInput,
} from "@/lib/apexCareerToolkit";

interface QuickAddAgentDialogProps {
  trigger?: ReactNode;
  onAgentAdded?: (agentId: string) => void;
}

type FieldName = keyof QuickAddAgentInput;
type FieldErrors = Partial<Record<FieldName, string>>;
type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};
type RpcClient = {
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

const toolkitRpc = (supabase as unknown as RpcClient).rpc.bind(supabase);

const EMPTY_FORM: QuickAddAgentInput = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  paNumber: "",
};

function responseAgentId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const id = result.agentId ?? result.applicationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function QuickAddAgentDialog({
  trigger,
  onAgentAdded,
}: QuickAddAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<QuickAddAgentInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  const updateField = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && !saving) {
      setForm(EMPTY_FORM);
      setErrors({});
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = quickAddAgentSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined;
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    const normalized = normalizeQuickAddAgent(parsed.data);
    setSaving(true);
    try {
      const { data, error } = await toolkitRpc("create_apex_toolkit_agent", {
        p_first_name: normalized.firstName,
        p_last_name: normalized.lastName,
        p_email: normalized.email,
        p_phone: normalized.phone,
        p_pa_number: normalized.paNumber,
      });
      if (error) throw error;

      const agentId = responseAgentId(data);
      if (!agentId) throw new Error("The agent was not returned after saving.");

      toast.success(`${normalized.firstName} ${normalized.lastName} was added to the licensed journey.`);
      setOpen(false);
      setForm(EMPTY_FORM);
      setErrors({});
      onAgentAdded?.(agentId);
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "Agent could not be added.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="h-10 gap-2 sm:h-9">
            <UserPlus className="h-4 w-4" />
            Add Agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
          <DialogDescription>
            Add a licensed agent to the call queue and start their persisted APEX journey.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="quick-agent-first-name"
              label="First name"
              value={form.firstName}
              error={errors.firstName}
              autoComplete="given-name"
              onChange={(value) => updateField("firstName", value)}
            />
            <Field
              id="quick-agent-last-name"
              label="Last name"
              value={form.lastName}
              error={errors.lastName}
              autoComplete="family-name"
              onChange={(value) => updateField("lastName", value)}
            />
          </div>
          <Field
            id="quick-agent-email"
            label="Email address"
            value={form.email}
            error={errors.email}
            type="email"
            autoComplete="email"
            inputMode="email"
            onChange={(value) => updateField("email", value)}
          />
          <Field
            id="quick-agent-phone"
            label="Phone number"
            value={form.phone}
            error={errors.phone}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(602) 555-0123"
            onChange={(value) => updateField("phone", value)}
          />
          <Field
            id="quick-agent-pa-number"
            label="PA number"
            value={form.paNumber}
            error={errors.paNumber}
            autoComplete="off"
            placeholder="PA 2048"
            onChange={(value) => updateField("paNumber", value)}
          />

          <DialogFooter>
            <Button type="submit" className="h-11 w-full gap-2 sm:h-10 sm:w-auto" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {saving ? "Adding agent..." : "Add Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  ...inputProps
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...inputProps}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="h-11 sm:h-10"
      />
      {error && (
        <p id={errorId} className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
