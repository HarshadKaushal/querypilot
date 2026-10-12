import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('keeps a safe incoming id', () => {
    expect(resolveRequestId('abc-1234')).toBe('abc-1234');
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['trace-0001', 'other-0002'])).toBe('trace-0001');
  });

  it('replaces missing, short, or unsafe ids', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(resolveRequestId('short')).not.toBe('short');
    expect(resolveRequestId('bad id!!')).not.toBe('bad id!!');
  });
});
