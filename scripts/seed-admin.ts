import { randomUUID } from 'node:crypto';
import { Database } from '../packages/runtime/src/database.js';
import { AuthService } from '../apps/auth/src/service.js';
import { z } from 'zod';

// Explicit operator command. No production startup automatically creates an admin.
const email = z
  .email()
  .parse(process.env.ADMIN_EMAIL ?? process.env.DEMO_ADMIN_EMAIL);
const password = z
  .string()
  .min(12)
  .max(128)
  .parse(process.env.ADMIN_PASSWORD ?? process.env.DEMO_ADMIN_PASSWORD);
const auth = new Database(z.url().parse(process.env.AUTH_DATABASE_URL));
const users = new Database(z.url().parse(process.env.USERS_DATABASE_URL));
try {
  await auth.connect();
  await users.connect();
  const service = new AuthService(
    auth,
    z.string().min(32).parse(process.env.JWT_SECRET),
  );
  let identity: { id: string };
  try {
    identity = await service.register({ email, password }, randomUUID());
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ALREADY_EXISTS'
    )
      throw error;
    const login = await service.login({ email, password });
    identity = await service.verify({ token: login.accessToken });
  }
  const deadline = Date.now() + 30000;
  let promoted = false;
  while (Date.now() < deadline) {
    const updated = await users.query(
      "WITH promoted AS (UPDATE profiles SET role='admin' WHERE id=$1 RETURNING id) SELECT id FROM promoted",
      [identity.id],
    );
    if (updated.length) {
      promoted = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!promoted)
    throw new Error(
      'Profile provisioning timed out; retry after broker recovery',
    );
  console.log(JSON.stringify({ adminId: identity.id, status: 'ready' }));
} finally {
  await auth.close();
  await users.close();
}
