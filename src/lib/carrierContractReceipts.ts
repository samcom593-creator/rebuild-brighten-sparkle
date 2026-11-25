/** Supported keys of the existing team receipt RPC, not a catalog of available carrier offers. */
export const RECEIPT_CARRIERS = [
  { key: "chubb", label: "Chubb" },
  { key: "ethos", label: "Ethos" },
  { key: "ahl", label: "American Home Life" },
] as const;

export type ReceiptCarrierKey = (typeof RECEIPT_CARRIERS)[number]["key"];
export interface CarrierContractReceipts {
  chubb: boolean;
  ethos: boolean;
  ahl: boolean;
  ahl_exempt: boolean;
  chubb_at: string | null;
  ethos_at: string | null;
  ahl_at: string | null;
}

/** A missing/malformed read is not three unreceived contracts. */
export function parseCarrierContractReceipts(value: unknown): CarrierContractReceipts {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Carrier contract receipts did not load.");
  const row = value as Record<string, unknown>;
  if (typeof row.ahl_exempt !== "boolean") throw new Error("Carrier contract receipts were incomplete.");
  for (const { key } of RECEIPT_CARRIERS) {
    const date = row[`${key}_at`];
    if (typeof row[key] !== "boolean" || (date !== null && (typeof date !== "string" || !Number.isFinite(Date.parse(date))))) {
      throw new Error("Carrier contract receipts were incomplete.");
    }
    if (row[key] !== (date !== null)) throw new Error("Carrier receipt and date did not agree.");
  }
  return {
    chubb: row.chubb as boolean, ethos: row.ethos as boolean, ahl: row.ahl as boolean, ahl_exempt: row.ahl_exempt,
    chubb_at: row.chubb_at as string | null, ethos_at: row.ethos_at as string | null, ahl_at: row.ahl_at as string | null,
  };
}
