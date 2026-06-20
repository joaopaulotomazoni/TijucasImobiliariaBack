import { Router } from 'express';
import ClientsController from '../controllers/clients.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

router.post(
  '/client/register',
  authMiddleware,
  verifyEmployee,
  ClientsController.registerClients
);

router.get(
  '/client',
  authMiddleware,
  verifyEmployee,
  ClientsController.getClients
);

router.put(
  '/client/update/:id',
  authMiddleware,
  verifyEmployee,
  ClientsController.updateClient
);

router.delete(
  '/client/delete/:id',
  authMiddleware,
  verifyEmployee,
  ClientsController.deleteClient
);

export default router;
