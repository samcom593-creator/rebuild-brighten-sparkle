

# Fix React Ref Warning in Badge Component

## Issue Identified
Console warning: "Function components cannot be given refs" in `ManagerTeamView.tsx` when `Badge` components are rendered.

## Root Cause
The `Badge` component in `src/components/ui/badge.tsx` is a function component that doesn't use `React.forwardRef()`. When parent components (like tooltip triggers or motion wrappers) try to pass refs to Badge, React warns about this.

## Solution
Update the `Badge` component to use `React.forwardRef()` so it can properly receive refs from parent components.

## Changes to Make

### Update `src/components/ui/badge.tsx`

Transform from:
```typescript
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

To:
```typescript
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";
```

## Technical Details
- Uses `React.forwardRef<HTMLDivElement, BadgeProps>` to properly type the ref
- Passes the `ref` to the underlying `<div>` element
- Adds `displayName` for better debugging in React DevTools
- No changes needed to any consuming components

## Files to Modify
1. `src/components/ui/badge.tsx` - Add forwardRef wrapper

## Result
- ✅ Eliminates React ref warning in console
- ✅ Enables Badge to work with Tooltips, motion wrappers, and other ref-forwarding patterns
- ✅ Follows React best practices for component composition

