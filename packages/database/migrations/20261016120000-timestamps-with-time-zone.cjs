// Changes every TIMESTAMP(3) column to TIMESTAMPTZ(3).
//
// Why: Prisma treated TIMESTAMP (no time zone) as UTC. Sequelize reads only TIMESTAMPTZ
// itself; a TIMESTAMP value falls through to the pg driver, which reads it as the server's
// local time, so on a machine in India every time would move by 5 h 30 min (token expiry
// included). The stored values were written as UTC, so `AT TIME ZONE 'UTC'` keeps each
// instant exactly as it was.

const COLUMNS = {
  users: ['created_at', 'last_login_at'],
  refresh_tokens: ['expires_at', 'revoked_at', 'created_at'],
  audit_log: ['created_at'],
  connections: ['last_tested_at', 'created_at', 'updated_at'],
  schema_snapshots: ['created_at'],
  allowed_objects: ['created_at'],
  query_cache: ['created_at', 'last_used_at'],
  queries: ['created_at', 'finished_at'],
};

/** One ALTER TABLE per table, so each table is rewritten once. */
async function convert(queryInterface, type) {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const changes = columns
        .map(
          (column) =>
            `ALTER COLUMN "${column}" TYPE ${type} USING "${column}" AT TIME ZONE 'UTC'`,
        )
        .join(', ');
      await queryInterface.sequelize.query(`ALTER TABLE "${table}" ${changes}`, {
        transaction,
      });
    }
  });
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await convert(queryInterface, 'TIMESTAMPTZ(3)');
  },

  async down(queryInterface) {
    await convert(queryInterface, 'TIMESTAMP(3)');
  },
};
