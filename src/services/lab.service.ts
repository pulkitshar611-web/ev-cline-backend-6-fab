import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';

export const getLabOrders = async (clinicId: number, type: 'LAB' | 'RADIOLOGY', statusFilter?: string) => {
    console.log(`[LAB/RAD] Fetching ${type} orders for clinic ${clinicId} | Status: ${statusFilter || 'all'}`);

    const typeList = type === 'LAB' ? ['LAB', 'Laboratory', 'laboratory'] : ['RADIOLOGY', 'Radiology', 'radiology', 'RAD'];

    const where: any = {
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

export const updateLabStatus = async (clinicId: number, orderId: number, status: string, resultData?: string) => {
    // Status Flow: Pending -> Sample Collected -> Result Uploaded -> Published
    const data: any = { testStatus: status };
    if (resultData) {
        data.result = resultData;
    }

    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data
    });
};

export const rejectLabOrder = async (clinicId: number, orderId: number) => {
    return await prisma.service_order.update({
        where: { id: orderId, clinicId },
        data: { testStatus: 'Rejected' }
    });
};

export const collectSample = async (clinicId: number, orderId: number) => {
    return await updateLabStatus(clinicId, orderId, 'Sample Collected');
};

export const uploadReport = async (clinicId: number, orderId: number, reportContent: string) => {
    return await updateLabStatus(clinicId, orderId, 'Result Uploaded', reportContent);
};

export const publishReport = async (clinicId: number, orderId: number) => {
    return await updateLabStatus(clinicId, orderId, 'Published');
};
