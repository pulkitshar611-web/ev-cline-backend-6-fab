import { prisma } from '../server.js';

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
            // Sync with appointment queue
            const appointment = await tx.appointment.findFirst({
                where: {
                    clinicId,
                    patientId: invoice.patientId,
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

                // Release Lab/Radiology orders
                await tx.service_order.updateMany({
                    where: {
                        clinicId,
                        patientId: invoice.patientId,
                        doctorId: appointment.doctorId,
                        paymentStatus: 'Pending'
                    },
                    data: {
                        paymentStatus: 'Paid'
                    }
                });
            }
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

    return await prisma.invoice.create({
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
};
