import { Router } from 'express';
import DocumentsController from '../controllers/documents.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

router.get('/clients/:usuarioId/documents', authMiddleware, DocumentsController.list);
router.post('/clients/:usuarioId/documents', authMiddleware, DocumentsController.create);
router.put('/client-documents/:id/status', authMiddleware, verifyEmployee, DocumentsController.review);
router.get('/notifications/my', authMiddleware, DocumentsController.myNotifications);
router.put('/notifications/:id/read', authMiddleware, DocumentsController.readNotification);

export default router;
