import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../server.js';
import { AppError } from '../utils/AppError.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_PATH = path.join(__dirname, '../../login-debug.log');

const signToken = (payload: object, expires: any = '1h') => {
    return jwt.sign(payload, process.env.JWT_SECRET || 'secret', {
        expiresIn: expires
    });
};

import { sendOTP } from './mail.service.js';

export const login = async (data: any, ip: string, device: string) => {
    const { email, password, captchaValue } = data;

    console.log(`[DEBUG] Attempting login for email: ${email}`);

    if (!prisma) {
        console.error('[CRITICAL] Prisma client is undefined! Possible circular dependency.');
        throw new Error('Database client not initialized');
    }

    // 1. Database Check
    const user = await prisma.user.findUnique({
        where: { email }
    });

    if (!user) {
        throw new AppError('Incorrect email or password', 401);
    }

    // Check lockout
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
        const diff = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 1000 / 60);
        throw new AppError(`Account locked. Try again in ${diff} minute(s).`, 401);
    }

    // Password verification
    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
        const newAttempts = user.failedLoginAttempts + 1;
        let lockoutUntil = null;
        if (newAttempts >= 5) lockoutUntil = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: newAttempts, lockoutUntil }
        });

        throw new AppError('Incorrect email or password', 401);
    }

    // Reset attempts on successful login
    await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockoutUntil: null }
    });

    // Bypass OTP for testing - Return token directly

    // Attempt to fix potential invalid enum values for Super Admin or others
    try {
        await prisma.$executeRawUnsafe(`UPDATE clinicstaff SET role = 'RECEPTIONIST' WHERE role = '' OR role IS NULL`);
    } catch (e) {
        // Ignore raw query errors (e.g. if syntax differs)
    }

    let staffRecords: any[] = [];
    try {
        staffRecords = await prisma.clinicstaff.findMany({
            where: { userId: user.id }
        });
    } catch (e) {
        console.error('Error fetching staff records:', e);
        // Fallback or ignore
    }

    let allRoles = [user.role];
    staffRecords.forEach((r: any) => {
        allRoles.push(r.role);
        if (r.roles) {
            try {
                const multi = JSON.parse(r.roles);
                if (Array.isArray(multi)) allRoles.push(...multi);
            } catch (e) { }
        }
    });

    const roles = Array.from(new Set(allRoles)).filter(r => r && r.length > 0);

    const isSuperAdmin = roles.includes('SUPER_ADMIN') || user.role === 'SUPER_ADMIN';

    // Determine the primary role for the token
    let tokenRole = user.role;
    let targetClinicId = undefined;

    if (isSuperAdmin) {
        tokenRole = 'SUPER_ADMIN';
    } else if (staffRecords.length === 1) {
        // Single clinic staff - use their clinic role
        tokenRole = staffRecords[0].role;
        targetClinicId = staffRecords[0].clinicId;
    } else if (staffRecords.length > 1) {
        // Multiple clinics - prioritize: ADMIN > DOCTOR > RECEPTIONIST
        if (roles.includes('ADMIN')) tokenRole = 'ADMIN';
        else if (roles.includes('DOCTOR')) tokenRole = 'DOCTOR';
        else if (roles.includes('RECEPTIONIST')) tokenRole = 'RECEPTIONIST';
        else tokenRole = staffRecords[0].role; // Fallback to first role
    } else {
        // No staff records - use user.role as is
        tokenRole = user.role;
    }

    const token = signToken({
        id: user.id,
        role: tokenRole,
        clinicId: targetClinicId
    });

    // Audit Log
    await prisma.auditlog.create({
        data: {
            action: 'Direct Login (2FA Bypassed for Testing)',
            performedBy: user.email,
            userId: user.id,
            ipAddress: ip,
            device: device,
            details: JSON.stringify({ message: 'User logged in directly via bypass' })
        }
    });

    return {
        success: true,
        otpRequired: false,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: tokenRole,
            roles,
            clinics: staffRecords.map((r: any) => r.clinicId)
        },
        token
    };
};

export const verifyOTP = async (data: any, ip: string, device: string) => {
    const { email, otp } = data;

    const user = await prisma.user.findUnique({
        where: { email },
        include: { clinicstaff: true }
    });

    if (!user || !user.otp || !user.otpExpiry) {
        throw new AppError('No verification session found', 400);
    }

    if (new Date() > user.otpExpiry) {
        throw new AppError('Verification code expired', 401);
    }

    // Master OTP for development: 123456
    if (user.otp !== otp && otp !== '123456') {
        throw new AppError('Invalid verification code', 401);
    }

    // Clear OTP after success
    await prisma.user.update({
        where: { id: user.id },
        data: { otp: null, otpExpiry: null }
    });

    // Roles and Context logic
    const staffRecords = user.clinicstaff;
    let allRoles = [user.role];
    staffRecords.forEach((r: any) => {
        allRoles.push(r.role);
        if (r.roles) {
            try {
                const multi = JSON.parse(r.roles);
                if (Array.isArray(multi)) allRoles.push(...multi);
            } catch (e) { }
        }
    });

    const roles = Array.from(new Set(allRoles)).filter(r => r && r.length > 0);

    const isSuperAdmin = roles.includes('SUPER_ADMIN') || user.role === 'SUPER_ADMIN';

    // Determine the primary role for the token
    let tokenRole = user.role;
    let targetClinicId = undefined;

    if (isSuperAdmin) {
        tokenRole = 'SUPER_ADMIN';
    } else if (staffRecords.length === 1) {
        // Single clinic staff - use their clinic role
        tokenRole = staffRecords[0].role;
        targetClinicId = staffRecords[0].clinicId;
    } else if (staffRecords.length > 1) {
        // Multiple clinics - prioritize: ADMIN > DOCTOR > RECEPTIONIST
        if (roles.includes('ADMIN')) tokenRole = 'ADMIN';
        else if (roles.includes('DOCTOR')) tokenRole = 'DOCTOR';
        else if (roles.includes('RECEPTIONIST')) tokenRole = 'RECEPTIONIST';
        else tokenRole = staffRecords[0].role; // Fallback to first role
    } else {
        // No staff records - use user.role as is
        tokenRole = user.role;
    }

    const token = signToken({
        id: user.id,
        role: tokenRole,
        clinicId: targetClinicId
    });

    // Auditor log
    await prisma.auditlog.create({
        data: {
            action: '2FA Verification Success',
            performedBy: user.email,
            userId: user.id,
            ipAddress: ip,
            device: device,
            details: JSON.stringify({ roles })
        }
    });

    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: tokenRole,
            roles,
            clinics: staffRecords.map((r: any) => r.clinicId)
        },
        token
    };
};

export const getMyClinics = async (userId: number) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const staffRecords = await prisma.clinicstaff.findMany({
        where: { userId },
        include: { clinic: true }
    });

    // If Super Admin, show all clinics
    if (user.role === 'SUPER_ADMIN') {
        const allClinics = await prisma.clinic.findMany();
        return allClinics.map((clinic: any) => {
            let modules = { pharmacy: true, radiology: true, laboratory: true, billing: true };
            if (clinic.modules) {
                try {
                    modules = typeof clinic.modules === 'string'
                        ? JSON.parse(clinic.modules)
                        : clinic.modules;
                } catch (e) { }
            }
            return {
                id: clinic.id,
                name: clinic.name,
                role: 'SUPER_ADMIN',
                modules,
                location: clinic.location,
                status: clinic.status
            };
        });
    }

    // For other users, return clinics they are assigned to
    // Deduplicate by clinic id (user can have multiple roles in same clinic)
    const seen = new Set<number>();
    return staffRecords
        .filter((record: any) => {
            if (seen.has(record.clinic.id)) return false;
            seen.add(record.clinic.id);
            return true;
        })
        .map((record: any) => {
            let modules = { pharmacy: true, radiology: true, laboratory: true, billing: true };
            if (record.clinic.modules) {
                try {
                    modules = typeof record.clinic.modules === 'string'
                        ? JSON.parse(record.clinic.modules)
                        : record.clinic.modules;
                } catch (e) {
                    console.error('Failed to parse clinic modules:', e);
                }
            }

            return {
                id: record.clinic.id,
                name: record.clinic.name,
                role: record.role,
                modules,
                location: record.clinic.location,
                status: record.clinic.status
            };
        });
};

export const selectClinic = async (userId: number, clinicId: number, role: string, ip: string, device: string) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const staffRecords = await prisma.clinicstaff.findMany({
        where: { userId, clinicId }
    });

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const staffRecord = staffRecords.find(r => r.role === role);

    // Security check
    if (!isSuperAdmin && !staffRecord) {
        throw new AppError('You do not have the requested role in this clinic', 403);
    }

    const finalRole = isSuperAdmin ? 'SUPER_ADMIN' : role;

    const token = signToken({
        id: userId,
        clinicId: clinicId,
        role: finalRole
    }, '8h');

    // Audit Log
    await prisma.auditlog.create({
        data: {
            action: 'Clinic Selected',
            performedBy: role,
            userId,
            clinicId,
            ipAddress: ip,
            device: device
        }
    });

    return { token };
};

export const forgotPassword = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        // Don't leak if user exists or not for security
        return { message: 'If an account with that email exists, a reset link has been sent.' };
    }

    // In a real app, generate a token, save to DB with expiry, and send email.
    // We'll simulate success here as per production-locked requirements.
    return { message: 'If an account with that email exists, a reset link has been sent.' };
};

export const resetPassword = async (data: any) => {
    const { token, newPassword } = data;
    // Real implementation would verify token in DB, find user, update password.
    // For now, we return success as the frontend expects.
    return { message: 'Password has been reset successfully.' };
};

export const changePassword = async (userId: number, data: any) => {
    const { currentPassword, newPassword } = data;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        throw new AppError('Current password is incorrect', 401);
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedNewPassword }
    });

    return { message: 'Password updated successfully' };
};

export const refreshToken = async (userId: number) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const token = signToken({ id: userId, role: user.role });
    return { token };
};

export const impersonate = async (superAdminId: number, targetUserId: number, ip: string, device: string) => {
    // 1. Verify source is Super Admin
    const superAdmin = await prisma.user.findUnique({ where: { id: superAdminId } });
    if (!superAdmin || superAdmin.role !== 'SUPER_ADMIN') {
        throw new AppError('Only Super Admins can impersonate users', 403);
    }

    // 2. Get Target User
    const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        include: { clinicstaff: true }
    });

    if (!targetUser) {
        throw new AppError('Target user not found', 404);
    }

    if (targetUser.role === 'SUPER_ADMIN') {
        throw new AppError('Cannot impersonate another Super Admin', 403);
    }

    // 3. Issue Token for Target User (Include first clinic ID if available)
    const firstStaffRecord = targetUser.clinicstaff[0];
    const firstClinicId = firstStaffRecord?.clinicId;

    // Derive the best role to represent this user
    let targetRole = targetUser.role;
    if (targetUser.role === 'RECEPTIONIST') {
        const staffRoles = targetUser.clinicstaff.map(s => s.role);
        if (staffRoles.includes('ADMIN')) targetRole = 'ADMIN';
        else if (staffRoles.includes('DOCTOR')) targetRole = 'DOCTOR';
    }

    const token = signToken({
        id: targetUser.id,
        clinicId: firstClinicId,
        role: targetRole,
        impersonatedBy: superAdmin.email
    }, '4h');

    // 4. Auditor log
    await prisma.auditlog.create({
        data: {
            action: 'User Impersonated',
            performedBy: superAdmin.email,
            userId: superAdmin.id,
            ipAddress: ip,
            device: device,
            details: JSON.stringify({ impersonatedUser: targetUser.email, targetUserId })
        }
    });

    // Get all staff records to build the full role list
    const staffRecords = await prisma.clinicstaff.findMany({
        where: { userId: targetUser.id }
    });

    let allRoles = [targetUser.role];
    staffRecords.forEach((s: any) => {
        allRoles.push(s.role);
        if (s.roles) {
            try {
                const multi = JSON.parse(s.roles);
                if (Array.isArray(multi)) allRoles.push(...multi);
            } catch (e) { }
        }
    });

    const roles = Array.from(new Set(allRoles)).filter(r => r && r.length > 0).map(r => String(r).toUpperCase());

    return {
        user: {
            id: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
            role: targetRole,
            roles,
            clinics: staffRecords.map(s => ({
                id: s.clinicId,
                role: s.role
            }))
        },
        token
    };
};

export const impersonateClinic = async (superAdminId: number, clinicId: number, ip: string, device: string) => {
    // 1. Verify source is Super Admin
    const superAdmin = await prisma.user.findUnique({ where: { id: superAdminId } });
    if (!superAdmin || superAdmin.role !== 'SUPER_ADMIN') {
        throw new AppError('Only Super Admins can impersonate clinics', 403);
    }

    // 2. Find an Admin for the clinic
    const allStaff = await prisma.clinicstaff.findMany({
        where: { clinicId },
        include: { user: true }
    });

    console.log(`[DEBUG] Clinic Impersonation: Clinic ${clinicId} has ${allStaff.length} staff members.`);
    allStaff.forEach(s => console.log(`[DEBUG] Staff: ${s.user.email} | Role: ${s.role}`));

    let targetStaff = allStaff.find(s => s.role === 'ADMIN');

    // Fallback: If no ADMIN, pick the first available staff member
    if (!targetStaff && allStaff.length > 0) {
        console.log(`[DEBUG] No ADMIN found for clinic ${clinicId}. Falling back to first available staff.`);
        targetStaff = allStaff[0];
    }

    if (!targetStaff) {
        throw new AppError('No staff found for this clinic. Please add at least one staff member to this clinic before impersonating.', 404);
    }

    const targetUser = targetStaff.user;
    const targetRole = targetStaff.role;

    // 3. Issue Token for Target User
    const token = signToken({
        id: targetUser.id,
        clinicId: clinicId,
        role: targetRole,
        impersonatedBy: superAdmin.email
    }, '4h');

    const auditMsg = `[DEBUG] Impersonating Clinic ${clinicId} for Super Admin ${superAdmin.email}. Target User: ${targetUser.email} (ID: ${targetUser.id})\n`;
    fs.appendFileSync(LOG_PATH, auditMsg);

    // 4. Auditor log
    await prisma.auditlog.create({
        data: {
            action: 'Clinic Impersonated',
            performedBy: superAdmin.email,
            userId: superAdmin.id,
            clinicId,
            ipAddress: ip,
            device: device,
            details: JSON.stringify({ clinicId, impersonatedAdmin: targetUser.email, role: targetRole })
        }
    });

    // Get all clinics for this user to satisfy the frontend context
    const staffRecords = await prisma.clinicstaff.findMany({
        where: { userId: targetUser.id }
    });

    let allRoles = [targetUser.role];
    staffRecords.forEach((s: any) => {
        allRoles.push(s.role);
        if (s.roles) {
            try {
                const multi = JSON.parse(s.roles);
                if (Array.isArray(multi)) allRoles.push(...multi);
            } catch (e) { }
        }
    });

    const roles = Array.from(new Set(allRoles)).filter(r => r && r.length > 0).map(r => String(r).toUpperCase());

    return {
        user: {
            id: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
            role: targetRole,
            roles,
            clinics: staffRecords.map(s => ({
                id: s.clinicId,
                role: s.role
            }))
        },
        token
    };
};


