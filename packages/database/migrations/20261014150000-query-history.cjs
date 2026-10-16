// One row per finished question or SQL job, for the owner's history (blueprint 7 and 8.4).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const count = { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 };
      await queryInterface.createTable(
        'queries',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          user_id: {
            type: Sequelize.TEXT,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          connection_id: {
            type: Sequelize.TEXT,
            allowNull: false,
            references: { model: 'connections', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          kind: { type: Sequelize.TEXT, allowNull: false },
          question: { type: Sequelize.TEXT },
          sql: { type: Sequelize.TEXT },
          status: { type: Sequelize.TEXT, allowNull: false },
          error_code: { type: Sequelize.TEXT },
          row_count: { type: Sequelize.INTEGER },
          truncated: { type: Sequelize.TEXT },
          schema_version: { type: Sequelize.INTEGER },
          cached: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          summary: { type: Sequelize.TEXT },
          models: { type: Sequelize.JSONB, allowNull: false },
          input_tokens: count,
          output_tokens: count,
          llm_ms: count,
          query_ms: count,
          total_ms: count,
          created_at: { type: 'TIMESTAMP(3)', allowNull: false },
          finished_at: {
            type: 'TIMESTAMP(3)',
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
        },
        { transaction },
      );

      // History pages are read newest first, by (created_at, id) as a keyset cursor.
      await queryInterface.addIndex(
        'queries',
        ['user_id', { name: 'created_at', order: 'DESC' }, { name: 'id', order: 'DESC' }],
        { name: 'queries_user_id_created_at_id_idx', transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('queries');
  },
};
