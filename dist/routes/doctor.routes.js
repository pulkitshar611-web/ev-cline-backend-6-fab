import { Router } from 'express';
import * as doctorController from '../controllers/doctor.controller.js';
import { protect, restrictTo, ensureClinicContext } from '../middlewares/auth.js';
const router = Router();
router.use(protect, ensureClinicContext);
// Data viewing endpoints (Shared with Admin/Document Controller)
router.get('/assessments', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getAllAssessments);
router.get('/history/:patientId', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getHistory);
router.get('/patients/:patientId/profile', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getPatientProfile);
router.get('/templates', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getTemplates);
router.get('/templates/:id', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getTemplateById);
router.get('/patients', restrictTo('DOCTOR', 'ADMIN', 'DOCUMENT_CONTROLLER'), doctorController.getPatients);
// Doctor only actions
router.use(restrictTo('DOCTOR'));
router.get('/stats', doctorController.getStats);
router.get('/activities', doctorController.getActivities);
router.get('/queue', doctorController.getQueue);
router.post('/assessments', doctorController.createAssessment);
router.get('/assessments', doctorController.getAllAssessments);
router.get('/history/:patientId', doctorController.getHistory);
router.get('/patients/:patientId/profile', doctorController.getPatientProfile);
router.get('/templates', doctorController.getTemplates);
router.get('/patients', doctorController.getPatients);
router.post('/orders', doctorController.createOrder);
router.get('/orders', doctorController.getOrders);
router.get('/revenue', doctorController.getRevenue);
export default router;
