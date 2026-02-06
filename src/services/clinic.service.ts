import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';
import bcrypt from 'bcryptjs';

export const getClinicStats = async (clinicId: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [doctorCount, staffCount, todayAppts, totalPatients, todayRevenue, pendingBills, totalRevenue] = await Promise.all([
        prisma.clinicstaff.count({ where: { clinicId, role: 'DOCTOR' } }),
        prisma.clinicstaff.count({ where: { clinicId } }),
        prisma.appointment.count({
            where: {
                clinicId,
                date: { gte: today, lt: tomorrow }
            }
        }),
        prisma.patient.count({ where: { clinicId } }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Paid', date: { gte: today, lt: tomorrow } },
            _sum: { amount: true }
        }),
        prisma.invoice.count({ where: { clinicId, status: 'Pending' } }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Paid' },
            _sum: { amount: true }
        })
    ]);

    return {
        totalDoctors: doctorCount,
        totalStaff: staffCount,
        todayAppointments: todayAppts,
        totalPatients,
        todayRevenue: Number(todayRevenue._sum.amount || 0),
        pendingBills,
        revenue: Number(totalRevenue._sum.amount || 0)
    };
};

export const getClinicActivities = async (clinicId: number) => {
    const logs = await prisma.auditlog.findMany({
        where: { clinicId },
        take: 10,
        orderBy: { timestamp: 'desc' }
    });

    return logs.map(log => ({
        id: log.id,
        action: log.action,
        user: log.performedBy,
        time: log.timestamp,
        details: log.details
    }));
};

export const getClinicStaff = async (clinicId: number) => {
    const staffRecords = await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: { not: 'SUPER_ADMIN' }
        },
        include: {
            user: {
                select: { id: true, name: true, email: true, phone: true, status: true, joined: true }
            }
        }
    });

    // Group by userId to support multiple roles
    const grouped = staffRecords.reduce((acc: any, record) => {
        const userId = record.userId;
        if (!acc[userId]) {
            acc[userId] = {
                id: record.id,
                userId: record.userId,
                clinicId: record.clinicId,
                name: record.user.name,
                email: record.user.email,
                phone: record.user.phone,
                status: record.user.status,
                joined: record.user.joined ? record.user.joined.toISOString().split('T')[0] : null,
                roles: [],
                department: record.department,
                specialty: record.specialty
            };
        }
        acc[userId].roles.push(record.role);
        if (!acc[userId].department && record.department) acc[userId].department = record.department;
        if (!acc[userId].specialty && record.specialty) acc[userId].specialty = record.specialty;

        return acc;
    }, {});

    return Object.values(grouped).map((s: any) => ({
        ...s,
        role: s.roles[0]
    }));
};

export const addStaff = async (clinicId: number, data: any) => {
    const { email, password, name, role, phone, department, specialty } = data;

    // Check if user exists
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        if (!password) throw new AppError('Password is required for new users', 400);
        const hashedPassword = await bcrypt.hash(password, 12);
        user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                phone,
                status: 'active',
                role: role.toUpperCase() as any
            }
        });
    } else {
        // Update user's phone and role (to make this the new primary role)
        await prisma.user.update({
            where: { id: user.id },
            data: {
                phone: phone || undefined,
                role: role.toUpperCase() as any
            }
        });
    }

    // Check if staff already has this role in this clinic
    const existing = await prisma.clinicstaff.findFirst({
        where: {
            userId: user.id,
            clinicId,
            role: role.toUpperCase() as any
        }
    });

    if (existing) throw new AppError('User already has this role in this clinic', 400);

    const newStaff = await prisma.clinicstaff.create({
        data: {
            userId: user.id,
            clinicId,
            role: role.toUpperCase() as any,
            department,
            specialty
        },
        include: {
            user: {
                select: { id: true, name: true, email: true, status: true, joined: true }
            }
        }
    });
    await prisma.auditlog.create({
        data: {
            action: 'Staff Added',
            performedBy: 'ADMIN',
            userId: user.id,
            clinicId,
            details: JSON.stringify({ name: user.name, role: newStaff.role, department })
        }
    });

    return {
        id: newStaff.id,
        userId: newStaff.userId,
        clinicId: newStaff.clinicId,
        name: newStaff.user.name,
        email: newStaff.user.email,
        role: newStaff.role,
        roles: [newStaff.role],
        department: newStaff.department,
        specialty: newStaff.specialty,
        status: newStaff.user.status,
        joined: newStaff.user.joined ? newStaff.user.joined.toISOString().split('T')[0] : null,
        createdAt: newStaff.createdAt
    };
};

export const updateStaff = async (clinicId: number, staffId: number, data: any) => {
    const { name, email, phone, role, department, specialty, status } = data;

    const staff = await prisma.clinicstaff.findUnique({
        where: { id: staffId },
        include: { user: true }
    });

    if (!staff) throw new AppError('Staff record not found', 404);
    if (staff.clinicId !== clinicId) throw new AppError('Unauthorized: Staff does not belong to this clinic', 403);

    // Update user info if name/email/phone/status/role changed
    if (name || email || phone || status || role) {
        await prisma.user.update({
            where: { id: staff.userId },
            data: {
                name: name || undefined,
                email: email || undefined,
                phone: phone || undefined,
                status: status || undefined,
                role: role ? role.toUpperCase() as any : undefined
            }
        });
    }

    // Update staff info
    const updatedStaff = await prisma.clinicstaff.update({
        where: { id: staffId },
        data: {
            role: role ? role.toUpperCase() as any : undefined,
            department: department || undefined,
            specialty: specialty || undefined
        },
        include: {
            user: {
                select: { id: true, name: true, email: true, phone: true, status: true, joined: true }
            }
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Staff Updated',
            performedBy: 'ADMIN',
            userId: staff.userId,
            clinicId: staff.clinicId,
            details: JSON.stringify({ staffId, updates: Object.keys(data) })
        }
    });

    return {
        id: updatedStaff.id,
        userId: updatedStaff.userId,
        clinicId: updatedStaff.clinicId,
        name: (updatedStaff as any).user.name,
        email: (updatedStaff as any).user.email,
        phone: (updatedStaff as any).user.phone,
        role: updatedStaff.role,
        roles: [updatedStaff.role],
        department: updatedStaff.department,
        specialty: updatedStaff.specialty,
        status: (updatedStaff as any).user.status,
        joined: (updatedStaff as any).user.joined ? (updatedStaff as any).user.joined.toISOString().split('T')[0] : null,
        createdAt: updatedStaff.createdAt
    };
};

export const deleteClinicStaff = async (clinicId: number, staffId: number, userRole?: string) => {
    const staff = await prisma.clinicstaff.findUnique({
        where: { id: staffId }
    });

    if (!staff) throw new AppError('Staff record not found', 404);

    // Super admins can delete staff from any clinic, regular admins can only delete from their own clinic
    if (userRole !== 'SUPER_ADMIN' && staff.clinicId !== clinicId) {
        throw new AppError('Unauthorized: Staff does not belong to this clinic', 403);
    }

    const actualClinicId = staff.clinicId;

    await prisma.$transaction(async (tx) => {
        // 1. Check if user has other clinic associations
        const otherAssociations = await tx.clinicstaff.count({
            where: { userId: staff.userId, id: { not: staffId } }
        });

        // 2. Delete the specific clinic staff record
        await tx.clinicstaff.delete({
            where: { id: staffId }
        });

        // 3. If no other associations, delete user and their audit logs
        if (otherAssociations === 0) {
            // Delete audit logs first to satisfy foreign key constraints
            await tx.auditlog.deleteMany({
                where: { userId: staff.userId }
            });

            // Delete the user record
            await tx.user.delete({
                where: { id: staff.userId }
            });
        }

        // 4. Log the action (using clinic context if still exists, or global)
        await tx.auditlog.create({
            data: {
                action: 'Staff Deleted',
                performedBy: userRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
                clinicId: actualClinicId,
                details: JSON.stringify({
                    staffId,
                    userId: staff.userId,
                    note: otherAssociations === 0 ? 'User and AuditLogs deleted' : 'Staff unlinked, user preserved'
                })
            }
        });
    });

    return { success: true };
};

export const getFormTemplates = async (clinicId: number) => {
    return await prisma.formtemplate.findMany({
        where: {
            OR: [
                { clinicId: clinicId },
                { clinicId: null }
            ]
        },
        orderBy: { name: 'asc' }
    });
};

export const createFormTemplate = async (clinicId: number, data: any) => {
    const { name, specialty, fields, status } = data;
    const template = await prisma.formtemplate.create({
        data: {
            clinicId,
            name,
            specialty: specialty || 'General',
            fields: typeof fields === 'string' ? fields : JSON.stringify(fields),
            status: status || 'published'
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Form Template Created',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ templateId: template.id, name })
        }
    });

    return template;
};

export const deleteFormTemplate = async (id: number) => {
    const template = await prisma.formtemplate.delete({
        where: { id }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Form Template Deleted',
            performedBy: 'ADMIN',
            clinicId: template.clinicId,
            details: JSON.stringify({ templateId: id, name: template.name })
        }
    });

    return template;
};

const DEFAULT_BOOKING_CONFIG = {
    enabled: true,
    services: ['Consultation', 'Follow-up', 'Emergency'],
    timeSlots: ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'],
    selectedDoctors: [],
    offDays: [0, 6],
    holidays: [],
    doctorAvailability: {} as Record<string, { offDays: number[]; timeSlots: string[] }>
};

/** Get availability (days + time slots) for a specific doctor. Falls back to clinic default if not set. */
export const getDoctorAvailability = async (clinicId: number, doctorId: number) => {
    const config = await getBookingConfig(clinicId);
    const doctorConfig = (config.doctorAvailability || {})[String(doctorId)];
    return {
        offDays: doctorConfig?.offDays ?? config.offDays ?? [0, 6],
        timeSlots: (doctorConfig?.timeSlots?.length ? doctorConfig.timeSlots : config.timeSlots) ?? DEFAULT_BOOKING_CONFIG.timeSlots
    };
};

export const getBookingConfig = async (clinicId: number) => {
    const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { bookingConfig: true }
    });
    if (clinic?.bookingConfig) {
        try {
            return JSON.parse(clinic.bookingConfig);
        } catch {
            return DEFAULT_BOOKING_CONFIG;
        }
    }
    return DEFAULT_BOOKING_CONFIG;
};

export const updateBookingConfig = async (clinicId: number, config: any) => {
    const updated = await prisma.clinic.update({
        where: { id: clinicId },
        data: {
            bookingConfig: JSON.stringify(config)
        },
        select: { bookingConfig: true }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Booking Config Updated',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ config })
        }
    });

    return updated.bookingConfig ? JSON.parse(updated.bookingConfig) : null;
};

export const resetUserPassword = async (clinicId: number, userId: number, password: string) => {
    const staff = await prisma.clinicstaff.findFirst({
        where: { userId, clinicId }
    });
    if (!staff) throw new AppError('User does not belong to this clinic', 403);

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Password Reset',
            performedBy: 'ADMIN',
            userId: userId,
            clinicId,
            details: JSON.stringify({ note: 'Admin reset password' })
        }
    });

    return { success: true };
};
