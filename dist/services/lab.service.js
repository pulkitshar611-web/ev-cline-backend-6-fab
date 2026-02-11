import { prisma } from '../server.js';
export const getLabOrders = async (clinicId, type, statusFilter) => {
    console.log(`[LAB/RAD] Fetching ${type} orders for clinic ${clinicId} | Status: ${statusFilter || 'all'}`);
    const typeList = type === 'LAB' ? ['LAB', 'Laboratory', 'laboratory'] : ['RADIOLOGY', 'Radiology', 'radiology', 'RAD'];
    const where = {
        clinicId,
        type: { in: typeList },
        paymentStatus: 'Paid' // Only visible after payment
    };
    if (statusFilter) {
        where.testStatus = statusFilter;
    }
    return await prisma.service_order.findMany({
        where,
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
};
export const updateLabStatus = async (clinicId, orderId, status, resultData) => {
    // Status Flow: Pending -> Sample Collected -> Result Uploaded -> Published
    const data = { testStatus: status };
    if (resultData) {
        data.result = resultData;
    }
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data
    });
};
export const rejectLabOrder = async (clinicId, orderId) => {
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data: { testStatus: 'Rejected' }
    });
};
export const collectSample = async (clinicId, orderId) => {
    return await updateLabStatus(clinicId, orderId, 'Sample Collected');
};
export const uploadReport = async (clinicId, orderId, reportContent) => {
    return await updateLabStatus(clinicId, orderId, 'Result Uploaded', reportContent);
};
export const publishReport = async (clinicId, orderId) => {
    return await updateLabStatus(clinicId, orderId, 'Published');
};
export const completeLabOrder = async (clinicId, orderId, data) => {
    // Note: service_order schema doesn't have price/paid fields yet, so we only update status and result
    const updateData = { testStatus: 'Published' };
    if (data.result) {
        updateData.result = data.result;
    }
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data: updateData
    });
};
