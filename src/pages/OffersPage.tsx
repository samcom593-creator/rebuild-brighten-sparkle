import { ShoppingCart } from "lucide-react";
import { OffersTiles } from "@/components/dashboard/OffersTiles";
import { PageHeader } from "@/components/ui/page-header";

/** Admin-facing Offers page — moved off the main Dashboard so the dashboard
 *  itself is intel-dense rather than commerce-dense. Linked from the
 *  GlobalSidebar's LEADS section under "Offers". */
export default function OffersPage() {
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <PageHeader
                eyebrow="Admin · Storefront"
        eyebrowIcon={<ShoppingCart className="h-3 w-3" />}
        title="Offers"
        subtitle="All 7 live SKUs · click any tile to open a Stripe Checkout in a new tab."
      />
      <OffersTiles />
    </div>
  );
}
