import { supabase } from "@/integrations/supabase/client";

export interface LooseResult<T> {
  data: T | null;
  error: Error | null;
}

interface LooseUpdateBuilder<T> {
  eq(column: string, value: unknown): Promise<LooseResult<T>>;
}

interface LooseQuery<T> {
  select(columns: string): LooseQuery<T>;
  eq(column: string, value: unknown): LooseQuery<T>;
  in(column: string, values: unknown[]): LooseQuery<T>;
  order(column: string, options?: Record<string, unknown>): LooseQuery<T>;
  limit(count: number): Promise<LooseResult<T[]>>;
  maybeSingle(): Promise<LooseResult<T | null>>;
  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>): Promise<LooseResult<T>>;
  update(payload: Record<string, unknown>): LooseUpdateBuilder<T>;
}

interface LooseSupabase {
  from<T extends Record<string, unknown> = Record<string, unknown>>(table: string): LooseQuery<T>;
}

export const looseSupabase = supabase as unknown as LooseSupabase;
