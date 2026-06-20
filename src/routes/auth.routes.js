import { Router } from 'express';
import UsersController from '../controllers/users.controller.js';

const router = Router();

router.post('/login', UsersController.login);

router.put('/register/save-account', UsersController.registerUser);

router.post('/register/resend-verify-code', UsersController.sendVerifyCode);

router.post('/register/verify-code', UsersController.confirmVerifyCode);

router.post('/forgot-password/send-code', UsersController.sendVerifyCode);

router.post('/forgot-password/update-password', UsersController.updatePassword);

export default router;
