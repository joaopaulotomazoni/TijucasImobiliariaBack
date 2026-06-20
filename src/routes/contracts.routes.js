import { Router } from 'express';
import ContractsController from '../controllers/contracts.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

router.get(
  '/contracts',
  authMiddleware,
  verifyEmployee,
  ContractsController.getContracts
);

router.get(
  '/contracts/:id',
  authMiddleware,
  verifyEmployee,
  ContractsController.getContractById
);

router.post(
  '/contracts/register',
  authMiddleware,
  verifyEmployee,
  ContractsController.registerContract
);

router.put(
  '/contracts/update/:id',
  authMiddleware,
  verifyEmployee,
  ContractsController.updateContract
);

router.delete(
  '/contracts/delete/:id',
  authMiddleware,
  verifyEmployee,
  ContractsController.deleteContract
);

export default router;
