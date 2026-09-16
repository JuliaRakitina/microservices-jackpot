import { z } from 'zod';
export const errorCodes = [
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'FAILED_PRECONDITION',
  'UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DomainError('INVALID_ARGUMENT', 'Invalid request');
  return result.data;
}
