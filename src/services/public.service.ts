import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppError } from '../utils/AppError.js';

const prisma = new PrismaClient();

export const getClinicBySubdomain = async (subdomain: string) => {
    const clinic = await prisma.clinic.findUnique({
        where: { subdomain },
        select: {
            id: true,
            name: true,
            logo: true,
            location: true,
            email: true,
            contact: true,
            bookingConfig: true,
            brandingColor: true,
            modules: true
        }
    });

    if (!clinic) throw new AppError('Clinic not found', 404);

    // Parse booking config if exists
    let config = null;
    if (clinic.bookingConfig) {
        try { config = JSON.parse(clinic.bookingConfig); } catch (e) { config = null; }
    }

    return { ...clinic, bookingConfig: config };
};

export const getClinicDoctors = async (clinicId: number) => {
    return await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: 'DOCTOR',
            user: { status: 'active' }
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        }
    });
};

export const getDoctorAvailability = async (doctorId: number, date?: string) => {
    // Basic availability logic (can be expanded later with actual appointment checks)
    const staff = await prisma.clinicstaff.findUnique({
        where: { id: doctorId },
        select: { roles: true, clinicId: true }
    });

    if (!staff) throw new AppError('Doctor not found', 404);

    const clinic = await prisma.clinic.findUnique({
        where: { id: staff.clinicId },
        select: { bookingConfig: true }
    });

    let config = { timeSlots: ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"] };
    if (clinic?.bookingConfig) {
        try {
            const parsed = JSON.parse(clinic.bookingConfig);
            if (parsed.timeSlots) config.timeSlots = parsed.timeSlots;
        } catch (e) { }
    }

    return config;
};

export const createPublicBooking = async (data: any) => {
    const { name, email, phone, password, doctorId, clinicId, date, time, notes, service } = data;

    // 1. Find or Create User
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        const hashedPassword = await bcrypt.hash(password || 'Patient@123', 12);
        user = await prisma.user.create({
            data: {
                name,
                email,
                phone,
                password: hashedPassword,
                role: 'PATIENT'
            }
        });
    }

    // 2. Ensure Patient record exists for this clinic
    let patient = await prisma.patient.findFirst({
        where: { email, clinicId }
    });

    if (!patient) {
        patient = await prisma.patient.create({
            data: {
                name,
                email,
                phone,
                clinicId,
                status: 'Active'
            }
        });
    }

    // 3. Create Appointment
    const appointment = await prisma.appointment.create({
        data: {
            clinicId,
            patientId: patient.id,
            doctorId,
            date: new Date(date),
            time,
            notes,
            service: service || 'General Consultation',
            status: 'Pending',
            source: 'Online Booking'
        }
    });

    // 4. Audit Log
    await prisma.auditlog.create({
        data: {
            action: 'Public Appointment Booked',
            performedBy: 'PATIENT',
            userId: user.id,
            clinicId,
            details: JSON.stringify({ appointmentId: appointment.id })
        }
    });

    return appointment;
};

export const getLiveTokens = async (subdomain: string) => {
    const clinic = await prisma.clinic.findUnique({
        where: { subdomain },
        select: { id: true }
    });
    if (!clinic) throw new AppError('Clinic not found', 404);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId: clinic.id,
            date: {
                gte: today,
                lte: new Date(new Date().setHours(23, 59, 59, 999))
            },
            queueStatus: { in: ['Checked-In', 'In-Consultation'] }
        },
        include: {
            patient: { select: { name: true } },
            clinic: { select: { name: true } }
        },
        orderBy: { tokenNumber: 'asc' }
    });

    // Get doctor names separately as they are in clinicstaff
    const doctorIds = [...new Set(appointments.map(a => a.doctorId))];
    const doctors = await prisma.clinicstaff.findMany({
        where: { id: { in: doctorIds } },
        include: { user: { select: { name: true } } }
    });
    const doctorMap = new Map(doctors.map(d => [d.id, d.user.name]));

    return appointments.map(a => ({
        tokenNumber: a.tokenNumber,
        status: a.queueStatus,
        patientName: a.patient.name.split(' ')[0] + ' ***', // Privacy
        doctorName: doctorMap.get(a.doctorId) || 'Consultant'
    }));
};
