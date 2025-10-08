import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Seed careers
  const careers = [
    { id: 'BIO', name: 'Bioingeniería' },
    { id: 'C', name: 'Ingeniería Civil' },
    { id: 'E', name: 'Ingeniería Electricista' },
    { id: 'I', name: 'Ingeniería Industrial' },
    { id: 'K', name: 'Ingeniería Electrónica' },
    { id: 'L', name: 'Lic.en Administración y Sistemas' },
    { id: 'LAES', name: 'Licenciatura en Analítica Empresarial y Social' },
    { id: 'LCC', name: 'Licenciatura en Ciencias del Comportamiento' },
    { id: 'LN', name: 'Licenciatura en Negocios' },
    { id: 'M', name: 'Ingeniería Mecánica' },
    { id: 'N', name: 'Ingeniería Naval' },
    { id: 'P', name: 'Ingeniería en Petróleo' },
    { id: 'PAI', name: 'Proceso de Admisión' },
    { id: 'Q', name: 'Ingeniería Química' },
    { id: 'S', name: 'Ingeniería en Informática' },
    { id: 'X', name: 'Intercambio' },
  ];

  console.log('Seeding careers...');
  for (const career of careers) {
    await prisma.career.upsert({
      where: { id: career.id },
      update: { name: career.name },
      create: career,
    });
  }
  console.log(`✓ Seeded ${careers.length} careers`);

  // Seed plans
  const plans = [
    { id: 'A17', careerId: 'LAES', name: 'A17' },
    { id: 'A22', careerId: 'LAES', name: 'A22' },
    { id: 'Bio-13', careerId: 'BIO', name: 'Bio-13' },
    { id: 'BIO 22', careerId: 'BIO', name: 'BIO 22' },
    { id: 'C23', careerId: 'C', name: 'C23' },
    { id: 'E 11', careerId: 'E', name: 'E 11' },
    { id: 'E 11A', careerId: 'E', name: 'E 11A' },
    { id: 'I-13', careerId: 'I', name: 'I-13' },
    { id: 'I-13T', careerId: 'I', name: 'I-13T' },
    { id: 'I22', careerId: 'I', name: 'I22' },
    { id: 'IN23', careerId: 'X', name: 'IN23' },
    { id: 'K07A-Rev.18', careerId: 'K', name: 'K07A-Rev.18' },
    { id: 'K07-Rev.18', careerId: 'K', name: 'K07-Rev.18' },
    { id: 'K22', careerId: 'K', name: 'K22' },
    { id: 'L09', careerId: 'L', name: 'L09' },
    { id: 'L09-REV13', careerId: 'L', name: 'L09-REV13' },
    { id: 'L09T', careerId: 'L', name: 'L09T' },
    { id: 'L20', careerId: 'LN', name: 'L20' },
    { id: 'M09 - Rev18 (Agosto)', careerId: 'M', name: 'M09 - Rev18 (Agosto)' },
    { id: 'M09 - Rev18 (Marzo)', careerId: 'M', name: 'M09 - Rev18 (Marzo)' },
    { id: 'M22', careerId: 'M', name: 'M22' },
    { id: 'N18 Agosto', careerId: 'N', name: 'N18 Agosto' },
    { id: 'N18 Marzo', careerId: 'N', name: 'N18 Marzo' },
    { id: 'N22', careerId: 'N', name: 'N22' },
    { id: 'P05', careerId: 'P', name: 'P05' },
    { id: 'P05-Rev.18', careerId: 'P', name: 'P05-Rev.18' },
    { id: 'P-13', careerId: 'P', name: 'P-13' },
    { id: 'P22', careerId: 'P', name: 'P22' },
    { id: 'PA25 Proceso I', careerId: 'PAI', name: 'PA25 Proceso I' },
    { id: 'Q05 - Rev.18', careerId: 'Q', name: 'Q05 - Rev.18' },
    { id: 'Q22', careerId: 'Q', name: 'Q22' },
    { id: 'S10 A - Rev18', careerId: 'S', name: 'S10 A - Rev18' },
    { id: 'S10 - Rev18', careerId: 'S', name: 'S10 - Rev18' },
    { id: 'S10-Rev23', careerId: 'S', name: 'S10-Rev23' },
  ];

  console.log('Seeding plans...');
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: { name: plan.name, careerId: plan.careerId },
      create: { id: plan.id, careerId: plan.careerId, name: plan.name },
    });
  }
  console.log(`✓ Seeded ${plans.length} plans`);

  console.log('Database seed completed!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
