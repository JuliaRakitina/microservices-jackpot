import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import pino from 'pino';
export function logger(service: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service },
    redact: [
      'password',
      'token',
      'authorization',
      'jwt',
      'databaseUrl',
      'brokerUrl',
      'req.headers.authorization',
    ],
  });
}
let sdk: NodeSDK | undefined;
export function startTracing() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
  sdk.start();
}
export async function stopTracing() {
  await sdk?.shutdown();
}
export function traceHeader(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}
export async function withSpan<T>(
  name: string,
  correlationId: string,
  fn: () => Promise<T>,
  traceparent?: string,
): Promise<T> {
  const parent = traceparent
    ? propagation.extract(context.active(), { traceparent })
    : context.active();
  return context.with(parent, () =>
    trace.getTracer('jackpot').startActiveSpan(name, async (span) => {
      span.setAttribute('correlation.id', correlationId);
      try {
        return await fn();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}
