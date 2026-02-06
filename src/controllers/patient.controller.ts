import { Request, Response, NextFunction } from 'express';
import * as patientService from '../services/patient.service.js';
// We can use the AuthRequest interface from auth middleware or just cast to any for simplicity in this file
// ensuring we don't need to circle-back import if not strictly necessary, 
// but importing AuthRequest is better practice. 
// For now, let's use 'as any' pattern consistent with other controllers if they exist, or just import AuthRequest.
import { AuthRequest } from '../middlewares/auth.js';

export const getMyAppointments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const email = authReq.user!.email;
        const appointments = await patientService.getMyAppointments(userId, email);
        res.json({ success: true, data: appointments });
    } catch (error) {
        next(error);
    }
};

export const getMyMedicalRecords = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const email = authReq.user!.email;
        const records = await patientService.getMyMedicalRecords(userId, email);
        res.json({ success: true, data: records });
    } catch (error) {
        next(error);
    }
};

export const getMyInvoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const email = authReq.user!.email;
        const invoices = await patientService.getMyInvoices(userId, email);
        res.json({ success: true, data: invoices });
    } catch (error) {
        next(error);
    }
};

export const bookAppointment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const email = authReq.user!.email;
        const appointment = await patientService.bookAppointment(userId, email, req.body);
        res.json({ success: true, data: appointment });
    } catch (error) {
        next(error);
    }
};


export const getClinicDoctors = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { clinicId } = req.params;
        const doctors = await patientService.getClinicDoctors(Number(clinicId));
        res.json({ success: true, data: doctors });
    } catch (error) {
        next(error);
    }
};

export const getClinicBookingDetails = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { clinicId } = req.params;
        const details = await patientService.getClinicBookingDetails(Number(clinicId));
        res.json({ success: true, data: details });
    } catch (error) {
        next(error);
    }
};

export const getMyClinics = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const email = authReq.user!.email;
        const clinics = await patientService.getMyClinics(email);
        res.json({ success: true, data: clinics });
    } catch (error) {
        next(error);
    }
};

export const getPublicClinics = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const clinics = await patientService.getPublicClinics();
        res.json({ success: true, data: clinics });
    } catch (error) {
        next(error);
    }
};

export const publicBookAppointment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const appointment = await patientService.publicBookAppointment(req.body);
        res.json({ success: true, data: appointment });
    } catch (error) {
        next(error);
    }
};
