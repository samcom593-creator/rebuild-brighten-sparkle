import { Children, Fragment, isValidElement, ReactElement, ReactNode, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * PageHeader — the header band used across every operating-system route.
 *
 * v4 (2026-05-20): Operational command band with crisp contrast, motion
 * rails, and no decorative blobs. Renders through the same API so 30+
 * existing pages level up automatically.
 *
 * v5 (2026-08-11): Compacted. All numbers below are measured in headless
 * chromium against this component, not estimated — an earlier draft of this
 * comment guessed "~80px mobile" and was wrong by 61px.
 *
 *              v4      v5     reduction
 *   1440px     140px   88px   37%
 *   768px      140px   88px   37%
 *   390px      196px   133px  32%
 *
 * What changed:
 *   - eyebrow moved inline with the title instead of stacking its own row,
 *     which is where most of the desktop height went;
 *   - eyebrow type raised 11px -> 14px (it was the smallest text in the app and
 *     it is metadata an operator is expected to read), and hidden below sm,
 *     where it wrapped to a row of its own;
 *   - title 30px -> 24px, 21.45px on phones. Still the largest thing on screen;
 *   - subtitle clamped to one line below sm;
 *   - the `apex-header-scan` rail is gone. It was a 3.8s infinite alternate
 *     animation running on every route for decoration. The global
 *     prefers-reduced-motion block at index.css:224 made it accessible, not
 *     useful — accessible decoration is still decoration competing with content.
 *
 * Desktop meets the 72-96px target. Mobile does not meet 64-80px and cannot:
 * a 44px minimum touch target for `actions` plus 28px of padding is a 72px
 * floor before a single character of title exists, so any header carrying an
 * action is structurally above the target. 133px is the honest floor with the
 * title, one line of subtitle and a tappable action all present.
 *
 * The accent bar, left sheen and public API are unchanged, so no caller needs
 * editing.
 *
 * v6 (2026-10-15): explicit action slots. `primaryAction`, `secondaryActions`
 * and `viewControls` say what each control is, so the header no longer has to
 * guess. The legacy `actions` bag is still accepted and still ranks its
 * children by data-primary-action, a bg-primary class and the Button variant,
 * so the pages that pass it render as before. The one legacy rule that is gone
 * is the guess from a component's displayName or function name: production is
 * minified (vite.config.ts minify: "esbuild"; the AddAgentModal chunk exports
 * its component as `t`), so that rule returned 10 in production and 70 in dev
 * and the two builds picked different primaries. View controls (tabs,
 * segmented controls, date steppers) render in their own slot at every
 * breakpoint and never go behind More. A legacy bag passed beside the new
 * slots keeps its legacy pick while `primaryAction` is absent, so a page that
 * moves only its date stepper to viewControls keeps its visible primary.
 */
export interface PageHeaderProps {
  eyebrow?: string;
  eyebrowIcon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * Legacy slot: a bag of controls whose primary is inferred from props. New
   * code uses the explicit slots below. Beside them, the bag still supplies the
   * primary by the same inference while `primaryAction` is absent; everything
   * else in it renders among the secondary actions.
   */
  actions?: ReactNode;
  /**
   * The one action this page exists to perform. Visible at every breakpoint.
   * Declaring it, even as null, turns off inference from a legacy `actions` bag.
   */
  primaryAction?: ReactNode;
  /**
   * Less frequent mutations. Inline from sm up, behind "More (n)" on phones.
   * Pass siblings (a fragment or an array), not one wrapper, so each one counts.
   */
  secondaryActions?: ReactNode;
  /** View selection and time navigation. Always visible, never behind More. */
  viewControls?: ReactNode;
  /** Tailwind accent color, defaults to primary. */
  accent?: "primary" | "emerald" | "blue" | "amber" | "rose" | "purple" | "cyan";
  className?: string;
}

const ACCENT_BARS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  // 2026-08-18 template pass: the per-page rainbow gradient bars are retired.
  // One brand accent, everywhere. Map kept so the public API and call sites
  // (100 pages) need zero edits — every value now renders nothing.
  primary: "hidden", emerald: "hidden", blue: "hidden", amber: "hidden",
  rose: "hidden", purple: "hidden", cyan: "hidden",
};

const ACCENT_SHEENS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "hidden", emerald: "hidden", blue: "hidden", amber: "hidden",
  rose: "hidden", purple: "hidden", cyan: "hidden",
};

type ActionElement = ReactElement<{
  children?: ReactNode;
  className?: string;
  variant?: string;
  "data-primary-action"?: boolean;
}>;

function flattenFragments(node: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement(child) && child.type === Fragment) {
      result.push(...flattenFragments((child as ActionElement).props.children));
    } else if (child !== null && child !== undefined && child !== false) {
      result.push(child);
    }
  });
  return result;
}

/**
 * Most callers wrap header controls in one layout-only div. PageHeader owns
 * that layout now, so unwrap that first level and keep meaningful nested groups
 * (date steppers, segmented controls, popovers) intact.
 */
function normalizedActions(actions: ReactNode): ReactNode[] {
  const topLevel = flattenFragments(actions);
  if (topLevel.length !== 1) return topLevel;
  const only = topLevel[0];
  if (isValidElement(only) && only.type === "div") {
    return flattenFragments((only as ActionElement).props.children);
  }
  return topLevel;
}

/**
 * Legacy ranking for the `actions` bag. Only props are read: they survive
 * minification, a component's name does not.
 */
function actionPriority(action: ReactNode): number {
  if (!isValidElement(action)) return 0;
  const element = action as ActionElement;
  if (element.props["data-primary-action"]) return 100;
  if (element.props.className?.includes("bg-primary")) return 90;
  if (element.type === Button) {
    if (!element.props.variant || element.props.variant === "default") return 80;
    if (element.props.variant === "destructive") return 60;
    return 20;
  }
  return 10;
}

function isRenderable(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false && node !== true;
}

/**
 * One toolbar for both paths. The primary stays put at every breakpoint; the
 * secondaries sit inline from sm up and behind "More (n)" below it.
 */
function ActionToolbar({ primary, secondary }: { primary: ReactNode; secondary: ReactNode[] }) {
  const [expanded, setExpanded] = useState(false);
  const disclosureId = useId();
  const hasPrimary = isRenderable(primary);

  if (secondary.length === 0) {
    return hasPrimary ? <div className="apex-page-actions apex-page-actions-single">{primary}</div> : null;
  }
  if (!hasPrimary && secondary.length === 1) {
    return <div className="apex-page-actions apex-page-actions-single">{Children.toArray(secondary)}</div>;
  }

  return (
    <div className="apex-page-actions">
      {hasPrimary && <div className="apex-page-primary-action">{primary}</div>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="apex-page-more-actions h-11 gap-1.5 sm:hidden"
        aria-expanded={expanded}
        aria-controls={disclosureId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Fewer" : `More (${secondary.length})`}
        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
      </Button>
      <div
        id={disclosureId}
        className={cn("apex-page-secondary-actions", expanded ? "flex" : "hidden", "sm:flex")}
      >
        {/* Children.toArray assigns each action a key. The actions arrive as an unkeyed array, which made React warn on
            every page that passes more than one. */}
        {Children.toArray(secondary)}
      </div>
    </div>
  );
}

/** Index of the legacy primary: the highest actionPriority, the first one on a tie. Expects at least one item. */
function legacyPrimaryIndex(items: ReactNode[]): number {
  let primaryIndex = 0;
  for (let index = 1; index < items.length; index += 1) {
    if (actionPriority(items[index]) > actionPriority(items[primaryIndex])) primaryIndex = index;
  }
  return primaryIndex;
}

function LegacyPageActions({ actions }: { actions: ReactNode }) {
  const items = normalizedActions(actions);
  if (items.length <= 1) return <ActionToolbar primary={items[0] ?? null} secondary={[]} />;

  const primaryIndex = legacyPrimaryIndex(items);
  return <ActionToolbar primary={items[primaryIndex]} secondary={items.filter((_, index) => index !== primaryIndex)} />;
}

/**
 * Explicit slots win. While `primaryAction` is absent (undefined, not null), a
 * legacy bag passed beside the new slots still supplies the primary by the same
 * ranking LegacyPageActions uses, so moving only a date stepper to viewControls
 * cannot push the page's default Button behind More on phones. The rest of the
 * bag joins the declared secondaries.
 */
function ExplicitPageActions({ primaryAction, secondaryActions, actions }: Pick<PageHeaderProps, "primaryAction" | "secondaryActions" | "actions">) {
  const declared = normalizedActions(secondaryActions);
  const legacy = normalizedActions(actions);
  if (primaryAction === undefined && legacy.length > 0) {
    const primaryIndex = legacyPrimaryIndex(legacy);
    return (
      <ActionToolbar
        primary={legacy[primaryIndex]}
        secondary={[...declared, ...legacy.filter((_, index) => index !== primaryIndex)]}
      />
    );
  }
  return <ActionToolbar primary={primaryAction ?? null} secondary={[...declared, ...legacy]} />;
}

export function PageHeader({
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  actions,
  primaryAction,
  secondaryActions,
  viewControls,
  accent = "primary",
  className,
}: PageHeaderProps) {
  const explicit = primaryAction !== undefined || secondaryActions !== undefined || viewControls !== undefined;
  const hasViewControls = isRenderable(viewControls);
  return (
    <header
      className={cn(
        "apex-page-header relative mb-4 py-0.5",
        className,
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 ", ACCENT_BARS[accent])} />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-1 opacity-80",
          ACCENT_SHEENS[accent],
        )}
      />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {eyebrowIcon && <span className="text-muted-foreground">{eyebrowIcon}</span>}
            <h1 className="text-xl font-semibold leading-7 tracking-[-0.02em] text-foreground">
              {title}
            </h1>
            {eyebrow && (
              <span
                className={cn(
                  "hidden sm:inline text-xs font-medium text-muted-foreground",
                )}
              >
                · {eyebrow}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground leading-snug line-clamp-1 sm:line-clamp-none">
              {subtitle}
            </p>
          )}
        </div>
        {explicit ? (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            {hasViewControls && (
              <div className="apex-page-view-controls flex flex-wrap items-center gap-2">{viewControls}</div>
            )}
            <ExplicitPageActions primaryAction={primaryAction} secondaryActions={secondaryActions} actions={actions} />
          </div>
        ) : (
          actions && <LegacyPageActions actions={actions} />
        )}
      </div>
    </header>
  );
}
