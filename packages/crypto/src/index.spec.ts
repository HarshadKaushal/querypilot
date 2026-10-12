import {
  openCredentials,
  parseMasterKeyRing,
  rewrapCredentials,
  sealCredentials,
  type MasterKeyRing,
} from './index';

const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

function ring(): MasterKeyRing {
  return parseMasterKeyRing(`1:${KEY_V1},2:${KEY_V2}`, 1);
}

describe('envelope encryption', () => {
  it('round-trips a username and password', () => {
    const sealed = sealCredentials('sample_ro', 'sample_ro_password', ring());
    expect(sealed.passwordCiphertext).not.toContain('sample_ro_password');
    expect(openCredentials(sealed, ring())).toEqual({
      username: 'sample_ro',
      password: 'sample_ro_password',
    });
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = sealCredentials('sample_ro', 'sample_ro_password', ring());
    const flipped = sealed.passwordCiphertext.startsWith('A')
      ? `B${sealed.passwordCiphertext.slice(1)}`
      : `A${sealed.passwordCiphertext.slice(1)}`;
    const tampered = { ...sealed, passwordCiphertext: flipped };
    expect(() => openCredentials(tampered, ring())).toThrow();
  });

  it('rewraps onto the current key version without changing the password ciphertext', () => {
    const sealed = sealCredentials('sample_ro', 'secret-value', ring());
    const current = parseMasterKeyRing(`1:${KEY_V1},2:${KEY_V2}`, 2);
    const rotated = rewrapCredentials(sealed, current);
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.passwordCiphertext).toBe(sealed.passwordCiphertext);
    expect(openCredentials(rotated, current).password).toBe('secret-value');
    const onlyV1 = parseMasterKeyRing(`1:${KEY_V1}`, 1);
    expect(() => openCredentials(rotated, onlyV1)).toThrow();
  });

  it('rejects a key ring without echoing the key material', () => {
    expect(() => parseMasterKeyRing(`1:${KEY_V1}`, 2)).toThrow('invalid master key ring');
  });
});
