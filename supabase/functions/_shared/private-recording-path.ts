export const hasControlCharacter = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

// Storage SDK URL construction can normalize encoded dot segments. Require an
// unescaped relative object key so malformed authorized metadata cannot change buckets.
export const isPrivateRecordingPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 2048
  && value.trim() === value && !/[:%?#\\]/.test(value) && !hasControlCharacter(value)
  && value.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");
