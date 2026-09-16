import { z } from 'zod';
export const eventTypes = [
  'identity.registered',
  'profile.created',
  'bet.requested',
  'funds.reserved',
  'funds.rejected',
  'bet.accepted',
  'bet.settled',
  'payout.applied',
] as const;
export type EventType = (typeof eventTypes)[number];
export type EventPayload = Record<string, unknown>;
export const eventSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(eventTypes),
    correlationId: z.uuid(),
    occurredAt: z.iso.datetime(),
    traceparent: z.string().max(128).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DomainEvent = z.infer<typeof eventSchema>;
