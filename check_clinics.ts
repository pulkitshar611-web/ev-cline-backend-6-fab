import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    try {
        const clinics = await prisma.clinic.findMany();
        fs.writeFileSync('clinics_check.txt', JSON.stringify(clinics, null, 2), 'utf8');
    } catch (e) {
        fs.writeFileSync('clinics_check.txt', `Error: ${e.message}`, 'utf8');
    } finally {
        await prisma.$disconnect();
    }
}

main();
