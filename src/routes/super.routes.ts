import { Router } from 'express';
import * as superController from '../controllers/super.controller.js';
import { protect, restrictTo } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createClinicSchema, createStaffSchema } from '../validations/super.validation.js';

const router = Router();

router.use(protect, restrictTo('SUPER_ADMIN'));

// ==================== DASHBOARD ====================
router.get('/dashboard/stats', superController.getDashboardStats);
router.get('/alerts', superController.getSystemAlerts);

// ==================== CLINICS ====================
router.get('/clinics', superController.getClinics);
router.post('/clinics', validate(createClinicSchema), superController.createClinic);
router.patch('/clinics/:id', superController.updateClinic);
router.patch('/clinics/:id/status', superController.toggleClinicStatus);
router.delete('/clinics/:id', superController.deleteClinic);
router.patch('/clinics/:id/modules', superController.updateModules);
router.get('/clinics/:id/insights', superController.getClinicInsights);
router.patch('/clinics/:id/subscription', superController.updateSubscription);
router.post('/impersonate/clinic', superController.impersonateClinic);
router.post('/impersonate/user', superController.impersonateUser);
router.post('/users/reset-password', superController.resetUserPassword);

// ==================== STAFF ====================
router.get('/staff', superController.getStaff);
router.post('/clinics/:id/admin', validate(createStaffSchema), superController.createAdmin);
router.patch('/staff/:id', superController.updateStaff);
router.patch('/staff/:id/status', superController.toggleStaffStatus);
router.delete('/staff/:id', superController.deleteStaff);

// ==================== AUDIT LOGS ====================
router.get('/audit-logs', superController.getAuditLogs);

// ==================== SETTINGS ====================
router.get('/settings', superController.getSettings);
router.patch('/settings/security', superController.updateSecuritySettings);
router.patch('/settings/smtp', superController.updateSMTPSettings);
router.get('/system/storage', superController.getStorageStats);
router.post('/system/backup', superController.triggerBackup);

// ==================== BILLING & REPORTS ====================
router.get('/invoices', superController.getInvoices);
router.post('/invoices', superController.generateInvoice);
router.patch('/invoices/:id/status', superController.updateInvoiceStatus);
router.get('/reports', superController.getReports);

export default router;
