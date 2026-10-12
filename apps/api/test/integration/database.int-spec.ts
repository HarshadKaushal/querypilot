import { PrismaClient } from '@ayd/database';

describe('application database', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('answers a query and has the auth tables', async () => {
    await prisma.$queryRaw`SELECT 1`;
    const users = await prisma.user.findMany({ take: 1 });
    expect(Array.isArray(users)).toBe(true);
  });
});
