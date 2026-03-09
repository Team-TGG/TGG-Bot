import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WARNINGS_FILE = path.join(__dirname, '..', 'warnings.json');

// cria arquivo se não existir
function initWarningsFile() {
  if (!fs.existsSync(WARNINGS_FILE)) {
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify({}, null, 2));
  }
}

// lê avisos do arquivo
function readWarnings() {
  initWarningsFile();
  try {
    const data = fs.readFileSync(WARNINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading warnings file:', error);
    return {};
  }
}

// salva avisos no arquivo
function writeWarnings(warnings) {
  try {
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2));
  } catch (error) {
    console.error('Error writing warnings file:', error);
  }
}

export function addWarning(userId, moderatorId, reason) {
  const warnings = readWarnings();
  
  if (!warnings[userId]) {
    warnings[userId] = {
      count: 0,
      warnings: []
    };
  }
  
  warnings[userId].count++;
  warnings[userId].warnings.push({
    id: warnings[userId].count,
    moderator_id: moderatorId,
    reason: reason,
    timestamp: new Date().toISOString()
  });
  
  writeWarnings(warnings);
  return warnings[userId].count;
}

export function getWarningCount(userId) {
  const warnings = readWarnings();
  return warnings[userId]?.count || 0;
}

export function getUserWarnings(userId) {
  const warnings = readWarnings();
  return warnings[userId]?.warnings || [];
}

export function clearWarnings(userId) {
  const warnings = readWarnings();
  delete warnings[userId];
  writeWarnings(warnings);
}

// converte string de tempo (1s, 1m, 1h, 1d, 1M, 1y)
export function parseTime(timeString) {
  const match = timeString.match(/^(\d+)([smhdMy])$/);
  if (!match) return null;
  
  const [, amount, unit] = match;
  const num = parseInt(amount);
  
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    case 'M': return num * 30 * 24 * 60 * 60 * 1000;
    case 'y': return num * 365 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// formata duracao para exibição
export function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years} ano(s)`;
  if (months > 0) return `${months} mês(es)`;
  if (days > 0) return `${days} dia(s)`;
  if (hours > 0) return `${hours} hora(s)`;
  if (minutes > 0) return `${minutes} minuto(s)`;
  return `${seconds} segundo(s)`;
}
