import { safeErrorDetail } from './safe-error';

describe('safeErrorDetail', () => {
  it('strips database URLs from logged messages', () => {
    const detail = safeErrorDetail(
      new Error('connect failed postgresql://ayd:secret@app-db:5432/ayd'),
    );
    expect(detail.message).not.toContain('secret');
    expect(detail.message).toContain('[redacted-url]');
  });
});
