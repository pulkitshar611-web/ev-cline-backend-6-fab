import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';
const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const getInventory = async (clinicId) => {
    return await prisma.inventory.findMany({
        where: { clinicId },
        orderBy: { name: 'asc' }
    });
};
export const getLowStockInventory = async (clinicId, threshold = DEFAULT_LOW_STOCK_THRESHOLD) => {
    return await prisma.inventory.findMany({
        where: {
            clinicId,
            quantity: { lte: threshold }
        },
        orderBy: { quantity: 'asc' }
    });
};
export const addInventory = async (clinicId, data) => {
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
export const updateInventory = async (id, data) => {
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
export const getPharmacyOrders = async (clinicId) => {
    console.log(`[PHARMACY] Fetching orders for clinic ${clinicId}`);
    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            type: { in: ['PHARMACY', 'Pharmacy', 'pharmacy'] } // Robust check
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
    console.log(`[PHARMACY] Found ${orders.length} orders for clinic ${clinicId}`);
    return orders;
};
export const processPharmacyOrder = async (clinicId, orderId, items = [], paid = false, manualAmount) => {
    // items: array of { inventoryId, quantity, price }
    console.log(`[Pharmacy Service] Processing Order ${orderId} | Paid: ${paid} | Amount: ${manualAmount} | Items: ${items.length}`);
    try {
        return await prisma.$transaction(async (tx) => {
            let totalAmount = Number(manualAmount) || 0;
            let serviceDetails = [];
            // If items are provided, calculate total and update inventory
            if (items && items.length > 0) {
                let inventoryTotal = 0;
                for (const item of items) {
                    if (!item.inventoryId)
                        continue; // Skip invalid items
                    const product = await tx.inventory.findUnique({
                        where: { id: item.inventoryId }
                    });
                    if (!product)
                        continue; // Skip if product not found
                    if (product.quantity < item.quantity) {
                        throw new AppError(`Insufficient stock for ${product?.name || 'Item'}`, 400);
                    }
                    // Deduct stock
                    await tx.inventory.update({
                        where: { id: item.inventoryId },
                        data: { quantity: product.quantity - item.quantity }
                    });
                    inventoryTotal += Number(item.price || product.unitPrice) * item.quantity;
                    serviceDetails.push(`${product.name} x${item.quantity}`);
                }
                if (!manualAmount && inventoryTotal > 0)
                    totalAmount = inventoryTotal;
            }
            console.log(`[Pharmacy Service] Updating order status for ID: ${orderId}`);
            // Update Order Status
            const order = await tx.service_order.update({
                where: { id: orderId },
                data: { status: 'Completed' }
            });
            if (serviceDetails.length === 0) {
                // If no inventory items matched, use the doctor's prescription text
                // Clean up the text if it's JSON array string or just use as is
                let desc = order.testName;
                try {
                    const parsed = JSON.parse(desc);
                    if (Array.isArray(parsed))
                        desc = parsed.map((i) => i.medicine || i.name || i).join(', ');
                }
                catch (e) {
                    // Not JSON, use as plain text
                }
                serviceDetails.push(desc || `Prescription #${orderId}`);
            }
            console.log(`[Pharmacy Service] Creating invoice for Patient: ${order.patientId}`);
            // Create Invoice
            const invoice = await tx.invoice.create({
                data: {
                    id: `RX-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`,
                    clinicId,
                    patientId: order.patientId,
                    doctorId: order.doctorId, // Can be null
                    service: `Pharmacy: ${serviceDetails.join(', ')}`,
                    amount: totalAmount,
                    status: paid ? 'Paid' : 'Pending',
                    date: new Date()
                }
            });
            // Update Order with Invoice metadata for traceability
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
            return { order, invoice };
        }, {
            timeout: 20000 // Increase timeout to 20 seconds
        });
    }
    catch (error) {
        console.error(`[Pharmacy Service] Error processing order ${orderId}:`, error);
        throw error;
    }
};
export const directSale = async (clinicId, data) => {
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
                id: `RX-POS-${Math.floor(1000 + Math.random() * 9000)}`,
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
