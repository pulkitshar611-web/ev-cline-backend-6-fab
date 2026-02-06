import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function fix() {
    const pooja = await prisma.clinic.findFirst({ where: { name: { contains: 'pooja' } } });
    if (pooja) {
        await prisma.clinic.update({
            where: { id: pooja.id },
            data: {
                modules: JSON.stringify({
                    pharmacy: true,
                    radiology: true,
                    laboratory: true,
                    billing: true,
                    inventory: true,
                    reports: true
                })
            }
        });
        console.log('Modules enabled for Pooja Clinic');

        // Ensure staff records for all relevant test users
        const emails = ['pharma@ev-clinic.com', 'lab@ev-clinic.com', 'radio@ev-clinic.com', 'accountant@ev-clinic.com', 'doctor@ev-clinic.com'];
        for (const email of emails) {
            const user = await prisma.user.findUnique({ where: { email } });
            if (user) {
                const existing = await prisma.clinicstaff.findFirst({
                    where: { userId: user.id, clinicId: pooja.id }
                });
                if (!existing) {
                    await prisma.clinicstaff.create({
                        data: {
                            userId: user.id,
                            clinicId: pooja.id,
                            role: user.role === 'DOCTOR' ? 'DOCTOR' :
                                user.role === 'PHARMACY' ? 'PHARMACY' :
                                    user.role === 'RADIOLOGY' ? 'RADIOLOGY' :
                                        user.role === 'LAB' ? 'LAB' :
                                            user.role === 'ACCOUNTANT' ? 'ACCOUNTANT' : 'STAFF'
                        }
                    });
                    console.log(`Added ${email} to Pooja Clinic`);
                }
            }
        }
    }
    process.exit(0);
}
fix();
