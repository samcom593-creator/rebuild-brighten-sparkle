import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

// Plain <label>, not @radix-ui/react-label (PL-WIB-APPLY-RADIX, 2026-10-06).
// Label is on the first paint of /apply, and importing the radix primitive
// pulled the whole 163 KB vendor-radix chunk in front of the LCP heading.
// The one behaviour radix added is reproduced here: a double-click on the
// label text does not select it, unless the click landed on a form control.
const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<"label"> & VariantProps<typeof labelVariants>
>(({ className, onMouseDown, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(labelVariants(), className)}
    onMouseDown={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, input, select, textarea")) return;
      onMouseDown?.(event);
      if (!event.defaultPrevented && event.detail > 1) event.preventDefault();
    }}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
