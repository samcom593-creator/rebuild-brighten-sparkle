import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Shared public/workspace control: immediate press feedback, a visible keyboard focus,
// and no movement under reduced motion. Dense sizes stay compact; page action toolbars
// provide their own 44px touch targets. Token fallbacks also work outside the app shell.
const buttonVariants = cva(
  "galaxy-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--apex-r-md,0.5rem)] text-sm font-semibold transition-[background-color,border-color,color,box-shadow,filter,transform] [transition-duration:var(--galaxy-motion-fast,140ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:filter-none disabled:transform-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-95 active:brightness-90",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-95 active:brightness-90",
        outline: "border border-input bg-transparent hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        link: "text-primary underline-offset-4 hover:underline active:opacity-80",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
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
