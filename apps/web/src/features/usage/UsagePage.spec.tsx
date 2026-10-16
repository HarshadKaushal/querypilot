import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UsageToday } from '../../lib/api-types';
import { fakeApi, renderWithApp } from '../../test/render';
import { UsagePage } from './UsagePage';

const TODAY: UsageToday = {
  day: '2026-10-14',
  plan: 'free',
  questions: { used: 12, limit: 50 },
  submissionsPerMinute: 10,
  finishedQuestions: 11,
  rowsReturned: 340,
  tokens: { input: 9000, output: 600 },
};

describe('UsagePage', () => {
  it("shows today's questions against the limit, and the totals", async () => {
    renderWithApp(<UsagePage />, {
      api: fakeApi({ get: vi.fn().mockResolvedValue(TODAY) }),
    });
    expect(await screen.findByText('12 of 50')).toBeInTheDocument();
    expect(screen.getByText(/38 left today/)).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('9,600')).toBeInTheDocument();
    expect(
      screen.getByText(/up to 10 questions, queries, or re-runs a minute/),
    ).toBeInTheDocument();
  });

  it('says when the daily limit is reached', async () => {
    renderWithApp(<UsagePage />, {
      api: fakeApi({
        get: vi.fn().mockResolvedValue({ ...TODAY, questions: { used: 50, limit: 50 } }),
      }),
    });
    expect(await screen.findByText(/The daily limit is reached/)).toBeInTheDocument();
  });
});
