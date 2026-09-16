// Lightweight schema validation (no zod dependency to keep bundle small)
export type Validator<T> = (value: unknown) => T;

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

// MP-549: `required` has always been enforced at RUNTIME (the throw in the
// implementation below) and was never expressed in the type, so every required
// string field typed as `string | undefined`. That produced four baseline
// errors that were pure noise -- notify-deal-alert TS18048, notify-notes-added
// TS18048, and verify-nipr's 2x TS2345 (niprNumber + state, both required) --
// and noise is how a type-checker gets silenced. Two call signatures, so the
// declaration says what the runtime does. Object literals cannot carry
// overloads, hence the factory type plus the one cast at the implementation;
// both directions are asserted in validate.string.test.ts so the cast cannot
// drift away from the runtime it stands for.
interface StringValidatorFactory {
  (opts: { min?: number; max?: number; required: true }): Validator<string>;
  (opts?: { min?: number; max?: number; required?: false }): Validator<string | undefined>;
}

export const v = {
  string: ((opts: { min?: number; max?: number; required?: boolean } = {}) => {
    return (val: unknown) => {
      if (val === undefined || val === null || val === "") {
        if (opts.required) throw new ValidationError("value", "is required");
        return undefined;
      }
      if (typeof val !== "string") throw new ValidationError("value", "must be a string");
      if (opts.min !== undefined && val.length < opts.min) throw new ValidationError("value", `min length ${opts.min}`);
      if (opts.max !== undefined && val.length > opts.max) throw new ValidationError("value", `max length ${opts.max}`);
      return val;
    };
  }) as StringValidatorFactory,
  email(): Validator<string> {
    return (val: unknown) => {
      if (typeof val !== "string" || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)) {
        throw new ValidationError("email", "must be a valid email");
      }
      return val.toLowerCase().trim();
    };
  },
  uuid(): Validator<string> {
    return (val: unknown) => {
      if (typeof val !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
        throw new ValidationError("uuid", "must be a valid UUID");
      }
      return val;
    };
  },
  number(opts: { min?: number; max?: number } = {}): Validator<number> {
    return (val: unknown) => {
      const n = typeof val === "string" ? parseFloat(val) : val;
      if (typeof n !== "number" || isNaN(n)) throw new ValidationError("value", "must be a number");
      if (opts.min !== undefined && n < opts.min) throw new ValidationError("value", `min ${opts.min}`);
      if (opts.max !== undefined && n > opts.max) throw new ValidationError("value", `max ${opts.max}`);
      return n;
    };
  },
  object<T extends Record<string, Validator<any>>>(shape: T): Validator<{ [K in keyof T]: ReturnType<T[K]> }> {
    return (val: unknown) => {
      if (typeof val !== "object" || val === null) throw new ValidationError("body", "must be an object");
      const result: any = {};
      for (const [key, validator] of Object.entries(shape)) {
        try {
          result[key] = validator((val as any)[key]);
        } catch (e) {
          if (e instanceof ValidationError) throw new ValidationError(key, e.message.split(": ").slice(1).join(": "));
          throw e;
        }
      }
      return result;
    };
  },
  enum<T extends string>(values: readonly T[]): Validator<T> {
    return (val: unknown) => {
      if (typeof val !== "string" || !values.includes(val as T)) {
        throw new ValidationError("value", `must be one of: ${values.join(", ")}`);
      }
      return val as T;
    };
  },
  // MP-548: compose optionality instead of chaining it. `v.enum(X).optional()`
  // was a 142-day boot death: Validator<T> is a plain function, so that method
  // does not exist and the expression threw a TypeError at MODULE scope --
  // before Deno.serve ran, which is why the failure never reached the handler
  // (and so never reached function_errors). Write v.optional(v.enum(X)).
  // Existing validators are untouched; this only wraps.
  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return (val: unknown) => (val === undefined || val === null || val === "" ? undefined : inner(val));
  },
  any(): Validator<unknown> {
    return (val: unknown) => val;
  },
};

export async function parseBody<T>(req: Request, validator: Validator<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("body", "must be valid JSON");
  }
  return validator(body);
}
