import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as documentService from '../services/document.controller.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getRecords = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId!;
    const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
    const archivedOnly = req.query.archived === 'true';

    const records = await documentService.getDocumentRecords(clinicId, { patientId, archivedOnly });
    res.status(200).json({ status: 'success', data: records });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const stats = await documentService.getDocumentStats(req.clinicId!);
    res.status(200).json({ status: 'success', data: stats });
});

export const createRecord = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId!;
    const userId = req.user!.id;
    const record = await documentService.createDocumentRecord(clinicId, userId, req.body);
    res.status(201).json({ status: 'success', data: record });
});

export const getStaffRecords = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId!;
    const records = await documentService.getStaffDocumentRecords(clinicId);
    res.status(200).json({ status: 'success', data: records });
});

export const createStaffRecord = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId!;
    const record = await documentService.createStaffDocumentRecord(clinicId, req.body);
    res.status(201).json({ status: 'success', data: record });
});
