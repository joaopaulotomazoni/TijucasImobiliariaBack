import { Router } from 'express';
import WebhooksController from '../controllers/webhooks.controller.js';

const router = Router();

// Público de propósito — não leva authMiddleware. A validação é o token no
// header asaas-access-token (ver webhooks.controller.js).
router.post('/webhooks/asaas', WebhooksController.receberAsaas);

export default router;
