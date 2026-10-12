import { errorEnvelope } from './errors';

describe('errorEnvelope', () => {
  it('builds a stable envelope', () => {
    expect(
      errorEnvelope('NOT_FOUND', 'That resource was not found.', 'req-12345678'),
    ).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'That resource was not found.',
        requestId: 'req-12345678',
      },
    });
  });
});
