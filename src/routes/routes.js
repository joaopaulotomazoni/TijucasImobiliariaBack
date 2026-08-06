import { Router } from 'express';
import authRoutes from './auth.routes.js';
import propertiesRoutes from './properties.routes.js';
import clientsRoutes from './clients.routes.js';
import contractsRoutes from './contracts.routes.js';
import guaranteesRoutes from './guarantees.routes.js';
import uploadsRoutes from './uploads.routes.js';
import paymentsRoutes from './payments.routes.js';
import billingRoutes from './billing.routes.js';
import webhooksRoutes from './webhooks.routes.js';
import documentsRoutes from './documents.routes.js';
import dashboardRoutes from './dashboard.routes.js';

const router = Router();

router.use(authRoutes);
router.use(propertiesRoutes);
router.use(clientsRoutes);
router.use(contractsRoutes);
router.use(guaranteesRoutes);
router.use(uploadsRoutes);
router.use(paymentsRoutes);
router.use(billingRoutes);
router.use(webhooksRoutes);
router.use(documentsRoutes);
router.use(dashboardRoutes);

export default router;
