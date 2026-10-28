import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Cloud, HandCoins, Loader2, LogOut, Search, Star, UserPlus } from "lucide-react";
import { isSamEmail } from "@/lib/samOnly";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { useNavGrants } from "@/hooks/useNavGrants";
import { useIsTouchDevice } from "@/hooks/useIsTouchDevice";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { useBrand } from "@/hooks/useBrand";
import {
  AGENT_CLOUD_ACCOUNT_NAV,
  AGENT_CLOUD_PRIMARY_NAV,
  APPLICANT_NAV,
  agentCloudGroupIsActive,
  agentCloudItemIsActive,
  initialGroupExpansion,
  isAgentCloudGroup,
  isApplicantViewer,
  isNavGroupOpen,
  navHrefLocation,
  navSectionTone,
  navSectionToneForLocation,
  reconcileGroupExpansion,
  toggleNavGroup,
  type AgentCloudNavEntry,
  type AgentCloudNavGroup,
  type AgentCloudNavItem,
  filterAgentCloudNav,
} from "./agentCloudNavigation";
import { useFavoriteRoutes } from "./favoriteRoutes";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { useUIStore } from "@/shared/store/uiStore";
import { toast } from "sonner";

interface GlobalSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onFullscreenToggle: () => void;
  /** Render inside the focus-trapped mobile Actions sheet, not as a fixed rail. */
  mobile?: boolean;
}

/** How one link row is drawn (colour layer, 2026-10-28). */
interface LeafStyle {
  /** The tone of the section the row belongs to (navSectionTone in agentCloudNavigation.ts). */
  tone: Tone;
  /** A child of a group: plain icon, tighter row, the section's tone only when active. */
  nested?: boolean;
  /** Top-level sections put their icon in a tinted bubble; a favourite keeps its plain star. */
  bubble?: boolean;
}

export function GlobalSidebar({ isOpen, onToggle, isFullscreen, mobile = false }: GlobalSidebarProps) {
  const brand = useBrand();
  const { pathname, search } = useLocation();
  const here = { pathname, search };
  const navigate = useNavigate();
  const { user, isAdmin, isManager, isAgent, hasAgentRecord, isLoading: authLoading, effectiveMode, signOut } = useAuth();
  // MP-332: when Sam previews a role, the nav follows the preview too —
  // otherwise "Recruiter View" showed the recruiter home under the full admin
  // sidebar and told him nothing about what a recruiter actually sees.
  const { isPreviewing, effectiveRole } = useRolePreview();
  const viewMode = isPreviewing ? effectiveRole : effectiveMode;
  const seesAll = isAdmin && !isPreviewing;
  const isTouch = useIsTouchDevice();
  // Rendered from the same store the TopBar star writes to, so pinning a page
  // has a visible result instead of vanishing into localStorage.
  const favorites = useFavoriteRoutes((state) => state.favorites);
  const collapsed = !isOpen;
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await signOut();
      if (error) {
        toast.error("Couldn’t sign out. Please try again.");
        return;
      }
      navigate("/login", { replace: true });
    } catch {
      toast.error("Couldn’t sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  // MP-332: an entry is visible when it has no `modes` allowlist, or the
  // viewer's effective mode is in it. Admin always sees everything. Before this
  // the only gate was `adminOnly`, so a Pure Recruiter or a VA got the full
  // selling sidebar (Book of Business, Retention, Quoter...).
  // One rule for the sidebar and the palette (agentCloudNavigation.ts): the inline copy that lived here drifted the
  // moment a flag (hideWhenSeesAll) was added to the shared one, so the owner's rail kept the VA fallbacks.
  const navGrants = useNavGrants();
  const filterEntries = (entries: AgentCloudNavEntry[]) => filterAgentCloudNav(entries, { seesAll, viewMode, grants: navGrants, isSam: isSamEmail(user?.email) });

  // An applicant is a role-agent login with no agents row (applying mints the
  // login). They get four real next steps, not the producer's Sell/Grow/Book
  // groups. The rule is isApplicantViewer, shared with the phone nav, so the
  // two surfaces cannot disagree about who is an applicant.
  const isApplicant = isApplicantViewer({ authLoading, isAdmin, isManager, isAgent, hasAgentRecord, isPreviewing });
  const primary = isApplicant ? APPLICANT_NAV : filterEntries(AGENT_CLOUD_PRIMARY_NAV);
  const account = filterEntries(AGENT_CLOUD_ACCOUNT_NAV);
  // Everything this viewer's rail shows, in order. A favourite takes the tone of the section
  // that owns its page here, so a pinned Call list is Grow's purple like the item it points at.
  const visible = [...primary, ...account];

  // Group expansion is explicit state. It starts from the route, a chevron
  // click is a choice that stands (for the active group too), and moving into
  // a group the user was not already in opens that group. The reconcile runs
  // during render so the first paint after a route change is already right;
  // reconcileGroupExpansion returns the same object when nothing changed, so
  // this cannot loop.
  const activeGroups = visible
    .filter(isAgentCloudGroup)
    .filter((group) => agentCloudGroupIsActive(here, group))
    .map((group) => group.label);
  const [expansion, setExpansion] = useState(() => initialGroupExpansion(activeGroups));
  const groupState = reconcileGroupExpansion(expansion, activeGroups);
  if (groupState !== expansion) setExpansion(groupState);

  // The shell's one Add Agent / Post a Deal pair lives here, on the desktop rail
  // and in the phone sheet alike; the top bar carries no copy. Add Agent (hiring
  // roles) sits above Post a Deal, the order Sam asked for. An applicant has no
  // agents row to post a deal under, so the pair is absent for them.
  const canAddAgent = isAdmin || isManager;
  const canPostDeal = !isApplicant;
  // Both quick actions are outline buttons at 44px (screen contract, 2026-10-28): the one gold
  // button on any screen is the page's own primary action, and the rail must never compete
  // with it. Before this the rail put a second gold button beside every page's primary. Their
  // icons carry a tone instead (Add Agent good, Post a Deal gold): colour on the glyph, never
  // a second gold fill.
  const quickActionClass = cn(
    "w-full gap-2 text-[15px]",
    mobile ? "h-11 justify-start gap-3 px-3" : collapsed ? "h-11 px-0" : "h-11 justify-start px-3",
  );

  const withTooltip = (label: string, child: ReactNode) => {
    if (!collapsed || isTouch) return child;
    return (
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>{child}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
      </Tooltip>
    );
  };

  // The active row's marker: a short bar in the section's tone beside the tinted row. Decorative
  // (the row's aria-current and semibold label carry the state), so it is hidden from assistive
  // technology.
  const activeBar = (tone: Tone) => (
    <span aria-hidden="true" className={cn("absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full", TONE_CLASS[tone].dot)} />
  );

  // Colour layer (2026-10-28): a top-level row carries its section's icon in a tinted bubble; the
  // active row is tinted in the section's tone with a semibold label. Nothing animates: the rail
  // persists across pages, so an entrance here would replay on every route. When the rail is
  // collapsed the label is not rendered, so the row names itself with aria-label.
  const renderLeaf = (item: AgentCloudNavItem, { tone, nested = false, bubble = !nested }: LeafStyle) => {
    const active = agentCloudItemIsActive(here, item);
    const Icon = item.icon;
    const t = TONE_CLASS[tone];
    return withTooltip(item.label, (
      <Link
        to={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        onClick={mobile ? onToggle : undefined}
        className={cn(
          "relative flex items-center rounded-lg text-[15px] leading-5 transition-colors",
          nested && !mobile ? "min-h-10" : "min-h-11",
          collapsed ? "justify-center px-2" : nested ? "gap-2.5 px-3" : "gap-3 px-3",
          active
            ? cn("font-semibold text-foreground", t.soft)
            : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {active && activeBar(tone)}
        {Icon && (bubble
          ? <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
          : <Icon className={cn("h-[17px] w-[17px] shrink-0", active && t.text)} />)}
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    ));
  };

  const renderGroup = (group: AgentCloudNavGroup) => {
    const active = agentCloudGroupIsActive(here, group);
    const open = isNavGroupOpen(groupState, group.label);
    const tone = navSectionTone(group.label);
    const Icon = group.icon;
    // Expanded, the active child carries the tint; the trigger only firms up its label. Collapsed,
    // the children are hidden, so the trigger itself shows where the person is.
    const tintTrigger = active && collapsed;
    const trigger = (
      <button
        type="button"
        onClick={() => collapsed ? onToggle() : setExpansion((value) => toggleNavGroup(value, group.label))}
        aria-expanded={open}
        aria-label={collapsed ? group.label : undefined}
        className={cn(
          "relative flex min-h-11 w-full items-center rounded-lg text-[15px] leading-5 transition-colors",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
          active ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
          tintTrigger && TONE_CLASS[tone].soft,
        )}
      >
        {tintTrigger && activeBar(tone)}
        <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
        {!collapsed && <span className="flex-1 text-left">{group.label}</span>}
        {!collapsed && <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />}
      </button>
    );

    return (
      <div key={group.label} className="space-y-0.5">
        {withTooltip(group.label, trigger)}
        {!collapsed && open && (
          // The guide line hangs from the centre of the 32px bubble (12px padding + 16px).
          <div className="ml-[27px] space-y-0.5 border-l border-border pl-2">
            {group.items.map((item) => <div key={item.href}>{renderLeaf(item, { tone, nested: true })}</div>)}
          </div>
        )}
      </div>
    );
  };

  const renderEntries = (entries: AgentCloudNavEntry[]) => entries.map((entry) => (
    <div key={entry.label}>
      {isAgentCloudGroup(entry) ? renderGroup(entry) : renderLeaf(entry, { tone: navSectionTone(entry.label) })}
    </div>
  ));

  return (
    <aside
      className={cn(
        "overflow-hidden bg-sidebar",
        mobile
          ? "relative h-full w-full"
          : "fixed inset-y-0 left-0 z-50 border-r border-border transition-[width,opacity] duration-150",
        !mobile && isFullscreen && "pointer-events-none opacity-0",
      )}
      style={mobile ? undefined : { width: isFullscreen ? 0 : collapsed ? 72 : 256 }}
    >
      <div className="flex h-full flex-col">
        <div className={cn("flex h-[60px] shrink-0 items-center border-b border-border", collapsed ? "justify-center" : "px-4", mobile && "pr-14")}>
          <Link
            to="/dashboard"
            onClick={mobile ? onToggle : undefined}
            aria-label={collapsed ? brand.legalName : undefined}
            className="flex min-w-0 items-center gap-3"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Cloud className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-none">
                <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">{brand.legalName}</span>
              </span>
            )}
          </Link>
        </div>

        <div className="shrink-0 px-2 pt-3">
          <Button variant="outline" aria-label="Search people and pages" title="Search people and pages (Ctrl or Command K)"
            className={cn("h-11 w-full gap-2 text-[15px] font-medium", collapsed ? "px-0" : "justify-start px-3")}
            onClick={() => { if (mobile) onToggle(); useUIStore.getState().setCommandPaletteOpen(true); }}>
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Search people & pages</span>}
          </Button>
        </div>
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
          {favorites.length > 0 && (
            <div className="mb-3">
              {!collapsed && <div className="nav-section-label px-3 pb-1.5">Favorites</div>}
              <div className="space-y-0.5">
                {favorites.map((favorite) => (
                  <div key={favorite.href}>
                    {renderLeaf(
                      { label: favorite.label, href: favorite.href, icon: Star },
                      { tone: navSectionToneForLocation(navHrefLocation(favorite.href), visible), bubble: false },
                    )}
                  </div>
                ))}
              </div>
              <div className="my-3 border-t border-border" />
            </div>
          )}
          <div className="space-y-0.5">{renderEntries(primary)}</div>
          <div className="my-3 border-t border-border" />
          {!collapsed && <div className="nav-section-label px-3 pb-1.5">Account</div>}
          <div className="space-y-0.5">{renderEntries(account)}</div>
        </nav>

        {(canAddAgent || canPostDeal) && (
          <div className={cn("shrink-0 border-t border-border p-2", mobile ? "space-y-2" : "space-y-1")}>
            {mobile && <div className="nav-section-label px-2 pt-1">Quick actions</div>}
            {canAddAgent && (
              <AddAgentModal
                trigger={(
                  <Button size="sm" variant="outline" className={quickActionClass} aria-label="Add Agent">
                    <UserPlus className={cn("h-4 w-4 shrink-0", TONE_CLASS.good.text)} />
                    {!collapsed && <span>Add Agent</span>}
                  </Button>
                )}
              />
            )}
            {canPostDeal && (
              <SubmitDealDialog
                trigger={(
                  <Button size="sm" variant="outline" className={quickActionClass} aria-label="Post a Deal">
                    <HandCoins className={cn("h-4 w-4 shrink-0", TONE_CLASS.gold.text)} />
                    {!collapsed && <span>Post a Deal</span>}
                  </Button>
                )}
              />
            )}
          </div>
        )}

        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={cn("h-10 text-[15px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive", mobile && "h-11", collapsed ? "w-full px-0" : "w-full justify-start gap-3 px-3")}
            aria-label="Sign out"
          >
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {!collapsed && <span>{signingOut ? "Signing out…" : "Sign out"}</span>}
          </Button>
        </div>

        {!mobile && <div className="flex h-12 shrink-0 items-center border-t border-border px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn("h-9 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground", collapsed ? "w-full px-0" : "w-full justify-start gap-3 px-3")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span>Collapse sidebar</span>}
          </Button>
        </div>}
      </div>
    </aside>
  );
}
