// Validated SQL proposals, so a repeated question skips the model (blueprint 7).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = Sequelize.literal('CURRENT_TIMESTAMP');
      await queryInterface.createTable(
        'query_cache',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          connection_id: {
            type: Sequelize.TEXT,
            allowNull: false,
            references: { model: 'connections', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          fingerprint: { type: Sequelize.TEXT, allowNull: false },
          question_hash: { type: Sequelize.TEXT, allowNull: false },
          sql: { type: Sequelize.TEXT, allowNull: false },
          assumptions: { type: Sequelize.JSONB, allowNull: false },
          explanation: { type: Sequelize.TEXT, allowNull: false },
          model: { type: Sequelize.TEXT, allowNull: false },
          hits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: 'TIMESTAMP(3)', allowNull: false, defaultValue: now },
          last_used_at: { type: 'TIMESTAMP(3)', allowNull: false, defaultValue: now },
        },
        { transaction },
      );

      await queryInterface.addIndex(
        'query_cache',
        ['connection_id', 'fingerprint', 'question_hash'],
        {
          name: 'query_cache_connection_id_fingerprint_question_hash_key',
          unique: true,
          transaction,
        },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('query_cache');
  },
};
