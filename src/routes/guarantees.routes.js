import { Router } from 'express';
import GuaranteesController from '../controllers/guarantees.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

router.get(
  '/contracts/:contratoId/guarantee',
  authMiddleware,
  verifyEmployee,
  GuaranteesController.getGuaranteesByContract
);

router.post(
  '/contracts/:contratoId/guarantee',
  authMiddleware,
  verifyEmployee,
  GuaranteesController.createGuarantee
);

router.put(
  '/guarantees/:id/substitute',
  authMiddleware,
  verifyEmployee,
  GuaranteesController.substituteGuarantee
);

router.put(
  '/guarantees/:id/caucao/devolucao',
  authMiddleware,
  verifyEmployee,
  GuaranteesController.registerCaucaoDevolucao
);

router.put(
  '/guarantees/:id/fiadores/:usuarioId/exonerar',
  authMiddleware,
  verifyEmployee,
  GuaranteesController.exonerarFiador
);

export default router;
