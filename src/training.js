import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINING_FILE = path.join(__dirname, '..', 'training_points.json');

// Initialize training points file if it doesn't exist
function initTrainingFile() {
  if (!fs.existsSync(TRAINING_FILE)) {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify({
      categories: {},
      instructor_points: {},
      training_history: []
    }, null, 2));
  }
}

// Read training data from JSON file
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

// Write training data to JSON file
function writeTrainingData(data) {
  try {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing training file:', error);
  }
}

// Add points to instructor for a specific category
export function addTrainingPoints(instructorId, category, points) {
  const data = readTrainingData();
  
  if (!data.instructor_points[instructorId]) {
    data.instructor_points[instructorId] = {};
  }
  
  if (!data.instructor_points[instructorId][category]) {
    data.instructor_points[instructorId][category] = 0;
  }
  
  data.instructor_points[instructorId][category] += points;
  
  // Add to training history
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

// Get instructor's points for all categories
export function getInstructorPoints(instructorId) {
  const data = readTrainingData();
  return data.instructor_points[instructorId] || {};
}

// Get instructor's training history
export function getInstructorHistory(instructorId) {
  const data = readTrainingData();
  return data.training_history.filter(entry => entry.instructor_id === instructorId);
}

// Define training categories with their point values
export const TRAINING_CATEGORIES = {
  'teamcombo': { name: 'Team Combo', points: 5, description: 'Ensinar team combos' },
  'movimentacao': { name: 'Movimentação', points: 3, description: 'Ensinar movimentação básica' },
  'combos': { name: 'Combos de Armas', points: 5, description: 'Ensinar combos de armas e noções gerais' }
};

// Get all available categories
export function getTrainingCategories() {
  return Object.entries(TRAINING_CATEGORIES).map(([key, value]) => ({
    id: key,
    ...value
  }));
}

// Calculate total points for an instructor
export function calculateTotalPoints(instructorId) {
  const points = getInstructorPoints(instructorId);
  return Object.entries(points).reduce((total, [category, amount]) => {
    const categoryInfo = TRAINING_CATEGORIES[category];
    return total + (amount * (categoryInfo?.points || 0));
  }, 0);
}

// Get instructor leaderboard
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
  
  return leaderboard.slice(0, 10); // Top 10
}
