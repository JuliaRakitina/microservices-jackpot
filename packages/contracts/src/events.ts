import { z } from 'zod';
import { MAX_POINTS } from './points.js';

const id = z.uuid();
const nonnegativePoints = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => value.length < 19 || value <= MAX_POINTS.toString(), {
    message: 'Points outside allowed range',
  });
const positivePoints = nonnegativePoints.refine((value) => value !== '0', {
  message: 'Points must be positive',
});
const stakePayload = z
  .object({ betId: id, userId: id, amount: positivePoints })
  .strict();
const settlementPayload = z
  .object({
    betId: id,
    userId: id,
    won: z.boolean(),
    payout: nonnegativePoints,
  })
  .strict()
  .refine((payload) => payload.won || payload.payout === '0', {
    message: 'A losing settlement cannot create a payout',
    path: ['payout'],
  });

/** Payload schemas are shared by producers, consumers and service handlers. */
export const eventPayloadSchemas = {
  'identity.registered': z.object({ id, email: z.email().max(254) }).strict(),
  'profile.created': z.object({ id }).strict(),
  'bet.requested': stakePayload.extend({
    key: z.string().min(8).max(128),
  }),
  'funds.reserved': stakePayload,
  'funds.rejected': z
    .object({
      betId: id,
      userId: id,
      reason: z.enum(['insufficient_points', 'user_not_found']),
    })
    .strict(),
  'bet.accepted': stakePayload,
  'bet.settled': settlementPayload,
  'payout.applied': settlementPayload,
} as const;

const envelopeSchema = z
  .object({
    id,
    schemaVersion: z.literal(1),
    correlationId: id,
    occurredAt: z.iso.datetime(),
    traceparent: z.string().max(128).optional(),
  })
  .strict();

function eventVariant<T extends keyof typeof eventPayloadSchemas>(type: T) {
  return envelopeSchema.extend({
    type: z.literal(type),
    payload: eventPayloadSchemas[type],
  });
}

/** The discriminator binds each event type to its only accepted v1 payload. */
export const eventSchema = z.discriminatedUnion('type', [
  eventVariant('identity.registered'),
  eventVariant('profile.created'),
  eventVariant('bet.requested'),
  eventVariant('funds.reserved'),
  eventVariant('funds.rejected'),
  eventVariant('bet.accepted'),
  eventVariant('bet.settled'),
  eventVariant('payout.applied'),
]);

export type DomainEvent = z.infer<typeof eventSchema>;
export type EventType = DomainEvent['type'];
export type DomainEventOf<T extends EventType> = Extract<
  DomainEvent,
  { type: T }
>;
export type EventPayload<T extends EventType> = DomainEventOf<T>['payload'];
export const eventTypes = eventSchema.options.map(
  (schema) => schema.shape.type.value,
);
