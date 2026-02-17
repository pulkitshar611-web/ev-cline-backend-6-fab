import { Router } from 'express';
import * as patientController from '../controllers/patient.controller.js';
import { protect, restrictTo } from '../middlewares/auth.js';

const router = Router();

router.get('/booking-details/:clinicId', patientController.getClinicBookingDetails);
router.get('/public-clinics', patientController.getPublicClinics);
router.post('/public-book', patientController.publicBookAppointment);

// All routes below require authentication and PATIENT role
router.use(protect);
router.use(restrictTo('PATIENT', 'ADMIN', 'RECEPTIONIST'));

router.get('/appointments', patientController.getMyAppointments);
router.get('/records', patientController.getMyMedicalRecords);
router.get('/invoices', patientController.getMyInvoices);
router.get('/clinics', patientController.getMyClinics);
router.post('/book', patientController.bookAppointment);



router.get('/doctors/:clinicId', patientController.getClinicDoctors);

// Patient Document Management Routes
router.post('/documents', patientController.uploadPatientDocument);
router.get('/documents/:patientId', patientController.getPatientDocuments);
router.delete('/documents/:documentId', patientController.deletePatientDocument);

export default router;

