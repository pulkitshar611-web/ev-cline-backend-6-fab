import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';
import bcrypt from 'bcryptjs';
export const getMyAppointments = async (userId, email) => {
    // Patients are linked to users via email or ID. 
    // We first find the patient records associated with this user across all clinics.
    const patientRecords = await prisma.patient.findMany({
        where: {
            OR: [
                { email: email },
                // If we had a direct userId link in patient model, we'd use it. 
                // Currently relying on email which is unique per user but per-clinic in patient table.
            ]
        },
        select: { id: true, clinicId: true }
    });
    const patientIds = patientRecords.map(p => p.id);
    if (patientIds.length === 0) {
        return [];
    }
    const appointments = await prisma.appointment.findMany({
        where: {
            patientId: { in: patientIds }
        },
        include: {
            clinic: { select: { name: true } },
            // We can't include doctor name directly as it's linked via ID to clinicstaff/user
            // But we can fetch it if needed or rely on ID.
        },
        orderBy: {
            date: 'desc'
        }
    });
    return appointments;
};
export const getMyMedicalRecords = async (userId, email) => {
    const patientRecords = await prisma.patient.findMany({
        where: { email: email },
        select: { id: true }
    });
    const patientIds = patientRecords.map(p => p.id);
    if (patientIds.length === 0)
        return { assessments: [], serviceOrders: [], prescriptions: [] };
    const [records, serviceOrders, pRecords] = await Promise.all([
        prisma.medicalrecord.findMany({
            where: {
                patientId: { in: patientIds },
                type: { in: ['ASSESSMENT', 'NOTE'] }
            },
            include: {
                clinic: { select: { name: true } }
            },
            orderBy: { visitDate: 'desc' }
        }),
        prisma.service_order.findMany({
            where: {
                patientId: { in: patientIds },
                testStatus: 'Published' // Only show published reports to patient
            },
            include: {
                clinic: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        }),
        prisma.medicalrecord.findMany({
            where: {
                patientId: { in: patientIds },
                type: 'PRESCRIPTION'
            },
            include: {
                clinic: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        })
    ]);
    return {
        assessments: records.map(record => ({
            ...record,
            data: record.data ? JSON.parse(record.data) : {}
        })),
        serviceOrders: serviceOrders.map(order => ({
            ...order,
            result: order.result && (order.result.startsWith('{') || order.result.startsWith('[')) ? JSON.parse(order.result) : order.result
        })),
        prescriptions: pRecords.map(p => ({
            ...p,
            data: p.data ? JSON.parse(p.data) : {}
        }))
    };
};
export const getMyDocuments = async (email) => {
    const patients = await prisma.patient.findMany({
        where: { email },
        select: { id: true }
    });
    const patientIds = patients.map(p => p.id);
    return await prisma.patient_document.findMany({
        where: { patientId: { in: patientIds } },
        include: { clinic: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }
    });
};
export const uploadPatientDocument = async (clinicId, patientId, data) => {
    return await prisma.patient_document.create({
        data: {
            clinicId,
            patientId: Number(patientId),
            type: data.type || 'OTHER',
            name: data.name,
            url: data.url
        }
    });
};
export const getMyInvoices = async (userId, email) => {
    const patientRecords = await prisma.patient.findMany({
        where: { email: email },
        select: { id: true }
    });
    const patientIds = patientRecords.map(p => p.id);
    if (patientIds.length === 0)
        return [];
    const invoices = await prisma.invoice.findMany({
        where: {
            patientId: { in: patientIds }
        },
        include: {
            clinic: { select: { name: true } }
        },
        orderBy: {
            date: 'desc'
        }
    });
    return invoices;
};
export const bookAppointment = async (userId, email, data) => {
    // 1. Find or create the patient record for this specific clinic
    let patient = await prisma.patient.findFirst({
        where: {
            email: email,
            clinicId: data.clinicId
        }
    });
    if (!patient) {
        // Auto-create patient record if user is logged in but has no patient record in this clinic
        const user = await prisma.user.findUnique({ where: { id: userId } });
        patient = await prisma.patient.create({
            data: {
                clinicId: data.clinicId,
                name: user?.name || 'Unknown Patient',
                email: email,
                phone: user?.phone || 'N/A',
                status: 'Active'
            }
        });
    }
    // 2. Create appointment
    const appointment = await prisma.appointment.create({
        data: {
            clinicId: data.clinicId,
            patientId: patient.id,
            doctorId: data.doctorId,
            date: new Date(data.date),
            time: data.time,
            status: 'Pending', // Defaults to Pending for patient bookings
            source: data.source || 'Patient Portal',
            notes: data.notes,
            service: data.service || 'Consultation'
        }
    });
    const clinic = await prisma.clinic.findUnique({ where: { id: data.clinicId } });
    if (clinic && clinic.bookingConfig) {
        // Here we could handle auto-approval logic if defined in bookingConfig
    }
    return appointment;
};
export const publicBookAppointment = async (data) => {
    try {
        const { name, email, phone, clinicId, doctorId, date, time, notes, service, password } = data;
        if (!email)
            throw new AppError('Email is required', 400);
        if (!clinicId || isNaN(Number(clinicId)))
            throw new AppError('Valid Clinic ID is required', 400);
        if (!doctorId || isNaN(Number(doctorId)))
            throw new AppError('Valid Doctor ID is required', 400);
        if (!date)
            throw new AppError('Date is required', 400);
        // 1. Find or create User - and UPDATE if exists
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            const finalPassword = password
                ? await bcrypt.hash(password, 12)
                : await bcrypt.hash('Patient123!', 12);
            user = await prisma.user.create({
                data: {
                    email,
                    name,
                    phone: phone || '',
                    password: finalPassword,
                    role: 'PATIENT'
                }
            });
        }
        else {
            // Update existing user with new name/phone from walk-in form
            user = await prisma.user.update({
                where: { email },
                data: { name, phone: phone || user.phone }
            });
        }
        // 2. Find or create Patient record for this clinic - and UPDATE if exists
        let patient = await prisma.patient.findFirst({
            where: { email, clinicId: Number(clinicId) }
        });
        if (!patient) {
            patient = await prisma.patient.create({
                data: {
                    clinicId: Number(clinicId),
                    name,
                    email,
                    phone: phone || '',
                    status: 'Active'
                }
            });
        }
        else {
            // Update existing patient record with latest info
            patient = await prisma.patient.update({
                where: { id: patient.id },
                data: { name, phone: phone || patient.phone }
            });
        }
        // Handle Date parsing carefully
        let appointmentDate = new Date(date);
        if (isNaN(appointmentDate.getTime())) {
            // Try parsing DD-MM-YYYY if regular parsing fails
            const parts = date.split('-');
            if (parts.length === 3) {
                // Assuming DD-MM-YYYY
                appointmentDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            }
        }
        if (isNaN(appointmentDate.getTime())) {
            throw new AppError('Invalid date format provided', 400);
        }
        // 3. Create Appointment
        const appointment = await prisma.appointment.create({
            data: {
                clinicId: Number(clinicId),
                patientId: patient.id,
                doctorId: Number(doctorId),
                date: appointmentDate,
                time,
                status: 'Pending',
                source: data.source || 'Public Portal',
                notes: notes || '',
                service: service || 'Consultation'
            },
            include: {
                patient: true // Include patient data in response to confirm
            }
        });
        return appointment;
    }
    catch (error) {
        console.error('Error in publicBookAppointment:', error);
        throw error;
    }
};
export const getClinicDoctors = async (clinicId) => {
    const doctors = await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: 'DOCTOR'
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
    return doctors.map(d => ({
        id: d.id,
        name: d.user.name,
        specialty: d.specialty || 'General Practitioner'
    }));
};
export const getClinicBookingDetails = async (clinicId) => {
    const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { bookingConfig: true, name: true }
    });
    let config = null;
    if (clinic?.bookingConfig) {
        try {
            config = JSON.parse(clinic.bookingConfig);
        }
        catch (e) {
            console.error('Failed to parse booking config', e);
        }
    }
    // Get all doctors for the clinic
    const allDoctors = await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: 'DOCTOR'
        },
        include: {
            user: { select: { id: true, name: true } }
        }
    });
    // Valid doctors
    const availableDoctors = allDoctors.map(d => ({
        id: d.id,
        name: d.user.name,
        specialty: d.specialty || 'General Practitioner'
    }));
    // Return the combined details
    return {
        doctors: availableDoctors,
        timeSlots: config?.timeSlots || ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'],
        offDays: config?.offDays || [],
        services: config?.services || ['Consultation'],
        headerTitle: config?.headerTitle || 'Appointment Booking',
        headerSubtitle: config?.headerSubtitle || 'Book a consultation with our experienced medical team.',
        clinicName: clinic?.name
    };
};
export const getMyClinics = async (email) => {
    const patients = await prisma.patient.findMany({
        where: { email },
        include: {
            clinic: {
                select: {
                    id: true,
                    name: true,
                    location: true
                }
            }
        }
    });
    return patients.map(p => p.clinic);
};
export const getPublicClinics = async () => {
    return await prisma.clinic.findMany({
        select: {
            id: true,
            name: true,
            location: true,
            logo: true
        }
    });
};
