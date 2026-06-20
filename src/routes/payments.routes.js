import { Router } from 'express';
import PaymentsController from '../controllers/payments.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

// Sem verifyEmployee: tela voltada ao cliente ver e pagar as próprias
// parcelas, não ao corretor/admin.
router.get('/payments/my', authMiddleware, PaymentsController.getMyPayments);

router.post(
  '/payments/:parcelaId/pagar',
  authMiddleware,
  PaymentsController.registerPayment
);

export default router;
