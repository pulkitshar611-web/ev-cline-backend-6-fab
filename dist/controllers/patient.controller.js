import * as patientService from '../services/patient.service.js';
export const getMyAppointments = async (req, res, next) => {
    try {
        const authReq = req;
        const userId = authReq.user.id;
        const email = authReq.user.email;
        const appointments = await patientService.getMyAppointments(userId, email);
        res.json({ success: true, data: appointments });
    }
    catch (error) {
        next(error);
    }
};
export const getMyMedicalRecords = async (req, res, next) => {
    try {
        const authReq = req;
        const userId = authReq.user.id;
        const email = authReq.user.email;
        const records = await patientService.getMyMedicalRecords(userId, email);
        res.json({ success: true, data: records });
    }
    catch (error) {
        next(error);
    }
};
export const getMyInvoices = async (req, res, next) => {
    try {
        const authReq = req;
        const userId = authReq.user.id;
        const email = authReq.user.email;
        const invoices = await patientService.getMyInvoices(userId, email);
        res.json({ success: true, data: invoices });
    }
    catch (error) {
        next(error);
    }
};
export const bookAppointment = async (req, res, next) => {
    try {
        const authReq = req;
        const userId = authReq.user.id;
        const email = authReq.user.email;
        const appointment = await patientService.bookAppointment(userId, email, req.body);
        res.json({ success: true, data: appointment });
    }
    catch (error) {
        next(error);
    }
};
export const getClinicDoctors = async (req, res, next) => {
    try {
        const { clinicId } = req.params;
        const doctors = await patientService.getClinicDoctors(Number(clinicId));
        res.json({ success: true, data: doctors });
    }
    catch (error) {
        next(error);
    }
};
export const getClinicBookingDetails = async (req, res, next) => {
    try {
        const { clinicId } = req.params;
        const details = await patientService.getClinicBookingDetails(Number(clinicId));
        res.json({ success: true, data: details });
    }
    catch (error) {
        next(error);
    }
};
export const getMyClinics = async (req, res, next) => {
    try {
        const authReq = req;
        const email = authReq.user.email;
        const clinics = await patientService.getMyClinics(email);
        res.json({ success: true, data: clinics });
    }
    catch (error) {
        next(error);
    }
};
export const getPublicClinics = async (req, res, next) => {
    try {
        const clinics = await patientService.getPublicClinics();
        res.json({ success: true, data: clinics });
    }
    catch (error) {
        next(error);
    }
};
export const publicBookAppointment = async (req, res, next) => {
    try {
        const appointment = await patientService.publicBookAppointment(req.body);
        res.json({ success: true, data: appointment });
    }
    catch (error) {
        next(error);
    }
};
