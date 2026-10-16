// Schema snapshots and the allowlist of tables and columns the model may see (Phase 3,
// ADR 0008).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const connectionId = {
        type: Sequelize.TEXT,
        allowNull: false,
        references: { model: 'connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      };
      const createdAt = {
        type: 'TIMESTAMP(3)',
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      };

      await queryInterface.createTable(
        'schema_snapshots',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          connection_id: connectionId,
          version: { type: Sequelize.INTEGER, allowNull: false },
          document: { type: Sequelize.JSONB, allowNull: false },
          table_count: { type: Sequelize.INTEGER, allowNull: false },
          column_count: { type: Sequelize.INTEGER, allowNull: false },
          created_at: createdAt,
        },
        { transaction },
      );

      await queryInterface.createTable(
        'allowed_objects',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          connection_id: connectionId,
          schema_name: { type: Sequelize.TEXT, allowNull: false },
          table_name: { type: Sequelize.TEXT, allowNull: false },
          // Null means the whole table.
          column_name: { type: Sequelize.TEXT },
          description: { type: Sequelize.TEXT },
          created_at: createdAt,
        },
        { transaction },
      );

      // Two refreshes can never write the same version of one connection's schema.
      await queryInterface.addIndex('schema_snapshots', ['connection_id', 'version'], {
        name: 'schema_snapshots_connection_id_version_key',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('allowed_objects', ['connection_id'], {
        name: 'allowed_objects_connection_id_idx',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('allowed_objects', { transaction });
      await queryInterface.dropTable('schema_snapshots', { transaction });
    });
  },
};
