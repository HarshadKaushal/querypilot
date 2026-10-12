import { isIP, BlockList } from 'node:net';

export type SsrfReason =
  | 'blocked_host'
  | 'empty'
  | 'metadata'
  | 'unspecified'
  | 'link_local'
  | 'loopback'
  | 'private'
  | 'invalid';

export interface SsrfOptions {
  allowPrivate?: boolean;
}

export type SsrfVerdict =
  { ok: true; pinnedAddress: string } | { ok: false; reason: SsrfReason };

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

const metadata = new BlockList();
metadata.addAddress('169.254.169.254', 'ipv4');
metadata.addAddress('169.254.170.2', 'ipv4');
metadata.addAddress('100.100.100.200', 'ipv4');
metadata.addAddress('fd00:ec2::254', 'ipv6');

const linkLocal = new BlockList();
linkLocal.addSubnet('169.254.0.0', 16, 'ipv4');
linkLocal.addSubnet('fe80::', 10, 'ipv6');

const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

const unspecified = new BlockList();
unspecified.addAddress('0.0.0.0', 'ipv4');
unspecified.addAddress('::', 'ipv6');
unspecified.addSubnet('0.0.0.0', 8, 'ipv4');

const privateRanges = new BlockList();
privateRanges.addSubnet('10.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('172.16.0.0', 12, 'ipv4');
privateRanges.addSubnet('192.168.0.0', 16, 'ipv4');
privateRanges.addSubnet('fc00::', 7, 'ipv6');

export function assessResolution(
  hostname: string,
  addresses: readonly string[],
  options: SsrfOptions = {},
): SsrfVerdict {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  const localName = normalized === 'localhost' || normalized === 'localhost.localdomain';
  if (
    normalized.length === 0 ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    (BLOCKED_HOSTS.has(normalized) && !(options.allowPrivate && localName))
  ) {
    return { ok: false, reason: 'blocked_host' };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  for (const address of addresses) {
    const reason = classify(address, options);
    if (reason) {
      return { ok: false, reason };
    }
  }
  return { ok: true, pinnedAddress: addresses[0] };
}

function classify(address: string, options: SsrfOptions): SsrfReason | null {
  const ip = unwrapMapped(address.trim());
  if (isIP(ip) === 0) {
    return 'invalid';
  }
  if (inList(metadata, ip)) {
    return 'metadata';
  }
  if (inList(unspecified, ip)) {
    return 'unspecified';
  }
  if (inList(linkLocal, ip)) {
    return 'link_local';
  }
  if (inList(loopback, ip)) {
    return options.allowPrivate ? null : 'loopback';
  }
  if (inList(privateRanges, ip)) {
    return options.allowPrivate ? null : 'private';
  }
  return null;
}

function inList(list: BlockList, address: string): boolean {
  const version = isIP(address);
  if (version === 0) {
    return false;
  }
  return list.check(address, version === 6 ? 'ipv6' : 'ipv4');
}

function unwrapMapped(address: string): string {
  const lower = address.toLowerCase();
  const prefix = '::ffff:';
  if (lower.startsWith(prefix)) {
    const embedded = lower.slice(prefix.length);
    if (isIP(embedded) === 4) {
      return embedded;
    }
  }
  return address;
}
