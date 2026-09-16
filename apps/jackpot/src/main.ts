import { bootstrap } from '../../../packages/runtime/src/bootstrap.js';
import { JackpotService } from './service.js';
import { migration } from './migration.js';
await bootstrap(migration, (db) => new JackpotService(db));
