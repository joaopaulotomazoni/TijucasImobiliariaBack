import { Router } from 'express';
import UsersController from '../controllers/users.controller.js';
import {
  loginRateLimit,
  registrationRateLimit,
  verificationRateLimit,
} from '../middlewares/rateLimits.js';

const router = Router();

router.post('/login', loginRateLimit, UsersController.login);
router.post('/logout', UsersController.logout);

router.put(
  '/register/save-account',
  registrationRateLimit,
  UsersController.registerUser
);

router.post(
  '/register/resend-verify-code',
  verificationRateLimit,
  UsersController.sendVerifyCode
);

router.post(
  '/register/verify-code',
  verificationRateLimit,
  UsersController.confirmVerifyCode
);

router.post(
  '/forgot-password/send-code',
  verificationRateLimit,
  UsersController.sendVerifyCode
);

router.post(
  '/forgot-password/update-password',
  verificationRateLimit,
  UsersController.updatePassword
);

export default router;
