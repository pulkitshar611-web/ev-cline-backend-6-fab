import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';
import * as auditService from './audit.service.js';

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export const getInventory = async (clinicId: number) => {
    return await prisma.inventory.findMany({
        where: { clinicId },
        orderBy: { name: 'asc' }
    });
};

export const getLowStockInventory = async (clinicId: number, threshold: number = DEFAULT_LOW_STOCK_THRESHOLD) => {
    return await prisma.inventory.findMany({
        where: {
            clinicId,
            quantity: { lte: threshold }
        },
        orderBy: { quantity: 'asc' }
    });
};

export const addInventory = async (clinicId: number, data: any) => {
    const { name, sku, quantity, unitPrice, expiryDate } = data;

    return await prisma.inventory.create({
        data: {
            clinicId,
            name,
            sku,
            quantity: Number(quantity),
            unitPrice: Number(unitPrice),
            expiryDate: expiryDate ? new Date(expiryDate) : null
        }
    });
};

export const updateInventory = async (clinicId: number, id: number, data: any) => {
    const existing = await prisma.inventory.findFirst({ where: { id, clinicId } });
    if (!existing) throw new AppError('Inventory item not found', 404);
    return await prisma.inventory.update({
        where: { id },
        data: {
            name: data.name,
            sku: data.sku,
            quantity: Number(data.quantity),
            unitPrice: Number(data.unitPrice),
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : null
        }
    });
};

export const deleteInventory = async (clinicId: number, id: number) => {
    const existing = await prisma.inventory.findFirst({ where: { id, clinicId } });
    if (!existing) throw new AppError('Inventory item not found', 404);
    return await prisma.inventory.delete({ where: { id } });
};

export const getPharmacyOrders = async (clinicId: number) => {
    console.log(`[PHARMACY] Fetching orders/prescriptions for clinic ${clinicId}`);

    // 1. Get Service Orders for Pharmacy (legacy/quick-orders)
    const serviceOrders = await prisma.service_order.findMany({
        where: {
            clinicId,
            type: { in: ['PHARMACY', 'Pharmacy', 'pharmacy'] }
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    // 2. Get Prescriptions from Medical Records (new EMR flow)
    const prescribedRecords = await prisma.medicalrecord.findMany({
        where: {
            clinicId,
            type: 'PRESCRIPTION',
            status: { not: 'Dispensed' }
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    const combined = [
        ...serviceOrders.map((o: any) => ({
            id: o.id,
            patientName: o.patient?.name,
            testName: o.testName,
            status: o.testStatus || o.status,
            paymentStatus: o.paymentStatus,
            createdAt: o.createdAt,
            source: 'ORDER'
        })),
        ...prescribedRecords.map((r: any) => {
            let data: any = {};
            try {
                data = JSON.parse(r.data);
            } catch (e) {
                console.error("Failed to parse prescription data for record:", r.id);
            }

            // Fallback for legacy format: if data is a single item (has medicineName but no items array)
            let prescriptionItems = [];
            if (Array.isArray(data.items)) {
                prescriptionItems = data.items;
            } else if (data.medicineName || data.name || data.testName) {
                // Ensure medicineName exists for frontend display
                if (!data.medicineName && data.testName) {
                    data.medicineName = data.testName;
                }
                prescriptionItems = [data]; // Wrap single item into array
            }

            return {
                id: r.id,
                patientName: r.patient?.name,
                testName: prescriptionItems.length > 0
                    ? prescriptionItems.map((i: any) => i.medicineName || i.name || 'Medicine').join(', ')
                    : 'Prescription',
                items: prescriptionItems,
                status: r.status,
                paymentStatus: 'Paid',
                createdAt: r.createdAt,
                source: 'EMR'
            };
        })
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return combined;
};

export const getPharmacyNotificationsCount = async (clinicId: number) => {
    return await prisma.notification.count({
        where: {
            clinicId,
            department: {
                contains: 'pharmacy',
                // mode: 'insensitive' // Optional, based on DB support
            },
            status: 'unread'
        }
    });
};

export const processPharmacyOrder = async (clinicId: number, orderId: number, items: any[] = [], paid: boolean = false, manualAmount?: number, source: 'ORDER' | 'EMR' = 'ORDER') => {
    // If no items passed, use prescription items from order (doctor-prescribed)
    if (!items || items.length === 0) {
        if (source === 'ORDER') {
            const order = await prisma.service_order.findFirst({ where: { id: orderId, clinicId } });
            if (order?.result) {
                try {
                    const parsed = JSON.parse(order.result);
                    if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
                        items = parsed.items.map((i: any) => ({
                            inventoryId: i.inventoryId,
                            quantity: Number(i.quantity) || 1,
                            price: i.unitPrice ?? i.price
                        }));
                    }
                } catch (_) { }
            }
        } else {
            const record = await prisma.medicalrecord.findFirst({ where: { id: orderId, clinicId } });
            if (record?.data) {
                try {
                    const parsed = JSON.parse(record.data);

                    // Support both new {items: []} format and legacy single item format
                    let rawItems = [];
                    if (Array.isArray(parsed?.items)) {
                        rawItems = parsed.items;
                    } else if (parsed?.medicineName || parsed?.name || parsed?.testName) {
                        // Ensure medicineName exists for processing
                        if (!parsed.medicineName && parsed.testName) {
                            parsed.medicineName = parsed.testName;
                        }
                        rawItems = [parsed];
                    }

                    if (rawItems.length > 0) {
                        items = rawItems.map((i: any) => ({
                            inventoryId: i.inventoryId || i.id, // Fallback to id if inventoryId not present
                            quantity: Number(i.quantity) || 1,
                            price: i.unitPrice ?? i.price
                        }));
                    }
                } catch (_) { }
            }
        }
    }

    console.log(`[Pharmacy Service] Processing ${source} ${orderId} | Paid: ${paid} | Amount: ${manualAmount} | Items: ${items.length}`);

    try {
        return await prisma.$transaction(async (tx) => {
            let totalAmount = Number(manualAmount) || 0;
            let serviceDetails: string[] = [];

            // If items are provided, calculate total and update inventory
            if (items && items.length > 0) {
                let inventoryTotal = 0;
                for (const item of items) {
                    if (!item.inventoryId) continue;

                    const product = await tx.inventory.findUnique({
                        where: { id: item.inventoryId }
                    });

                    if (!product) continue;

                    if (product.quantity < item.quantity) {
                        throw new AppError(`Insufficient stock for ${product?.name || 'Item'}`, 400);
                    }

                    await tx.inventory.update({
                        where: { id: item.inventoryId },
                        data: { quantity: product.quantity - item.quantity }
                    });

                    inventoryTotal += Number(item.price || item.unitPrice || product.unitPrice) * item.quantity;
                    serviceDetails.push(`${product.name} x${item.quantity}`);
                }
                if (!manualAmount && inventoryTotal > 0) totalAmount = inventoryTotal;
            }

            let patientId: number;
            let doctorId: number;
            let description: string;

            if (source === 'ORDER') {
                const order = await tx.service_order.update({
                    where: { id: orderId },
                    data: { testStatus: 'Completed' }
                });
                patientId = order.patientId;
                doctorId = order.doctorId;
                description = order.testName;
            } else {
                const record = await tx.medicalrecord.update({
                    where: { id: orderId },
                    data: { status: 'Dispensed', isClosed: true }
                });
                patientId = record.patientId;
                doctorId = record.doctorId;
                try {
                    const parsed = JSON.parse(record.data);
                    description = Array.isArray(parsed.items)
                        ? parsed.items.map((i: any) => i.medicineName || i.medicine || i).join(', ')
                        : 'Prescription';
                } catch {
                    description = 'Prescription';
                }
            }

            if (serviceDetails.length === 0) {
                try {
                    const parsed = JSON.parse(description);
                    if (Array.isArray(parsed)) description = parsed.map((i: any) => i.medicine || i.name || i).join(', ');
                } catch (e) { }
                serviceDetails.push(description || `Prescription #${orderId}`);
            }

            // Create Invoice
            const invoice = await tx.invoice.create({
                data: {
                    id: `PH-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,

                    clinicId,
                    patientId,
                    doctorId,
                    service: `Pharmacy: ${serviceDetails.join(', ')}`,
                    amount: totalAmount,
                    status: paid ? 'Paid' : 'Pending',
                    date: new Date()
                }
            });

            // Update Order/Record with result/metadata
            if (source === 'ORDER') {
                await tx.service_order.update({
                    where: { id: orderId },
                    data: {
                        result: JSON.stringify({
                            invoiceId: invoice.id,
                            amount: totalAmount,
                            paid,
                            items: serviceDetails
                        })
                    }
                });
            } else {
                // For EMR, we can store metadata in a specific way if needed, 
                // but usually we just update the record as Dispensed.
                // We might want to append the invoice info to the record's data if possible,
                // but let's keep it simple for now.
            }

            return { invoice };
        }, {
            timeout: 20000
        });
    } catch (error) {
        console.error(`[Pharmacy Service] Error processing ${source} ${orderId}:`, error);
        throw error;
    }
};


export const directSale = async (clinicId: number, data: any) => {
    const { patientId, items, paid } = data;

    return await prisma.$transaction(async (tx) => {
        let totalAmount = 0;
        let serviceDetails = [];

        for (const item of items) {
            const product = await tx.inventory.findUnique({
                where: { id: item.inventoryId }
            });

            if (!product || product.quantity < item.quantity) {
                throw new AppError(`Insufficient stock for ${product?.name || 'Item'}`, 400);
            }

            // Deduct stock
            await tx.inventory.update({
                where: { id: item.inventoryId },
                data: { quantity: product.quantity - item.quantity }
            });

            totalAmount += Number(item.price || product.unitPrice) * item.quantity;
            serviceDetails.push(`${product.name} x${item.quantity}`);
        }

        // Create Invoice
        const invoice = await tx.invoice.create({
            data: {
                id: `PH-POS-${Math.floor(1000 + Math.random() * 9000)}`,

                clinicId,
                patientId: Number(patientId),
                service: `Direct Sale: ${serviceDetails.join(', ')}`,
                amount: totalAmount,
                status: paid ? 'Paid' : 'Pending'
            }
        });

        return { invoice };
    });
};

export const getPosSales = async (clinicId: number) => {
    return await prisma.invoice.findMany({
        where: {
            clinicId,
            service: { contains: 'Direct Sale' }
        },
        include: {
            patient: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const updatePosSale = async (clinicId: number, invoiceId: string, data: any) => {
    const existing = await prisma.invoice.findFirst({
        where: { id: invoiceId, clinicId, service: { contains: 'Direct Sale' } }
    });
    if (!existing) throw new AppError('POS sale not found', 404);
    const { status } = data;
    return await prisma.invoice.update({
        where: { id: invoiceId },
        data: status != null ? { status: String(status) } : {}
    });
};

export const deletePosSale = async (clinicId: number, invoiceId: string) => {
    const existing = await prisma.invoice.findFirst({
        where: { id: invoiceId, clinicId, service: { contains: 'Direct Sale' } }
    });
    if (!existing) throw new AppError('POS sale not found', 404);
    await prisma.invoice.delete({ where: { id: invoiceId } });
    return { message: 'Sale deleted' };
};

export const getDailySalesReports = async (clinicId: number, dateStr: string) => {
    // dateStr format: YYYY-MM-DD
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const invoices = await prisma.invoice.findMany({
        where: {
            clinicId,
            createdAt: {
                gte: startOfDay,
                lte: endOfDay
            },
            OR: [
                { service: { contains: 'Pharmacy:' } },
                { service: { contains: 'Direct Sale:' } }
            ]
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    const dailyStats = {
        totalCount: invoices.length,
        totalRevenue: invoices.reduce((sum, inv) => sum + Number(inv.amount), 0),
        medicines: [] as any[]
    };

    const medicineMap = new Map<string, { quantity: number, total: number }>();

    invoices.forEach(inv => {
        // Parse items
        // simple parsing assuming standard format generated by processPharmacyOrder and directSale
        const content = inv.service.replace('Pharmacy: ', '').replace('Direct Sale: ', '');
        const items = content.split(', ');
        items.forEach(itemStr => {
            const parts = itemStr.trim().split(' x');
            if (parts.length >= 2) {
                const qty = Number(parts[parts.length - 1]);
                const name = parts.slice(0, parts.length - 1).join(' x');

                const current = medicineMap.get(name) || { quantity: 0, total: 0 };
                medicineMap.set(name, {
                    quantity: current.quantity + qty,
                    total: 0
                });
            }
        });
    });

    dailyStats.medicines = Array.from(medicineMap.entries()).map(([name, data]) => ({
        name,
        quantity: data.quantity,
        totalAmount: 0
    }));

    // Shift Logic: Morning (6-14), Evening (14-22), Night (22-6 next day)
    // Note: Night shift of TODAY is 22:00 up to Tomorrow 06:00. 
    // Wait, usually daily report for "Today" includes 00:00-06:00 (Previous Night continuation) or start of day?
    // Let's stick to strict Time-of-Day based bucketing for the selected date invoices.

    type ShiftKey = 'Morning' | 'Evening' | 'Night';

    const shiftStats: Record<ShiftKey, { count: number, revenue: number, medicines: any[] }> = {
        Morning: { count: 0, revenue: 0, medicines: [] },
        Evening: { count: 0, revenue: 0, medicines: [] },
        Night: { count: 0, revenue: 0, medicines: [] }
    };

    const getShift = (date: Date): ShiftKey => {
        const h = date.getHours();
        if (h >= 6 && h < 14) return 'Morning';
        if (h >= 14 && h < 22) return 'Evening';
        return 'Night';
    };

    const shiftMedicineMaps = {
        Morning: new Map<string, number>(),
        Evening: new Map<string, number>(),
        Night: new Map<string, number>()
    };

    invoices.forEach(inv => {
        const shift = getShift(new Date(inv.createdAt));
        shiftStats[shift].count++;
        shiftStats[shift].revenue += Number(inv.amount);

        const content = inv.service.replace('Pharmacy: ', '').replace('Direct Sale: ', '');
        const items = content.split(', ');
        items.forEach(itemStr => {
            const parts = itemStr.trim().split(' x');
            if (parts.length >= 2) {
                const qty = Number(parts[parts.length - 1]);
                const name = parts.slice(0, parts.length - 1).join(' x');

                const currentQty = shiftMedicineMaps[shift].get(name) || 0;
                shiftMedicineMaps[shift].set(name, currentQty + qty);
            }
        });
    });

    (Object.keys(shiftStats) as ShiftKey[]).forEach(shift => {
        shiftStats[shift].medicines = Array.from(shiftMedicineMaps[shift].entries()).map(([name, qty]) => ({
            name,
            quantity: qty,
            totalAmount: 0
        }));
    });

    return { daily: dailyStats, shifts: shiftStats };
};
