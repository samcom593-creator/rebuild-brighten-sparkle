// Lightweight schema validation (no zod dependency to keep bundle small)
export type Validator<T> = (value: unknown) => T;

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ValidationError";
  }
}

export const v = {
  string(opts: { min?: number; max?: number; required?: boolean } = {}): Validator<string | undefined> {
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
  },
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
