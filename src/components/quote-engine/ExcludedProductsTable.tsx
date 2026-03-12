import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ExcludedProduct } from "@/lib/quoteEngineTypes";

interface ExcludedProductsTableProps {
  products: ExcludedProduct[];
}

export function ExcludedProductsTable({ products }: ExcludedProductsTableProps) {
  const [open, setOpen] = useState(false);

  if (products.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between text-sm text-muted-foreground hover:text-foreground">
          <span>Excluded Products ({products.length})</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border border-border rounded-lg overflow-hidden mt-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs">Carrier</TableHead>
                <TableHead className="text-xs">Product</TableHead>
                <TableHead className="text-xs">Exclusion Reason</TableHead>
                <TableHead className="text-xs">Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((ep, i) => (
                <TableRow key={i} className="text-muted-foreground">
                  <TableCell className="text-xs">{ep.carrier.name}</TableCell>
                  <TableCell className="text-xs">{ep.product.name}</TableCell>
                  <TableCell className="text-xs">{ep.exclusionReason}</TableCell>
                  <TableCell className="text-xs font-mono">{ep.ruleTriggered}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
