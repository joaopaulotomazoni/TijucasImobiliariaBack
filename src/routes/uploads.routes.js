import { Router } from 'express';
import UploadsController from '../controllers/uploads.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

// Sem verifyEmployee: além do corretor (comprovante de renda, apólice), o
// cliente também precisa subir e visualizar o próprio comprovante de
// pagamento. O `tipo` já é validado contra uma lista fechada no controller.
router.post('/uploads/presign', authMiddleware, UploadsController.presign);

router.get('/uploads/download', authMiddleware, UploadsController.download);

export default router;
