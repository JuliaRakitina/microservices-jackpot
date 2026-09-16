import { DomainError } from './errors.js';
export const MAX_POINTS = 9223372036854775807n;
export function points(value: unknown, allowZero = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value))
    throw new DomainError(
      'INVALID_ARGUMENT',
      'Points must be a canonical decimal string',
    );
  const amount = BigInt(value);
  if (amount > MAX_POINTS || (!allowZero && amount === 0n))
    throw new DomainError('INVALID_ARGUMENT', 'Points outside allowed range');
  return amount;
}
export function contribution(stake: bigint): bigint {
  return stake / 10n;
}
