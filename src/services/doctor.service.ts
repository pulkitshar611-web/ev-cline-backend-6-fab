import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';

export const getDoctorQueue = async (clinicId: number, doctorId: number) => {
    return await prisma.appointment.findMany({
        where: {
            clinicId,
            doctorId,
            status: { in: ['Approved', 'Confirmed', 'Checked In'] },
            date: {
                gte: new Date(new Date().setHours(0, 0, 0, 0)),
                lte: new Date(new Date().setHours(23, 59, 59, 999))
            }
        },
        include: { patient: true }
    });
};

export const saveAssessment = async (clinicId: number, doctorId: number, payload: any) => {
    const { patientId, templateId, type, findings, orders = [] } = payload;

    // Save exact copy of orders in the medical record data for viewing later
    const recordData = { ...findings, ordersSnapshot: orders || [] };

    const assessment = await prisma.medicalrecord.create({
        data: {
            clinicId,
            patientId,
            doctorId,
            templateId,
            type,
            data: JSON.stringify(recordData),
            isClosed: true
        }
    });

    // --- NEW: Create Consultation Invoice for Accountant ---
    try {
        await prisma.invoice.create({
            data: {
                id: `CONS-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,
                clinicId,
                patientId,
                doctorId,
                service: `Consultation: ${type}`,
                amount: 150, // Standard Consultation Fee
                status: 'Pending',
                date: new Date()
            }
        });
        console.log(`[FINANCE] Consultation invoice created for patient ${patientId}`);
    } catch (e) {
        console.error('[FINANCE] Failed to create consultation invoice:', e);
    }

    // Create Service Orders and Notifications
    for (const order of orders) {
        const orderType = String(order.type).toUpperCase();
        const { testName, details } = order;

        console.log(`[WORKFLOW] Creating ${orderType} order for patient ${patientId} in clinic ${clinicId}`);

        const createdOrder = await prisma.service_order.create({
            data: {
                clinicId,
                patientId,
                doctorId,
                type: orderType,
                testName,
                status: 'Pending',
                result: details // Store instructions here for now
            }
        });

        // Notify Department
        let dept = 'laboratory';
        if (orderType === 'RADIOLOGY') dept = 'radiology';
        if (orderType === 'PHARMACY') dept = 'pharmacy';

        await prisma.notification.create({
            data: {
                clinicId,
                department: dept,
                message: JSON.stringify({
                    patientId,
                    orderId: createdOrder.id,
                    type: orderType,
                    details: `${testName} - ${details}`
                })
            }
        });
    }

    // Mark appointment as Completed if exists for today
    await prisma.appointment.updateMany({
        where: {
            clinicId,
            patientId,
            doctorId,
            status: { in: ['Checked In', 'Confirmed', 'Approved'] }
        },
        data: { status: 'Completed' }
    });

    return assessment;
};

export const getHistory = async (clinicId: number, patientId: number) => {
    const records = await prisma.medicalrecord.findMany({
        where: { clinicId, patientId },
        include: {
            formtemplate: true,
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return records.map(r => ({
        ...r,
        patientName: (r as any).patient?.name || 'Unknown'
    }));
};

export const getPatientFullProfile = async (clinicId: number, patientId: number) => {
    const [patient, medicalRecords, serviceOrders] = await Promise.all([
        prisma.patient.findUnique({
            where: { id: patientId }
        }),
        prisma.medicalrecord.findMany({
            where: { clinicId, patientId },
            include: { formtemplate: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        }),
        prisma.service_order.findMany({
            where: { clinicId, patientId },
            orderBy: { createdAt: 'desc' }
        })
    ]);

    if (!patient) throw new AppError('Patient not found', 404);

    return {
        patient,
        medicalRecords: medicalRecords.map(r => ({
            ...r,
            data: r.data ? JSON.parse(r.data) : {}
        })),
        serviceOrders: serviceOrders.map(o => ({
            ...o,
            result: o.result && (o.result.startsWith('{') || o.result.startsWith('[')) ? JSON.parse(o.result) : o.result
        }))
    };
};

export const getAllAssessments = async (clinicId: number, doctorId?: number) => {
    const where: any = { clinicId };
    if (doctorId) {
        where.doctorId = doctorId;
    }

    const records = await prisma.medicalrecord.findMany({
        where,
        include: {
            formtemplate: true,
            patient: { select: { name: true, id: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return records.map(r => ({
        ...r,
        patientName: (r as any).patient?.name || 'Unknown',
        patientId: (r as any).patient?.id,
        visitDate: r.visitDate || r.createdAt,
        date: r.visitDate || r.createdAt,
        status: 'Completed'
    }));
};


export const getDoctorStats = async (clinicId: number, doctorId: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayAppts, totalPatientsCount, completedAppts, pendingAppts] = await Promise.all([
        prisma.appointment.count({
            where: {
                clinicId,
                doctorId,
                status: { in: ['Approved', 'Confirmed', 'Checked In', 'Completed'] },
                date: { gte: today, lte: new Date(new Date().setHours(23, 59, 59, 999)) }
            }
        }),
        prisma.medicalrecord.findMany({
            where: { clinicId, doctorId },
            distinct: ['patientId']
        }).then(res => res.length),
        prisma.appointment.count({
            where: { clinicId, doctorId, status: 'Completed', date: { gte: today } }
        }),
        prisma.appointment.count({
            where: { clinicId, doctorId, status: { in: ['Approved', 'Confirmed', 'Checked In'] }, date: { gte: today } }
        })
    ]);

    return {
        todayPatients: todayAppts,
        totalTreated: totalPatientsCount,
        completedAppointments: completedAppts,
        pendingAppointments: pendingAppts
    };
};

export const getDoctorActivities = async (clinicId: number, doctorId: number) => {
    const records = await prisma.medicalrecord.findMany({
        where: { clinicId, doctorId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { patient: { select: { name: true } } }
    });

    return records.map(r => ({
        id: r.id,
        action: `Completed Assessment for ${(r as any).patient.name}`,
        time: r.createdAt
    }));
};

export const getFormTemplates = async (clinicId: number) => {
    console.log(`[DOCTOR SERVICE] Fetching templates for Clinic ID: ${clinicId}`);

    // Fetch both clinic-specific and global (null) templates
    const templates = await prisma.formtemplate.findMany({
        where: {
            OR: [
                { clinicId: Number(clinicId) },
                { clinicId: null }
            ],
            status: 'published'
        },
        orderBy: { name: 'asc' }
    });

    // Fallback: If no published templates found, return all available for this clinic (for debugging/setup)
    if (templates.length === 0) {
        return await prisma.formtemplate.findMany({
            where: {
                OR: [
                    { clinicId: Number(clinicId) },
                    { clinicId: null }
                ]
            },
            orderBy: { name: 'asc' }
        });
    }

    return templates;
};

export const getTemplateById = async (clinicId: number, templateId: number) => {
    const template = await prisma.formtemplate.findUnique({
        where: { id: templateId }
    });

    if (!template) throw new AppError('Template not found', 404);

    // Authorization: Must be global or belong to this clinic
    if (template.clinicId && template.clinicId !== clinicId) {
        throw new AppError('Unauthorized access to this template', 403);
    }

    return {
        ...template,
        fields: typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields
    };
};

export const getAssignedPatients = async (clinicId: number, doctorId: number) => {
    // Return only patients who have an appointment booked with this doctor (by reception / booking link)
    return await prisma.patient.findMany({
        where: {
            clinicId,
            appointment: {
                some: {
                    doctorId
                }
            }
        },
        include: {
            medicalrecord: {
                where: { clinicId },
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, type: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const getDoctorOrders = async (clinicId: number, doctorId: number) => {
    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            doctorId
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return orders.map(o => ({
        id: o.id,
        // recordId: o.id, 
        date: o.createdAt,
        patientName: o.patient?.name || 'Unknown',
        type: o.type,
        details: o.testName,
        status: o.status
    }));
};

export const createOrder = async (clinicId: number, doctorId: number, data: any) => {
    const { patientId, type, items, priority, notes, date } = data;

    // Normalize type
    let orderType = 'LAB';
    if (type.toLowerCase().includes('rad')) orderType = 'RADIOLOGY';
    if (type.toLowerCase().includes('presc') || type.toLowerCase().includes('pharm')) orderType = 'PHARMACY';

    let testName = typeof items === 'string' ? items : '';
    let resultPayload: any = { priority, notes, date };

    if (orderType === 'PHARMACY' && Array.isArray(items) && items.length > 0) {
        const prescriptionItems = items.map((i: any) => ({
            inventoryId: i.inventoryId,
            medicineName: i.medicineName || i.name,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0
        }));
        testName = prescriptionItems.map((i: any) => `${i.medicineName} x${i.quantity}`).join(', ');
        resultPayload.items = prescriptionItems;
    }

    const order = await prisma.service_order.create({
        data: {
            clinicId,
            patientId: Number(patientId),
            doctorId,
            type: orderType,
            testName: testName || (typeof items === 'string' ? items : 'Prescription'),
            status: 'Pending',
            result: JSON.stringify(resultPayload)
        }
    });

    // Notify Department
    let dept = 'laboratory';
    if (orderType === 'RADIOLOGY') dept = 'radiology';
    if (orderType === 'PHARMACY') dept = 'pharmacy';

    await prisma.notification.create({
        data: {
            clinicId,
            department: dept,
            message: JSON.stringify({ patientId, orderId: order.id, type: orderType, items, priority, notes })
        }
    });

    return order;
};

export const getRevenueStats = async (clinicId: number, doctorId: number) => {
    // 1. Get all completed appointments
    const completedAppts = await prisma.appointment.findMany({
        where: {
            clinicId,
            doctorId,
            status: 'Completed'
        },
        select: { date: true } // Assuming standard fee
    });

    const FEE = 350; // Hardcoded for now as per frontend logic
    const totalEarnings = completedAppts.length * FEE;
    const totalConsultations = completedAppts.length;

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const todayStr = today.toISOString().split('T')[0];

    let thisMonth = 0;
    let todayEarned = 0;

    // Daily buckets for chart
    const dailyMap = new Map<string, number>();

    completedAppts.forEach(appt => {
        const d = new Date(appt.date);
        const dateStr = d.toISOString().split('T')[0];

        // Chart data
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);

        // Stats
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            thisMonth += FEE;
        }
        if (dateStr === todayStr) {
            todayEarned += FEE;
        }
    });

    // Format chart data (last 7 active days or just map entries)
    const chartData = Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, visits: count, earnings: count * FEE }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalEarnings,
        thisMonth,
        today: todayEarned,
        totalConsultations,
        chartData
    };
};
