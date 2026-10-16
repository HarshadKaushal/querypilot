// sequelize-cli settings, picked by NODE_ENV (development when unset). Every environment
// reads the same DATABASE_URL; the app builds its own instance in src/create-sequelize.ts.
const settings = {
  use_env_variable: 'DATABASE_URL',
  dialect: 'postgres',
  logging: false,
};

module.exports = {
  development: settings,
  test: settings,
  production: settings,
};
