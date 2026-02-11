import * as pharmacyService from '../services/pharmacy.service.js';
export const getInventory = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const inventory = await pharmacyService.getInventory(clinicId);
        res.json({ status: 'success', data: inventory });
    }
    catch (error) {
        next(error);
    }
};
export const getLowStock = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const threshold = req.query.threshold ? Number(req.query.threshold) : 10;
        const items = await pharmacyService.getLowStockInventory(clinicId, threshold);
        res.json({ status: 'success', data: items });
    }
    catch (error) {
        next(error);
    }
};
export const addInventory = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const item = await pharmacyService.addInventory(clinicId, req.body);
        res.status(201).json({ status: 'success', data: item });
    }
    catch (error) {
        next(error);
    }
};
export const getOrders = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const orders = await pharmacyService.getPharmacyOrders(clinicId);
        res.json({ status: 'success', data: orders });
    }
    catch (error) {
        next(error);
    }
};
export const processOrder = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const { orderId, items, paid, amount } = req.body;
        const result = await pharmacyService.processPharmacyOrder(clinicId, orderId, items, paid, amount);
        res.json({ status: 'success', data: result });
    }
    catch (error) {
        next(error);
    }
};
export const directSale = async (req, res, next) => {
    try {
        const clinicId = req.clinicId;
        const result = await pharmacyService.directSale(clinicId, req.body);
        res.status(201).json({ status: 'success', data: result });
    }
    catch (error) {
        next(error);
    }
};
