import type { FastifyInstance } from 'fastify';
import { registerAuthRoutes as registerBaseAuthRoutes } from './routes.base.js';
import { registerAdminRoutes } from '../admin/routes.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  await registerBaseAuthRoutes(app);
  await registerAdminRoutes(app);
}
