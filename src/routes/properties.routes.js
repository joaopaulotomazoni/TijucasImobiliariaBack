import { Router } from 'express';
import PropertiesController from '../controllers/properties.controller.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { verifyEmployee } from '../middlewares/verifyEmployee.js';

const router = Router();

router.get(
  '/properties',
  authMiddleware,
  verifyEmployee,
  PropertiesController.getProperties
);

router.post(
  '/properties/register',
  authMiddleware,
  verifyEmployee,
  PropertiesController.registerProperties
);

router.put(
  '/properties/update/:id',
  authMiddleware,
  verifyEmployee,
  PropertiesController.updateProperties
);

router.put(
  '/properties/delete/:id',
  authMiddleware,
  verifyEmployee,
  PropertiesController.deleteProperties
);

router.get(
  '/properties/owners',
  authMiddleware,
  verifyEmployee,
  PropertiesController.getOwners
);

export default router;
