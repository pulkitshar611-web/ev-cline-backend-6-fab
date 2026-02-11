import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as menuService from '../services/menu.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getMenu = asyncHandler(async (req: AuthRequest, res: Response) => {
    const roleParam = Array.isArray(req.params.role) ? req.params.role[0] : req.params.role;
    const role = (roleParam as string) || (req.user?.role as string);
    const menu = await menuService.getMenuByRole(role);
    res.status(200).json({ success: true, data: menu });
});
