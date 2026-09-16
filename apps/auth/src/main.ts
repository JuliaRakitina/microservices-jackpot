import { bootstrap } from '../../../packages/runtime/src/bootstrap.js';
import { AuthService } from './service.js';
import { migration } from './migration.js';
await bootstrap(
  migration,
  (db) => new AuthService(db, process.env.JWT_SECRET!),
);
