// Saved connections to customer databases, with the login sealed (Phase 2, ADR 0007).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const text = { type: Sequelize.TEXT, allowNull: false };
      await queryInterface.createTable(
        'connections',
        {
          id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
          user_id: {
            type: Sequelize.TEXT,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          label: text,
          host: text,
          port: { type: Sequelize.INTEGER, allowNull: false },
          database_name: text,
          ssl_mode: text,
          username_ciphertext: text,
          username_iv: text,
          username_tag: text,
          password_ciphertext: text,
          password_iv: text,
          password_tag: text,
          encrypted_data_key: text,
          data_key_iv: text,
          data_key_tag: text,
          key_version: { type: Sequelize.INTEGER, allowNull: false },
          status: text,
          last_tested_at: { type: 'TIMESTAMP(3)' },
          send_sample_rows_to_llm: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          created_at: {
            type: 'TIMESTAMP(3)',
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          },
          // No default: the application sets it on every write.
          updated_at: { type: 'TIMESTAMP(3)', allowNull: false },
        },
        { transaction },
      );

      await queryInterface.addIndex('connections', ['user_id'], {
        name: 'connections_user_id_idx',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('connections');
  },
};
