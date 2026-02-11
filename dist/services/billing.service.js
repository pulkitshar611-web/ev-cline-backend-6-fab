import { prisma } from '../server.js';
export const getAccountingDashboardStats = async (clinicId) => {
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
export const getInvoices = async (clinicId) => {
    return await prisma.invoice.findMany({
        where: { clinicId },
        include: { patient: true },
        orderBy: { createdAt: 'desc' }
    });
};
export const updateInvoiceStatus = async (clinicId, id, status) => {
    return await prisma.invoice.update({
        where: { id, clinicId },
        data: { status }
    });
};
export const createInvoice = async (clinicId, data) => {
    const { patientId, doctorId, service, amount, status } = data;
    return await prisma.invoice.create({
        data: {
            id: `INV-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,
            clinicId,
            patientId: Number(patientId),
            doctorId: doctorId ? Number(doctorId) : undefined,
            service,
            amount: Number(amount),
            status: status || 'Pending'
        }
    });
};
