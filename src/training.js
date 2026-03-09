import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINING_FILE = path.join(__dirname, '..', 'training_points.json');

// cria arquivo se não existir
function initTrainingFile() {
  if (!fs.existsSync(TRAINING_FILE)) {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify({
      categories: {},
      instructor_points: {},
      training_history: []
    }, null, 2));
  }
}

// lê dados de treino
function readTrainingData() {
  initTrainingFile();
  try {
    const data = fs.readFileSync(TRAINING_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading training file:', error);
    return { categories: {}, instructor_points: {}, training_history: [] };
  }
}

// escreve dados de treino
function writeTrainingData(data) {
  try {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing training file:', error);
  }
}

export function addTrainingPoints(instructorId, category, points) {
  const data = readTrainingData();
  
  if (!data.instructor_points[instructorId]) {
    data.instructor_points[instructorId] = {};
  }
  
  if (!data.instructor_points[instructorId][category]) {
    data.instructor_points[instructorId][category] = 0;
  }
  
  data.instructor_points[instructorId][category] += points;
  
  data.training_history.push({
    instructor_id: instructorId,
    category: category,
    points: points,
    timestamp: new Date().toISOString(),
    type: 'add'
  });
  
  writeTrainingData(data);
  return data.instructor_points[instructorId][category];
}

export function getInstructorPoints(instructorId) {
  const data = readTrainingData();
  return data.instructor_points[instructorId] || {};
}

export function getInstructorHistory(instructorId) {
  const data = readTrainingData();
  return data.training_history.filter(entry => entry.instructor_id === instructorId);
}

// categorias de treino e pontos
export const TRAINING_CATEGORIES = {
  'teamcombo': { name: 'Team Combo', points: 5, description: 'Ensinar team combos' },
  'movimentacao': { name: 'Movimentação', points: 3, description: 'Ensinar movimentação básica' },
  'combos': { name: 'Combos de Armas', points: 5, description: 'Ensinar combos de armas e noções gerais' }
};

export function getTrainingCategories() {
  return Object.entries(TRAINING_CATEGORIES).map(([key, value]) => ({
    id: key,
    ...value
  }));
}

export function calculateTotalPoints(instructorId) {
  const points = getInstructorPoints(instructorId);
  return Object.entries(points).reduce((total, [category, amount]) => {
    const categoryInfo = TRAINING_CATEGORIES[category];
    return total + (amount * (categoryInfo?.points || 0));
  }, 0);
}

export function getInstructorLeaderboard() {
  const data = readTrainingData();
  const leaderboard = Object.entries(data.instructor_points).map(([instructorId, categories]) => {
    const totalPoints = Object.entries(categories).reduce((total, [category, amount]) => {
      const categoryInfo = TRAINING_CATEGORIES[category];
      return total + (amount * (categoryInfo?.points || 0));
    }, 0);
    
    return {
      instructor_id: instructorId,
      total_points: totalPoints,
      categories: categories
    };
  }).sort((a, b) => b.total_points - a.total_points);
  
  return leaderboard.slice(0, 10);
}
