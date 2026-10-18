import type { CachedProposal, ProposalCache } from '../ask/proposal-cache.repository';

/** In-memory ProposalCache for unit tests, with the same rules as the Sequelize one. */
export class MemoryProposalCache implements ProposalCache {
  readonly entries = new Map<
    string,
    CachedProposal & { connectionId: string; fingerprint: string; hits: number }
  >();

  async find(connectionId: string, fingerprint: string, questionKey: string) {
    const entry = this.entries.get(key(connectionId, fingerprint, questionKey));
    if (!entry) {
      return null;
    }
    entry.hits += 1;
    const { sql, assumptions, explanation, model } = entry;
    return { sql, assumptions, explanation, model };
  }

  async save(
    connectionId: string,
    fingerprint: string,
    questionKey: string,
    proposal: CachedProposal,
  ) {
    for (const [name, entry] of this.entries) {
      if (entry.connectionId === connectionId && entry.fingerprint !== fingerprint) {
        this.entries.delete(name);
      }
    }
    this.entries.set(key(connectionId, fingerprint, questionKey), {
      ...proposal,
      connectionId,
      fingerprint,
      hits: 0,
    });
  }

  async forget(connectionId: string, fingerprint: string, questionKey: string) {
    this.entries.delete(key(connectionId, fingerprint, questionKey));
  }
}

function key(connectionId: string, fingerprint: string, questionKey: string): string {
  return `${connectionId}|${fingerprint}|${questionKey}`;
}
