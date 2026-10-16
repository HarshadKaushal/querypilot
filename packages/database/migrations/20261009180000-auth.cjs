// Users, refresh tokens, and the audit log (Phase 1).
//
// Migrations 20261009180000 to 20261014170000 reproduce the tables Prisma created, with the
// same column types and constraint and index names, so a database Prisma migrated and one
// these files migrated are the same. TIMESTAMP(3) has no time zone; migration 20261016120000
// changes every such column to TIMESTAMPTZ(3).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'users',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          google_subject: { type: Sequelize.TEXT, allowNull: false },
          email: { type: Sequelize.TEXT, allowNull: false },
          name: { type: Sequelize.TEXT, allowNull: false },
          avatar_url: { type: Sequelize.TEXT },
          plan_tier: { type: Sequelize.TEXT, allowNull: false, defaultValue: 'free' },
          created_at: {
            type: 'TIMESTAMP(3)',
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
          last_login_at: { type: 'TIMESTAMP(3)', allowNull: false },
        },
        { transaction },
      );

      await queryInterface.createTable(
        'refresh_tokens',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          user_id: {
            type: Sequelize.TEXT,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          family_id: { type: Sequelize.TEXT, allowNull: false },
          token_hash: { type: Sequelize.TEXT, allowNull: false },
          expires_at: { type: 'TIMESTAMP(3)', allowNull: false },
          revoked_at: { type: 'TIMESTAMP(3)' },
          replaced_by_id: { type: Sequelize.TEXT },
          device_info: { type: Sequelize.TEXT },
          created_at: {
            type: 'TIMESTAMP(3)',
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
        },
        { transaction },
      );

      await queryInterface.createTable(
        'audit_log',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          // The row outlives its user: deleting the account clears user_id.
          user_id: {
            type: Sequelize.TEXT,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          event_type: { type: Sequelize.TEXT, allowNull: false },
          metadata: { type: Sequelize.JSONB, allowNull: false },
          ip: { type: Sequelize.TEXT },
          created_at: {
            type: 'TIMESTAMP(3)',
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('users', ['google_subject'], {
        name: 'users_google_subject_key',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('refresh_tokens', ['token_hash'], {
        name: 'refresh_tokens_token_hash_key',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('refresh_tokens', ['user_id'], {
        name: 'refresh_tokens_user_id_idx',
        transaction,
      });
      await queryInterface.addIndex('refresh_tokens', ['family_id'], {
        name: 'refresh_tokens_family_id_idx',
        transaction,
      });
      await queryInterface.addIndex('audit_log', ['user_id', 'created_at'], {
        name: 'audit_log_user_id_created_at_idx',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('audit_log', { transaction });
      await queryInterface.dropTable('refresh_tokens', { transaction });
      await queryInterface.dropTable('users', { transaction });
    });
  },
};
