import { Router } from 'express';
import BillingController from '../controllers/billing.controller.js';
import PayoutsController from '../controllers/payouts.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

// Gestão de cobrança/repasse é tela de funcionário (ADMIN/CORRETOR); o
// autoatendimento do inquilino continua em payments.routes.js.
router.post(
  '/contracts/:contratoId/charges/batch',
  authMiddleware,
  verifyEmployee,
  BillingController.gerarLote
);
router.post(
  '/contracts/:contratoId/charges',
  authMiddleware,
  verifyEmployee,
  BillingController.gerarCobranca
);
router.post(
  '/contracts/:contratoId/charges/cancel-all',
  authMiddleware,
  verifyEmployee,
  BillingController.cancelarCobrancasDoContrato
);
router.get('/charges', authMiddleware, verifyEmployee, BillingController.listarCobrancas);
router.get('/charges/:id', authMiddleware, verifyEmployee, BillingController.detalharCobranca);
router.get(
  '/charges/:id/second-copy',
  authMiddleware,
  verifyEmployee,
  BillingController.segundaVia
);
router.post(
  '/charges/:id/cancel',
  authMiddleware,
  verifyEmployee,
  BillingController.cancelarCobranca
);
router.post(
  '/charges/:id/manual-payment',
  authMiddleware,
  verifyEmployee,
  BillingController.baixaManual
);
router.post(
  '/charges/:id/payout',
  authMiddleware,
  verifyEmployee,
  PayoutsController.dispararRepasse
);
router.get(
  '/owners/:id/payouts',
  authMiddleware,
  verifyEmployee,
  PayoutsController.listarRepasses
);

export default router;
