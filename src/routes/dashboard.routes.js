import { Router } from 'express';
import DashboardController from '../controllers/dashboard.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();
router.get('/dashboard/admin', authMiddleware, verifyEmployee, DashboardController.summary);
export default router;
