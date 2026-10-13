import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthRepository } from '../../src/auth/auth.repository';
import { MemoryAuthRepository } from '../../src/testing/memory-auth.repository';
import { PrismaAuthRepository } from '../../src/auth/prisma-auth.repository';
import { loadEnv } from '../../src/config/env';
import { PrismaService } from '../../src/prisma/prisma.service';

// One contract, run against both implementations. The unit tests use the in-memory fake,
// so this proves the fake behaves like the real repository on the security-relevant rules:
// single-use refresh tokens, family revocation, and account deletion.

const prisma = new PrismaService(loadEnv());
// Deletion audit rows outlive their user, so they are removed by id at the end.
const deletedUserIds: string[] = [];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { googleSubject: { startsWith: 'contract:' } } });
  for (const id of deletedUserIds) {
    await prisma.auditLog.deleteMany({
      where: { metadata: { path: ['deletedUserId'], equals: id } },
    });
  }
  await prisma.$disconnect();
});

// auditEvents reads back the audit rows a deletion left, which the interface does not expose.
function contract(
  name: string,
  make: () => AuthRepository,
  auditEvents: (
    repo: AuthRepository,
    deletedUserId: string,
  ) => Promise<Array<{ userId: string | null; eventType: string }>>,
) {
  describe(`${name} auth repository`, () => {
    let repo: AuthRepository;

    beforeEach(() => {
      repo = make();
    });

    function replacement(userId: string, familyId: string) {
      return {
        id: randomUUID(),
        userId,
        familyId,
        tokenHash: randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + 60000),
        deviceInfo: null,
      };
    }

    async function user() {
      return repo.upsertGoogleUser({
        googleSubject: `contract:${randomUUID()}`,
        email: 'contract@example.test',
        name: 'Contract test',
        avatarUrl: null,
        lastLoginAt: new Date(),
      });
    }

    async function token(userId: string, familyId = randomUUID(), expiresInMs = 60000) {
      const id = randomUUID();
      const tokenHash = randomBytes(16).toString('hex');
      await repo.insertRefresh({
        id,
        userId,
        familyId,
        tokenHash,
        expiresAt: new Date(Date.now() + expiresInMs),
        deviceInfo: null,
      });
      return { id, tokenHash, familyId };
    }

    it('creates a user on first sign-in and updates the same user afterwards', async () => {
      const subject = `contract:${randomUUID()}`;
      const first = await repo.upsertGoogleUser({
        googleSubject: subject,
        email: 'old@example.test',
        name: 'Old',
        avatarUrl: null,
        lastLoginAt: new Date(),
      });
      const second = await repo.upsertGoogleUser({
        googleSubject: subject,
        email: 'new@example.test',
        name: 'New',
        avatarUrl: 'https://example.test/a.png',
        lastLoginAt: new Date(),
      });
      expect(first).toEqual({
        id: first.id,
        email: 'old@example.test',
        name: 'Old',
        avatarUrl: null,
        planTier: 'free',
      });
      expect(second).toEqual({
        ...first,
        email: 'new@example.test',
        name: 'New',
        avatarUrl: 'https://example.test/a.png',
      });
      expect(await repo.findUserById(first.id)).toEqual(second);
      expect(await repo.findUserById(randomUUID())).toBeNull();
    });

    it('stores a refresh token by hash, unused', async () => {
      const owner = await user();
      const stored = await token(owner.id);
      expect(await repo.findRefreshByHash(stored.tokenHash)).toEqual({
        id: stored.id,
        userId: owner.id,
        familyId: stored.familyId,
        expiresAt: expect.any(Date),
        revokedAt: null,
        replacedById: null,
      });
      expect(await repo.findRefreshByHash('no-such-hash')).toBeNull();
    });

    it('rotates a refresh token exactly once and stores the replacement with it', async () => {
      const owner = await user();
      const stored = await token(owner.id);
      const now = new Date();
      const first = replacement(owner.id, stored.familyId);
      const second = replacement(owner.id, stored.familyId);
      expect(await repo.rotateRefresh(stored.id, first, now)).toBe(true);
      expect(await repo.rotateRefresh(stored.id, second, now)).toBe(false);
      expect(await repo.findRefreshByHash(stored.tokenHash)).toMatchObject({
        revokedAt: expect.any(Date),
        replacedById: first.id,
      });
      expect(await repo.findRefreshByHash(first.tokenHash)).toMatchObject({
        id: first.id,
        familyId: stored.familyId,
        revokedAt: null,
      });
      // The losing rotation wrote nothing.
      expect(await repo.findRefreshByHash(second.tokenHash)).toBeNull();
    });

    it('refuses to rotate an expired or revoked token, and stores no replacement', async () => {
      const owner = await user();
      const expired = await token(owner.id, randomUUID(), -1000);
      const forExpired = replacement(owner.id, expired.familyId);
      expect(await repo.rotateRefresh(expired.id, forExpired, new Date())).toBe(false);
      expect(await repo.findRefreshByHash(forExpired.tokenHash)).toBeNull();
      const revoked = await token(owner.id);
      await repo.revokeToken(revoked.id, new Date());
      const forRevoked = replacement(owner.id, revoked.familyId);
      expect(await repo.rotateRefresh(revoked.id, forRevoked, new Date())).toBe(false);
      expect(await repo.findRefreshByHash(forRevoked.tokenHash)).toBeNull();
    });

    it('revokes a whole family and nothing outside it', async () => {
      const owner = await user();
      const family = randomUUID();
      const a = await token(owner.id, family);
      const b = await token(owner.id, family);
      const other = await token(owner.id);
      await repo.revokeFamily(family, new Date());
      expect((await repo.findRefreshByHash(a.tokenHash))?.revokedAt).toBeInstanceOf(Date);
      expect((await repo.findRefreshByHash(b.tokenHash))?.revokedAt).toBeInstanceOf(Date);
      expect((await repo.findRefreshByHash(other.tokenHash))?.revokedAt).toBeNull();
    });

    it("revokes one token on logout and leaves the user's other logins working", async () => {
      const owner = await user();
      const loggedOut = await token(owner.id);
      const otherDevice = await token(owner.id);
      await repo.revokeToken(loggedOut.id, new Date());
      expect(
        (await repo.findRefreshByHash(loggedOut.tokenHash))?.revokedAt,
      ).toBeInstanceOf(Date);
      expect((await repo.findRefreshByHash(otherDevice.tokenHash))?.revokedAt).toBeNull();
    });

    it('deletes the user with their refresh tokens and keeps the deletion audit row', async () => {
      const owner = await user();
      const stored = await token(owner.id);
      await repo.deleteUser(owner.id, {
        userId: owner.id,
        eventType: 'account.deleted',
        metadata: { deletedUserId: owner.id },
        ip: null,
      });
      expect(await repo.findUserById(owner.id)).toBeNull();
      expect(await repo.findRefreshByHash(stored.tokenHash)).toBeNull();
      expect(await auditEvents(repo, owner.id)).toEqual([
        { userId: null, eventType: 'account.deleted' },
      ]);
    });
  });
}

contract(
  'in-memory',
  () => new MemoryAuthRepository(),
  async (repo, deletedUserId) =>
    (repo as MemoryAuthRepository).audits
      .filter((audit) => audit.metadata.deletedUserId === deletedUserId)
      .map(({ userId, eventType }) => ({ userId, eventType })),
);
contract(
  'Prisma',
  () => new PrismaAuthRepository(prisma),
  async (_repo, deletedUserId) => {
    deletedUserIds.push(deletedUserId);
    return prisma.auditLog.findMany({
      where: { metadata: { path: ['deletedUserId'], equals: deletedUserId } },
      select: { userId: true, eventType: true },
    });
  },
);
