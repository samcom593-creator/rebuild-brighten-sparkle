import { useEffect, useState } from "react";
import { LEAD_PAGE_SIZE } from "@/lib/leadWorklist";

export function useLeadPagination<T>(rows: readonly T[], filterKey: string) {
  const [requestedPage, setPage] = useState(0);
  useEffect(() => setPage(0), [filterKey]);
  const pageCount = Math.max(1, Math.ceil(rows.length / LEAD_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1);
  return { page, pageCount, setPage, pageSize: LEAD_PAGE_SIZE, total: rows.length,
    items: rows.slice(page * LEAD_PAGE_SIZE, (page + 1) * LEAD_PAGE_SIZE) };
}
