import * as menuService from '../services/menu.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export const getMenu = asyncHandler(async (req, res) => {
    const roleParam = Array.isArray(req.params.role) ? req.params.role[0] : req.params.role;
    const role = roleParam || req.user?.role;
    const menu = await menuService.getMenuByRole(role);
    res.status(200).json({ success: true, data: menu });
});
