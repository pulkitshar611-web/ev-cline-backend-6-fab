import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const clinics = await prisma.clinic.findMany({ select: { id: true, name: true, subdomain: true, email: true } });
    console.log('Clinics:', clinics);
    const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
    console.log('Users:', users);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
