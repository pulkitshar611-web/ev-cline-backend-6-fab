import { prisma } from '../lib/prisma.js';

/** Syncs specific invoiced items to 'Paid' */
const syncInvoiceItemsPayment = async (tx: any, invoiceId: string) => {
    const items = await tx.invoice_item.findMany({
        where: { invoiceId }
    });

    for (const item of items) {
        if (item.serviceType === 'consultation') {
            await tx.appointment.update({
                where: { id: item.serviceId },
                data: { isPaid: true, queueStatus: 'Paid' }
            });
        } else if (['lab', 'radiology', 'pharmacy'].includes(item.serviceType)) {
            await tx.service_order.update({
                where: { id: item.serviceId },
                data: { paymentStatus: 'Paid' }
            });
        }
    }
};

export const getPendingBillingItems = async (clinicId: number, patientId: number) => {
    // 1. Unpaid Consultations (Appointments)
    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId,
            patientId,
            isPaid: false,
            billingAmount: { gt: 0 }
        },
        orderBy: { date: 'desc' }
    });

    // 2. Unpaid Service Orders (Lab, Radiology, Pharmacy)
    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            patientId,
            paymentStatus: 'Pending'
        },
        orderBy: { createdAt: 'desc' }
    });

    return {
        consultations: appointments.map(a => ({
            id: a.id,
            type: 'consultation',
            description: `Consultation - ${a.service || 'General'}`,
            amount: Number(a.billingAmount || 0),
            date: a.date
        })),
        orders: orders.map(o => {
            let actualAmount = Number(o.amount || 0);
            let description = `${o.type} Order: ${o.testName}`;

            // Parse result for Pharmacy orders to get dynamic amount and real items
            if (o.type.toUpperCase() === 'PHARMACY' && o.result) {
                try {
                    const parsed = JSON.parse(o.result);

                    // Priority 1: Direct amount field
                    if (parsed.amount !== undefined) {
                        actualAmount = Number(parsed.amount);
                    }
                    // Priority 2: totalAmount from doctor payload
                    else if (parsed.totalAmount !== undefined) {
                        actualAmount = Number(parsed.totalAmount);
                    }
                    // Priority 3: Derived from components (unitPrice * quantity)
                    else if (parsed.unitPrice && parsed.quantity) {
                        actualAmount = Number(parsed.unitPrice) * Number(parsed.quantity);
                    }

                    // Handle Description
                    if (parsed.items && Array.isArray(parsed.items)) {
                        description = `Pharmacy: ${parsed.items.join(', ')}`;
                    } else if (parsed.testName && parsed.quantity) {
                        description = `Pharmacy: ${parsed.testName} x${parsed.quantity}`;
                    } else if (parsed.items) {
                        description = `Pharmacy: ${parsed.items}`;
                    }
                } catch (e) {
                    console.error("Failed to parse pharmacy order result for billing:", o.id);
                }
            }

            return {
                id: o.id,
                type: o.type.toLowerCase(),
                description,
                amount: actualAmount,
                date: o.createdAt
            };
        })
    };
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
            _sum: { totalAmount: true }
        }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Pending' },
            _sum: { totalAmount: true }
        }),
        prisma.invoice.count({
            where: { clinicId, status: 'Pending' }
        })
    ]);

    return {
        todayIncome: Number(paidToday._sum.totalAmount || 0),
        pendingPayments: Number(pendingSum._sum.totalAmount || 0),
        expenses: 0,
        pendingInvoicesCount: pendingCount,
        recentInvoices: invoices
    };
};

export const getInvoices = async (clinicId: number) => {
    return await prisma.invoice.findMany({
        where: { clinicId },
        include: {
            patient: true,
            items: true
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const updateInvoiceStatus = async (clinicId: number, id: string, status: string, paymentMethod?: string) => {
    return await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.update({
            where: { id, clinicId },
            data: {
                status,
                paymentMethod: paymentMethod || undefined
            }
        });

        if (status === 'Paid') {
            await syncInvoiceItemsPayment(tx, id);
        }

        return invoice;
    });
};

export const createInvoice = async (clinicId: number, data: any) => {
    const { patientId, visitId, items, status, paymentMethod, createdBy } = data;

    const pId = Number(patientId);
    if (!pId || isNaN(pId)) {
        throw new Error('Invalid Patient. Please select a patient.');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('Invoice must have at least one item.');
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return await prisma.$transaction(async (tx) => {
        const invoiceId = `INV-${Math.floor(10000 + Math.random() * 90000)}-${Date.now().toString().slice(-4)}`;

        const invoice = await tx.invoice.create({
            data: {
                id: invoiceId,
                clinicId,
                patientId: pId,
                visitId: visitId ? Number(visitId) : undefined,
                totalAmount,
                status: status || 'Pending',
                paymentMethod,
                createdBy
            }
        });

        // Create Invoice Items
        for (const item of items) {
            await tx.invoice_item.create({
                data: {
                    invoiceId: invoice.id,
                    serviceType: item.type,
                    serviceId: item.id,
                    description: item.description,
                    amount: Number(item.amount || 0)
                }
            });
        }

        if (invoice.status === 'Paid') {
            await syncInvoiceItemsPayment(tx, invoice.id);
        }

        return invoice;
    });
};
