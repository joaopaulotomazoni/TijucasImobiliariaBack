import { Router } from 'express';
import PaymentsController from '../controllers/payments.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

// Sem verifyEmployee: tela voltada ao cliente ver e pagar as próprias
// parcelas, não ao corretor/admin.
router.get('/payments/my', authMiddleware, PaymentsController.getMyPayments);

router.get(
  '/payments/:parcelaId/boleto',
  authMiddleware,
  PaymentsController.getMyBoleto
);

// O cliente paga usando URL/linha digitável/Pix da cobrança acima. A baixa é
// feita exclusivamente pelo webhook do gateway. O antigo POST /pagar permitia
// que o próprio inquilino declarasse um pagamento legado como concluído.

export default router;
