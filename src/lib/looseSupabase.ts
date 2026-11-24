import { supabase } from "@/integrations/supabase/client";

export interface LooseResult<T> {
  data: T | null;
  error: Error | null;
  count?: number | null;
}

interface LooseUpdateBuilder<T> {
  eq(column: string, value: unknown): Promise<LooseResult<T>>;
}

// PostgREST queries are awaitable builders. A filter or limit does not execute
// the request or remove later modifiers such as range() and maybeSingle().
interface LooseQuery<T> extends PromiseLike<LooseResult<T[]>> {
  select(columns: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): LooseQuery<T>;
  eq(column: string, value: unknown): LooseQuery<T>;
  is(column: string, value: null | boolean): LooseQuery<T>;
  gte(column: string, value: string | number): LooseQuery<T>;
  in(column: string, values: unknown[]): LooseQuery<T>;
  or(filters: string, options?: { referencedTable?: string; foreignTable?: string }): LooseQuery<T>;
  order(column: string, options?: Record<string, unknown>): LooseQuery<T>;
  limit(count: number): LooseQuery<T>;
  range(from: number, to: number): LooseQuery<T>;
  maybeSingle(): PromiseLike<LooseResult<T | null>>;
  insert(payload: Record<string, unknown> | Record<string, unknown>[]): Promise<LooseResult<T>>;
  upsert(payload: Record<string, unknown> | Record<string, unknown>[], options?: Record<string, unknown>): Promise<LooseResult<T>>;
  update(payload: Record<string, unknown>): LooseUpdateBuilder<T>;
}

interface LooseSupabase {
  from<T extends object = Record<string, unknown>>(table: string): LooseQuery<T>;
  /**
   * Untyped RPC. The generated overloads of supabase.rpc are "excessively deep" for the compiler
   * (TS2589) once types.ts carries 879 relations (regen of 2026-11-05), and the old
   * `supabase.rpc as (...) => ReturnType<typeof supabase.rpc>` casts tipped over one by one.
   * The caller narrows `data` by hand, exactly as it already did.
   */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<LooseResult<T>>;
}

export const looseSupabase = supabase as unknown as LooseSupabase;
