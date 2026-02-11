import nodemailer from 'nodemailer';
import { prisma } from '../server.js';
export const sendEmail = async (to, subject, html) => {
    try {
        const settings = await prisma.system_settings.findMany();
        const config = settings.reduce((acc, s) => {
            acc[s.key] = s.value;
            return acc;
        }, {});
        const transporter = nodemailer.createTransport({
            host: config.SMTP_HOST || process.env.SMTP_HOST,
            port: Number(config.SMTP_PORT) || Number(process.env.SMTP_PORT) || 587,
            secure: config.SMTP_SECURE === 'true',
            auth: {
                user: config.SMTP_USER || process.env.SMTP_USER,
                pass: config.SMTP_PASS || process.env.SMTP_PASS
            }
        });
        const mailOptions = {
            from: config.SMTP_FROM || process.env.SMTP_FROM || '"Exclusive Vision" <otp@exclusivevision.com>',
            to,
            subject,
            html
        };
        const result = await transporter.sendMail(mailOptions);
        console.log(`Email sent: ${result.messageId}`);
        return result;
    }
    catch (error) {
        console.error('Email send error:', error);
        // In local development, we might not have valid SMTP, so we log the OTP instead
        console.log('--- FALLBACK: EMAIL NOT SENT but LOGGING CONTENT ---');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body: ${html}`);
        console.log('----------------------------------------------------');
        return { success: false, error };
    }
};
export const sendOTP = async (email, otp) => {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1E1B4B;">Exclusive Vision</h2>
                <p style="color: #64748B;">Healthcare Information System</p>
            </div>
            <div style="background: #F8FAFC; padding: 30px; border-radius: 10px; text-align: center;">
                <p style="font-size: 16px; color: #1E293B;">Your Two-Step Verification Code is:</p>
                <h1 style="font-size: 36px; color: #2D3BAE; letter-spacing: 5px; margin: 20px 0;">${otp}</h1>
                <p style="font-size: 14px; color: #64748B;">This code will expire in 10 minutes. Do not share this code with anyone.</p>
            </div>
            <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #94A3B8;">
                <p>© ${new Date().getFullYear()} Exclusive Vision. All rights reserved.</p>
            </div>
        </div>
    `;
    return sendEmail(email, 'Your 2FA OTP Code', html);
};
export const sendCredentialsEmail = async (email, name, password) => {
    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173/login';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1E1B4B;">Exclusive Vision</h2>
                <p style="color: #64748B;">Welcome to our Patient Portal</p>
            </div>
            <div style="padding: 20px;">
                <p>Dear ${name},</p>
                <p>Your patient account has been successfully created. You can now access your medical records, appointments, and prescriptions online.</p>
                
                <div style="background: #F8FAFC; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2D3BAE;">
                    <p style="margin: 5px 0;"><strong>Username:</strong> ${email}</p>
                    <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${password}</p>
                </div>

                <p>For security reasons, please change your password immediately after logging in.</p>
                
                <div style="text-align: center; margin-top: 30px;">
                    <a href="${loginUrl}" style="background-color: #2D3BAE; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Login to Portal</a>
                </div>
            </div>
            <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #94A3B8;">
                <p>© ${new Date().getFullYear()} Exclusive Vision. All rights reserved.</p>
            </div>
        </div>
    `;
    return sendEmail(email, 'Your Patient Portal Access', html);
};
