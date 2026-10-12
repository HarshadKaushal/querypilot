import { assessResolution } from './index';

const blocked: Array<[string, string[], string]> = [
  ['localhost', ['127.0.0.1'], 'blocked_host'],
  ['metadata.google.internal', ['169.254.169.254'], 'blocked_host'],
  ['db.example.internal', ['1.1.1.1'], 'blocked_host'],
  ['printer.local', ['192.168.1.20'], 'blocked_host'],
  ['db.example', [], 'empty'],
  ['db.example', ['169.254.169.254'], 'metadata'],
  ['db.example', ['169.254.170.2'], 'metadata'],
  ['db.example', ['0.0.0.0'], 'unspecified'],
  ['db.example', ['::'], 'unspecified'],
  ['db.example', ['169.254.1.1'], 'link_local'],
  ['db.example', ['fe80::1'], 'link_local'],
  ['db.example', ['127.0.0.1'], 'loopback'],
  ['db.example', ['127.0.0.2'], 'loopback'],
  ['db.example', ['::1'], 'loopback'],
  ['db.example', ['::ffff:127.0.0.1'], 'loopback'],
  ['db.example', ['10.1.2.3'], 'private'],
  ['db.example', ['172.16.0.5'], 'private'],
  ['db.example', ['192.168.1.9'], 'private'],
  ['db.example', ['fd00::1'], 'private'],
  ['db.example', ['1.1.1.1', '10.0.0.2'], 'private'],
  ['db.example', ['not-an-ip'], 'invalid'],
];

describe('assessResolution', () => {
  it.each(blocked)('rejects %s via %j as %s', (hostname, addresses, reason) => {
    expect(assessResolution(hostname, addresses)).toEqual({ ok: false, reason });
  });

  it('pins the first public address when every answer is public', () => {
    expect(assessResolution('db.example', ['1.1.1.1', '8.8.8.8'])).toEqual({
      ok: true,
      pinnedAddress: '1.1.1.1',
    });
  });

  it('still rejects metadata when private addresses are allowed', () => {
    expect(
      assessResolution('db.example', ['169.254.169.254'], { allowPrivate: true }),
    ).toEqual({ ok: false, reason: 'metadata' });
    expect(assessResolution('db.example', ['fe80::1'], { allowPrivate: true })).toEqual({
      ok: false,
      reason: 'link_local',
    });
  });

  it('allows the localhost name only when private addresses are allowed', () => {
    expect(assessResolution('localhost', ['127.0.0.1'], { allowPrivate: true })).toEqual({
      ok: true,
      pinnedAddress: '127.0.0.1',
    });
    expect(
      assessResolution('metadata.google.internal', ['1.1.1.1'], { allowPrivate: true }),
    ).toEqual({
      ok: false,
      reason: 'blocked_host',
    });
  });

  it('allows loopback and RFC1918 only when private addresses are allowed', () => {
    expect(assessResolution('db.example', ['127.0.0.1'], { allowPrivate: true })).toEqual(
      {
        ok: true,
        pinnedAddress: '127.0.0.1',
      },
    );
    expect(assessResolution('db.example', ['10.0.0.8'], { allowPrivate: true })).toEqual({
      ok: true,
      pinnedAddress: '10.0.0.8',
    });
  });
});
