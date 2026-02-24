import { prisma } from '../lib/prisma.js';

/** Syncs all pending service orders and appointments to 'Paid' for a given patient */
const syncServiceOrdersPayment = async (tx: any, clinicId: number, patientId: number) => {
    // 1. Update all Pending Lab/Radiology orders for this patient
    await tx.service_order.updateMany({
        where: {
            clinicId,
            patientId,
            paymentStatus: 'Pending'
        },
        data: { paymentStatus: 'Paid' }
    });

    // 2. Update most recent appointment if it's waiting for payment
    const appointment = await tx.appointment.findFirst({
        where: {
            clinicId,
            patientId,
            queueStatus: 'Pending-Payment'
        },
        orderBy: { createdAt: 'desc' }
    });

    if (appointment) {
        await tx.appointment.update({
            where: { id: appointment.id },
            data: {
                isPaid: true,
                queueStatus: 'Paid'
            }
        });
    }
};

export const getAccountingDashboardStats = async (clinicId: number) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [invoices, paidToday, pendingSum, pendingCount] = await Promise.all([
        prisma.invoice.findMany({
            where: { clinicId },
            include: { patient: { select: { name: true } } },
            orderBy: { date: 'desc' },
            take: 10
        }),
        prisma.invoice.aggregate({
            where: {
                clinicId,
                status: 'Paid',
                date: { gte: todayStart, lt: todayEnd }
            },
            _sum: { amount: true }
        }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Pending' },
            _sum: { amount: true }
        }),
        prisma.invoice.count({
            where: { clinicId, status: 'Pending' }
        })
    ]);

    const todayIncome = Number(paidToday._sum.amount || 0);
    const pendingPayments = Number(pendingSum._sum.amount || 0);
    // Expenses: no expense table yet - return 0 from backend (dynamic placeholder)
    const expenses = 0;

    return {
        todayIncome,
        pendingPayments,
        expenses,
        pendingInvoicesCount: pendingCount,
        invoices
    };
};

export const getInvoices = async (clinicId: number) => {
    return await prisma.invoice.findMany({
        where: { clinicId },
        include: { patient: true },
        orderBy: { createdAt: 'desc' }
    });
};

export const updateInvoiceStatus = async (clinicId: number, id: string, status: string) => {
    return await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.update({
            where: { id, clinicId },
            data: { status }
        });

        if (status === 'Paid') {
            await syncServiceOrdersPayment(tx, clinicId, invoice.patientId);
        }

        return invoice;
    });
};

export const createInvoice = async (clinicId: number, data: any) => {
    const { patientId, doctorId, service, amount, status } = data;

    const pId = Number(patientId);
    if (!pId || isNaN(pId)) {
        throw new Error('Invalid Patient selected. Please select a valid patient.');
    }

    return await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
            data: {
                id: `INV-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,
                clinicId,
                patientId: pId,
                doctorId: doctorId ? Number(doctorId) : undefined,
                service,
                amount: Number(amount),
                status: status || 'Pending'
            }
        });

        if (invoice.status === 'Paid') {
            await syncServiceOrdersPayment(tx, clinicId, pId);
        }

        return invoice;
    });
};
