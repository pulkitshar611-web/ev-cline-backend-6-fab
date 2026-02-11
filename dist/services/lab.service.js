import { prisma } from '../server.js';
export const getLabOrders = async (clinicId, type, statusFilter) => {
    console.log(`[LAB/RAD] Fetching ${type} orders for clinic ${clinicId} | Status filter: ${statusFilter || 'all'}`);
    // Normalize type for search
    const typeList = type === 'LAB' ? ['LAB', 'Laboratory', 'laboratory'] : ['RADIOLOGY', 'Radiology', 'radiology', 'RAD'];
    const where = {
        clinicId,
        type: { in: typeList }
    };
    // Add status filter if provided
    if (statusFilter) {
        where.status = statusFilter;
    }
    const orders = await prisma.service_order.findMany({
        where,
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
    console.log(`[LAB/RAD] Found ${orders.length} ${type} orders for clinic ${clinicId}`);
    return orders;
};
export const completeLabOrder = async (clinicId, orderId, data) => {
    const { result, price, paid } = data;
    console.log(`[LAB/RAD Service] Completing Order ${orderId} | Price: ${price} | Paid: ${paid}`);
    try {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.service_order.update({
                where: { id: orderId },
                data: {
                    status: 'Completed',
                    // Don't overwrite result here immediately, we will do it in second update
                }
            });
            // Create Invoice for the test
            const invoice = await tx.invoice.create({
                data: {
                    id: `${String(order.type).startsWith('L') ? 'LAB' : 'RAD'}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,
                    clinicId,
                    patientId: order.patientId,
                    doctorId: order.doctorId,
                    service: `${order.type}: ${order.testName}`,
                    amount: Number(price) || 0,
                    status: paid ? 'Paid' : 'Pending',
                    date: new Date()
                }
            });
            // Store result AND invoice info in the order result field (as JSON)
            const resultData = {
                findings: result,
                invoiceId: invoice.id,
                amount: Number(price) || 0,
                paid
            };
            await tx.service_order.update({
                where: { id: orderId },
                data: {
                    result: JSON.stringify(resultData)
                }
            });
            return { order, invoice };
        }, {
            timeout: 20000
        });
    }
    catch (error) {
        console.error(`[LAB/RAD Service] Error completing order ${orderId}:`, error);
        throw error;
    }
};
export const rejectLabOrder = async (clinicId, orderId) => {
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data: { status: 'Rejected' }
    });
};
export const collectSample = async (clinicId, orderId) => {
    console.log(`[LAB/RAD Service] Marking sample as collected for order ${orderId}`);
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data: { status: 'Sample Collected' }
    });
};
