import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINING_FILE = path.join(__dirname, '..', 'training_system.json');

function initTrainingFile() {
  if (!fs.existsSync(TRAINING_FILE)) {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify({
      score_types: {
        teamcombo: { name: 'Team Combo', base_points: 5, multiplier: 1.0 },
        movimentacao: { name: 'Movimentação', base_points: 3, multiplier: 1.0 },
        combos: { name: 'Combos de Armas', base_points: 5, multiplier: 1.0 },
        positioning: { name: 'Posicionamento', base_points: 2, multiplier: 1.0 },
        reading: { name: 'Leitura de Jogo', base_points: 1, multiplier: 1.0 },
        strategy: { name: 'Estratégia', base_points: 3, multiplier: 1.5 },
        advanced: { name: 'Técnica Avançada', base_points: 4, multiplier: 2.0 }
      },
      instructor_scores: {},
      student_scores: {},
      instructor_role_points: {},
      role_holder_sessions: [],
      training_sessions: [],
      leaderboards: {
        instructors: [],
        students: []
      },
      shop_items: [
        { id: 'instrutor_destaque', category: 'Cosmética', name: 'Instrutor Destaque (30 dias)', description: 'Cargo exclusivo temporário', cost: 30, type: 'role_temp', duration_days: 30, role_id: 'YOUR_DISCORD_ROLE_ID' },
        { id: 'cor_diferenciada', category: 'Cosmética', name: 'Cor diferenciada no Discord', description: 'Cor exclusiva no nome', cost: 15, type: 'custom_color' },
        { id: 'post_elogio', category: 'Cosmética', name: 'Post fixado elogiando instrutor', description: 'Destaque público no servidor', cost: 30, type: 'public_praise' },
        { id: 'card_postal', category: 'Cosmética', name: 'Card cartão postal do instrutor', description: 'Imagem editada com suas preferências', cost: 30, type: 'custom_image' },
        { id: 'banner_pfp', category: 'Cosmética', name: 'Banner e PFP customizados', description: 'Feitas sob medidas com o Editor oficial', cost: 100, type: 'custom_art' },
        { id: 'aluno_destaque', category: 'Cosmética', name: 'Aluno Destaque', description: 'Mostre pro seu aluno como você se importa com ele com um cargo customizado por você', cost: 10, type: 'student_highlight', role_id: 'YOUR_DISCORD_ROLE_ID' },
        { id: 'multiplicador_pontos', category: 'Funcional', name: 'Multiplicador de pontos', description: 'Multiplicador (uso único)', cost: 15, type: 'point_multiplier', multiplier_value: 1.5, duration_sessions: 1 },
        { id: 'ticket_premium', category: 'Funcional', name: 'Ticket Premium', description: 'Ticket vale x1,5 pontos', cost: 10, type: 'ticket_bonus', bonus_multiplier: 1.5 },
        { id: 'aluno_prioritario', category: 'Funcional', name: 'Aluno prioritário', description: 'Acompanhar aluno específico com bônus', cost: 15, type: 'priority_student' },
        { id: 'acesso_antecipado', category: 'Status', name: 'Acesso antecipado a cargos', description: 'Elegível a promoção antes (25% OFF)', cost: 50, type: 'early_access_promo', discount_percentage: 25 },
        { id: 'voto_consultivo', category: 'Status', name: 'Voto consultivo', description: 'Participa de decisões do sistema', cost: 30, type: 'consultative_vote' },
        { id: 'instrutor_mentor', category: 'Status', name: 'Instrutor Mentor', description: 'Supervisiona outros instrutores, ganha em cima de ', cost: 0, type: 'mentor_role' }
      ]
    }, null, 2));
  }
}

function readTrainingData() {
  initTrainingFile();
  try {
    const data = fs.readFileSync(TRAINING_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading training system file:', error);
    return {
      score_types: {},
      instructor_scores: {},
      student_scores: {},
      training_sessions: [],
      leaderboards: { instructors: [], students: [] }
    };
  }
}

function writeTrainingData(data) {
  try {
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing training system file:', error);
  }
}

export function getScoreTypes() {
  const data = readTrainingData();
  return data.score_types;
}

export function addTrainingSession(instructorId, studentId, type, duration, points, notes = '', status = 'complete') {
  const data = readTrainingData();
  
  const session = {
    id: Date.now().toString(),
    instructor_id: instructorId,
    student_id: studentId,
    type: type,
    duration: duration,
    points: points,
    notes: notes,
    status: status,
    timestamp: new Date().toISOString()
  };
  
  data.training_sessions.push(session);
  
  // Update scores
  if (status === 'complete') {
    if (!data.student_scores[studentId]) {
      data.student_scores[studentId] = {};
    }
    if (!data.student_scores[studentId][type]) {
      data.student_scores[studentId][type] = 0;
    }
    data.student_scores[studentId][type] += points;
    
    if (!data.instructor_scores[instructorId]) {
      data.instructor_scores[instructorId] = {};
    }
    if (!data.instructor_scores[instructorId][type]) {
      data.instructor_scores[instructorId][type] = 0;
    }
    data.instructor_scores[instructorId][type] += points;
  }
  // Update leaderboards
  updateLeaderboards(data);
  
  writeTrainingData(data);
  return session;
}

export function addRoleHolderPoints(instructorId, points, type = 'general') {
  const data = readTrainingData();
  
  if (!data.instructor_role_points) {
    data.instructor_role_points = {};
  }
  
  if (!data.instructor_role_points[instructorId]) {
    data.instructor_role_points[instructorId] = {
      total_points: 0,
      sessions_completed: 0,
      types_completed: {},
      last_activity: null
    };
  }
  
  data.instructor_role_points[instructorId].total_points += points;
  data.instructor_role_points[instructorId].sessions_completed += 1;
  data.instructor_role_points[instructorId].last_activity = new Date().toISOString();
  
  if (!data.instructor_role_points[instructorId].types_completed[type]) {
    data.instructor_role_points[instructorId].types_completed[type] = 0;
  }
  data.instructor_role_points[instructorId].types_completed[type] += 1;
  
  writeTrainingData(data);
  return data.instructor_role_points[instructorId];
}

export function getRoleHolderStats(instructorId) {
  const data = readTrainingData();
  return data.instructor_role_points[instructorId] || {
    total_points: 0,
    sessions_completed: 0,
    types_completed: {},
    last_activity: null
  };
}

export function getRoleHolderLeaderboard() {
  const data = readTrainingData();
  if (!data.instructor_role_points) {
    return [];
  }
  return Object.entries(data.instructor_role_points)
    .map(([userId, stats]) => ({
      user_id: userId,
      ...stats
    }))
    .sort((a, b) => b.total_points - a.total_points)
    .slice(0, 10);
}

function updateLeaderboards(data) {
  data.leaderboards.instructors = Object.entries(data.instructor_scores).map(([instructorId, scores]) => {
    const totalPoints = Object.entries(scores).reduce((total, [type, points]) => {
      const scoreType = data.score_types[type];
      if (scoreType) {
        return total + (points * scoreType.base_points * scoreType.multiplier);
      }
      return total;
    }, 0);
    
    return {
      instructor_id: instructorId,
      total_points: totalPoints,
      scores: scores
    };
  }).sort((a, b) => b.total_points - a.total_points).slice(0, 10);
  
  // Student leaderboard
  data.leaderboards.students = Object.entries(data.student_scores).map(([studentId, scores]) => {
    const totalPoints = Object.entries(scores).reduce((total, [type, points]) => {
      const scoreType = data.score_types[type];
      if (scoreType) {
        return total + (points * scoreType.base_points * scoreType.multiplier);
      }
      return total;
    }, 0);
    
    return {
      student_id: studentId,
      total_points: totalPoints,
      scores: scores
    };
  }).sort((a, b) => b.total_points - a.total_points).slice(0, 10);
}

export function getInstructorSessions(instructorId, limit = 10) {
  const data = readTrainingData();
  return data.training_sessions
    .filter(session => session.instructor_id === instructorId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

export function getStudentSessions(studentId, limit = 10) {
  const data = readTrainingData();
  return data.training_sessions
    .filter(session => session.student_id === studentId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

export function getInstructorLeaderboard() {
  const data = readTrainingData();
  return data.leaderboards.instructors;
}

export function getStudentLeaderboard() {
  const data = readTrainingData();
  return data.leaderboards.students;
}

export function calculateTotalScore(userId, isInstructor = false) {
  const data = readTrainingData();
  const scores = isInstructor ? data.instructor_scores[userId] : data.student_scores[userId];
  const scoreTypes = data.score_types;
  
  if (!scores) return 0;
  
  return Object.entries(scores).reduce((total, [type, points]) => {
    const scoreType = scoreTypes[type];
    if (!scoreType) return total;
    return total + (points * scoreType.base_points * scoreType.multiplier);
  }, 0);
}

export function getShopItems() {
  const data = readTrainingData();
  return data.shop_items || [];
}

export function getShopItemsByCategory(category) {
  const data = readTrainingData();
  return (data.shop_items || []).filter(item => item.category === category);
}

export function purchaseItem(userId, itemId) {
  const data = readTrainingData();
  const item = data.shop_items.find(i => i.id === itemId);
  
  if (!item) {
    throw new Error('Item não encontrado na loja.');
  }
  
  const userScores = data.student_scores[userId] || {};
  const scoreTypes = data.score_types;
  let totalPoints = 0;
  
  Object.entries(userScores).forEach(([type, points]) => {
    const scoreType = scoreTypes[type];
    if (scoreType) {
      totalPoints += points * scoreType.base_points * scoreType.multiplier;
    }
  });
  
  if (totalPoints < item.cost) {
    throw new Error(`Pontos insuficientes. Você tem ${totalPoints} pontos, mas precisa de ${item.cost} pontos.`);
  }
  
  if (!data.student_scores[userId]) {
    data.student_scores[userId] = {};
  }
  if (!data.student_scores[userId][item.category]) {
    data.student_scores[userId][item.category] = 0;
  }
  data.student_scores[userId][item.category] -= item.cost;
  
  if (!data.purchase_history) {
    data.purchase_history = [];
  }
  
  data.purchase_history.push({
    user_id: userId,
    item_id: itemId,
    cost: item.cost,
    timestamp: new Date().toISOString()
  });
  
  writeTrainingData(data);
  
  return {
    success: true,
    item: item,
    remaining_points: totalPoints - item.cost
  };
}

export function applyRewardEffect(userId, item) {
  const data = readTrainingData();
  
  switch (item.type) {
    case 'role_temp':
      break;
      
    case 'custom_color':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        custom_color: item.color
      };
      writeTrainingData(data);
      break;
      
    case 'public_praise':
      break;
      
    case 'custom_image':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        custom_pfp: item.image_url
      };
      writeTrainingData(data);
      break;
      
    case 'student_highlight':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        highlighted_student: item.target_student_id
      };
      writeTrainingData(data);
      break;
      
    case 'priority_student':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        priority_student: item.target_student_id
      };
      writeTrainingData(data);
      break;
      
    case 'point_multiplier':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        point_multiplier: item.multiplier_value
      };
      writeTrainingData(data);
      break;
      
    case 'ticket_bonus':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        ticket_bonus: item.bonus_multiplier
      };
      writeTrainingData(data);
      break;
      
    case 'early_access_promo':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        early_access_promo: item.discount_percentage
      };
      writeTrainingData(data);
      break;
      
    case 'consultative_vote':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        consultative_vote: true
      };
      writeTrainingData(data);
      break;
      
    case 'mentor_role':
      if (!data.user_preferences) {
        data.user_preferences = {};
      }
      data.user_preferences[userId] = {
        ...data.user_preferences[userId],
        mentor_role: true
      };
      writeTrainingData(data);
      break;
  }
  
  return true;
}

export function getUserPurchaseHistory(userId) {
  const data = readTrainingData();
  return (data.purchase_history || []).filter(purchase => purchase.user_id === userId);
}

export function getUserPreferences(userId) {
  const data = readTrainingData();
  return data.user_preferences?.[userId] || {};
}

export function hasInstructorRole(member, instructorRoleId) {
  if (!instructorRoleId) return true;
  return member.roles.cache.has(instructorRoleId);
}
