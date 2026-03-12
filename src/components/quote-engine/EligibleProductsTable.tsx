import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ProductBadges } from "./ProductBadges";
import type { QuoteRecommendation } from "@/lib/quoteEngineTypes";

interface EligibleProductsTableProps {
  products: QuoteRecommendation[];
}

export function EligibleProductsTable({ products }: EligibleProductsTableProps) {
  if (products.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-foreground">All Eligible Products ({products.length})</h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10 text-xs">#</TableHead>
              <TableHead className="text-xs">Carrier</TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs text-right">Premium</TableHead>
              <TableHead className="text-xs text-right">Face</TableHead>
              <TableHead className="text-xs">Benefit</TableHead>
              <TableHead className="text-xs text-center">Approval</TableHead>
              <TableHead className="text-xs text-right">Comp</TableHead>
              <TableHead className="text-xs">Features</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((rec) => (
              <TableRow key={`${rec.carrier.id}-${rec.product.id}`} className="hover:bg-muted/20">
                <TableCell className="text-xs font-bold text-muted-foreground">{rec.rank}</TableCell>
                <TableCell className="text-xs font-medium">{rec.carrier.name}</TableCell>
                <TableCell className="text-xs">{rec.product.name}</TableCell>
                <TableCell className="text-xs text-right font-mono">
                  {rec.monthlyPremium !== null ? `$${rec.monthlyPremium.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell className="text-xs text-right font-mono">
                  {rec.faceAmount !== null ? `$${rec.faceAmount.toLocaleString()}` : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {rec.benefitType.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-xs font-mono">{rec.scores.approvalScore.toFixed(0)}</span>
                </TableCell>
                <TableCell className="text-xs text-right font-mono">
                  {rec.commissionValue !== null ? `$${rec.commissionValue.toFixed(0)}` : "—"}
                </TableCell>
                <TableCell>
                  <ProductBadges badges={rec.badges} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
