import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Press feedback (motion review, 2026-10-28): every pressable scales to 0.97 on :active over
// 120ms on a strong ease-out, so the button answers the finger on pointer-down, before the
// click lands. The properties are named one by one (never `all`), the scale is skipped under
// prefers-reduced-motion (the brightness dip stays as the press signal), and the transition
// runs on transform and paint-only properties, so nothing here reflows the page.
//
// The duration and the curve are arbitrary properties, not `duration-[140ms]` / `ease-[...]`:
// with tailwindcss-animate installed this config does not emit those two arbitrary utilities
// (checked with the Tailwind CLI), so the shipped `duration-[140ms]` had always fallen back to
// the 150ms default. `[transition-duration:…]` compiles under every config, the landing one too.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,box-shadow,filter,transform] [transition-duration:120ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.18),0_1px_2px_hsl(0_0%_0%/0.22)] hover:brightness-[1.06] active:brightness-95",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
