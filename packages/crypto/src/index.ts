import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Envelope encryption of a customer database's login (ADR 0007). Each connection gets its
// own random data key, which encrypts the username and password; a master key from
// MASTER_KEYS encrypts ("wraps") the data key. The app database stores only ciphertext, so
// a copy of it is useless without the master key, and a new master key needs only the small
// data keys re-wrapped, not every password re-encrypted.

const ALGORITHM = 'aes-256-gcm';
// AES-256 keys are 32 bytes; 12 bytes is the IV length GCM is designed for.
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** What is stored for one connection's login: each value with its IV and GCM tag. */
export interface SealedCredentials {
  usernameCiphertext: string;
  usernameIv: string;
  usernameTag: string;
  passwordCiphertext: string;
  passwordIv: string;
  passwordTag: string;
  encryptedDataKey: string;
  dataKeyIv: string;
  dataKeyTag: string;
  keyVersion: number;
}

/** The master keys by version. New logins are sealed with the current one. */
export class MasterKeyRing {
  constructor(
    readonly currentVersion: number,
    private readonly keys: ReadonlyMap<number, Buffer>,
  ) {}

  key(version: number): Buffer {
    const found = this.keys.get(version);
    if (!found) {
      throw new Error('unknown key version');
    }
    return found;
  }
}

/** Reads MASTER_KEYS, written as `version:base64key,version:base64key`. */
export function parseMasterKeyRing(
  serialized: string,
  currentVersion: number,
): MasterKeyRing {
  const keys = new Map<number, Buffer>();
  for (const part of serialized.split(',')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      throw new Error('invalid master key ring');
    }
    const version = Number(trimmed.slice(0, separator));
    const raw = Buffer.from(trimmed.slice(separator + 1), 'base64');
    if (!Number.isInteger(version) || version < 1 || raw.length !== KEY_BYTES) {
      throw new Error('invalid master key ring');
    }
    keys.set(version, raw);
  }
  if (!keys.has(currentVersion)) {
    throw new Error('invalid master key ring');
  }
  return new MasterKeyRing(currentVersion, keys);
}

export function sealCredentials(
  username: string,
  password: string,
  ring: MasterKeyRing,
): SealedCredentials {
  const dataKey = randomBytes(KEY_BYTES);
  const usernameSealed = encrypt(username, dataKey);
  const passwordSealed = encrypt(password, dataKey);
  const wrapped = encrypt(dataKey.toString('base64url'), ring.key(ring.currentVersion));
  return {
    usernameCiphertext: usernameSealed.ciphertext,
    usernameIv: usernameSealed.iv,
    usernameTag: usernameSealed.tag,
    passwordCiphertext: passwordSealed.ciphertext,
    passwordIv: passwordSealed.iv,
    passwordTag: passwordSealed.tag,
    encryptedDataKey: wrapped.ciphertext,
    dataKeyIv: wrapped.iv,
    dataKeyTag: wrapped.tag,
    keyVersion: ring.currentVersion,
  };
}

export function openCredentials(
  sealed: SealedCredentials,
  ring: MasterKeyRing,
): { username: string; password: string } {
  const dataKey = Buffer.from(
    decrypt(
      sealed.encryptedDataKey,
      sealed.dataKeyIv,
      sealed.dataKeyTag,
      ring.key(sealed.keyVersion),
    ),
    'base64url',
  );
  return {
    username: decrypt(
      sealed.usernameCiphertext,
      sealed.usernameIv,
      sealed.usernameTag,
      dataKey,
    ),
    password: decrypt(
      sealed.passwordCiphertext,
      sealed.passwordIv,
      sealed.passwordTag,
      dataKey,
    ),
  };
}

/**
 * Re-wraps the data key with the current master key, leaving the username and password
 * ciphertext as it is. For rotating master keys; the job that would run it over every
 * connection is not built yet, so only its tests call it today.
 */
export function rewrapCredentials(
  sealed: SealedCredentials,
  ring: MasterKeyRing,
): SealedCredentials {
  const dataKey = decrypt(
    sealed.encryptedDataKey,
    sealed.dataKeyIv,
    sealed.dataKeyTag,
    ring.key(sealed.keyVersion),
  );
  const wrapped = encrypt(dataKey, ring.key(ring.currentVersion));
  return {
    ...sealed,
    encryptedDataKey: wrapped.ciphertext,
    dataKeyIv: wrapped.iv,
    dataKeyTag: wrapped.tag,
    keyVersion: ring.currentVersion,
  };
}

function encrypt(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

function decrypt(ciphertext: string, iv: string, tag: string, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
