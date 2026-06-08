require('dotenv').config();

module.exports = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 300000),
};
