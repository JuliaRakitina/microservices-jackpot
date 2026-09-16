import { bootstrap } from '../../../packages/runtime/src/bootstrap.js';
import { BetsService } from './service.js';
import { migration } from './migration.js';
await bootstrap(migration, (db) => new BetsService(db));
