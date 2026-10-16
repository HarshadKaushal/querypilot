// Per user, per UTC day: questions, rows, and model tokens (blueprint 7). Kept apart from
// history, so deleting history does not erase usage.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const count = { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 };
    await queryInterface.createTable('usage_counters', {
      user_id: {
        type: Sequelize.TEXT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      day: { type: Sequelize.DATEONLY, allowNull: false, primaryKey: true },
      questions: count,
      rows_returned: count,
      input_tokens: count,
      output_tokens: count,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('usage_counters');
  },
};
