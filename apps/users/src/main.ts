import { bootstrap } from '../../../packages/runtime/src/bootstrap.js';
import { UsersService } from './service.js';
import { migration } from './migration.js';
await bootstrap(migration, (db) => new UsersService(db));
