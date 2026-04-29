import { OffersTiles } from "@/components/dashboard/OffersTiles";

/** Admin-facing Offers page — moved off the main Dashboard so the dashboard
 *  itself is intel-dense rather than commerce-dense. Linked from the
 *  GlobalSidebar's LEADS section under "Offers". */
export default function OffersPage() {
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Offers</h1>
        <p className="text-sm text-muted-foreground">
          All 7 live SKUs · click any tile to open a Stripe Checkout in a new tab.
        </p>
      </div>
      <OffersTiles />
    </div>
  );
}
