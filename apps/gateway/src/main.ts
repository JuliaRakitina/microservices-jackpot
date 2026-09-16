import { config } from '../../../packages/config/src/index.js';
import { createClients } from '../../../packages/contracts/src/rpc.js';
import {
  startTracing,
  stopTracing,
  logger,
} from '../../../packages/observability/src/index.js';
import { createGateway } from './app.js';

const settings = config();
startTracing();
const rpc = createClients(settings.addresses, settings.internalToken);
const app = await createGateway(rpc.clients, async () => {
  if (!(await rpc.ready())) return false;
  const results = await Promise.all(
    Object.entries(settings.addresses).map(async ([name, address]) => {
      const healthUrl =
        process.env[`${name.toUpperCase()}_HEALTH_URL`] ??
        `http://${address.split(':')[0]}:3000/ready`;
      try {
        return (await fetch(healthUrl, { signal: AbortSignal.timeout(1500) }))
          .ok;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
});
await app.listen(settings.httpPort, '0.0.0.0');
logger('gateway').info({ event: 'gateway_started' }, 'Gateway listening');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  rpc.close();
  await stopTracing();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
