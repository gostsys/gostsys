const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ subscriptions: [] }, null, 2),
      'utf8'
    );
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.subscriptions)) {
      return { subscriptions: [] };
    }
    return data;
  } catch (error) {
    return { subscriptions: [] };
  }
}

function saveData(data) {
  ensureDataFile();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ Failed to save data file:', error.message);
    throw error;
  }
}

module.exports = {
  ensureDataFile,
  loadData,
  saveData,
  DATA_FILE,
};
