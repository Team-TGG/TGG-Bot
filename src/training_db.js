// Sistema de Treinamento usando Banco de Dados SQL

import { getClient } from './db.js';

const supabase = getClient();

// ============ TIPOS DE PONTUAÇÃO ============

export async function getScoreTypes() {
  const { data, error } = await supabase
    .from('training_score_types')
    .select('*')
    .eq('active', true)
    .order('name');

  if (error) {
    console.error('Erro ao buscar tipos de pontuação:', error);
    return {};
  }

  // Converter para o formato esperado pelo código existente
  const result = {};
  data.forEach(type => {
    result[type.name.toLowerCase().replace(/\s+/g, '_')] = {
      id: type.id,
      name: type.name,
      base_points: type.points,
      multiplier: 1, // Pode ser ajustado no futuro
      description: type.description
    };
  });

  return result;
}

export async function getScoreTypeById(id) {
  const { data, error } = await supabase
    .from('training_score_types')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Erro ao buscar tipo de pontuação por ID:', error);
    return null;
  }

  return data;
}

// ============ SESSÕES DE TREINAMENTO ============

export async function createTrainingSession(trainerId, studentId, notes = '', durationMinutes = null) {
  const { data, error } = await supabase
    .from('trainings')
    .insert({
      trainer_id: trainerId,
      student_id: studentId,
      status: 'active',
      notes: notes,
      duration_minutes: durationMinutes
    })
    .select()
    .single();

  if (error) {
    console.error('Erro ao criar sessão de treinamento:', error);
    throw error;
  }

  return data;
}

export async function completeTrainingSession(trainingId, notes = '') {
  const { data, error } = await supabase
    .from('trainings')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      notes: notes
    })
    .eq('id', trainingId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao completar sessão de treinamento:', error);
    throw error;
  }

  return data;
}

export async function partialTrainingSession(trainingId, notes = '') {
  const { data, error } = await supabase
    .from('trainings')
    .update({
      status: 'partial',
      notes: notes
    })
    .eq('id', trainingId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao atualizar sessão parcial:', error);
    throw error;
  }

  return data;
}

export async function getTrainingSession(trainingId) {
  const { data, error } = await supabase
    .from('trainings')
    .select(`
      *,
      trainer:users!trainings_trainer_id_fkey(discord_id, username),
      student:users!trainings_student_id_fkey(discord_id, username)
    `)
    .eq('id', trainingId)
    .single();

  if (error) {
    console.error('Erro ao buscar sessão de treinamento:', error);
    return null;
  }

  return data;
}

export async function getInstructorSessions(instructorId, limit = 15) {
  const { data, error } = await supabase
    .from('trainings')
    .select(`
      *,
      student:users!trainings_student_id_fkey(discord_id, username),
      training_scores(
        id,
        points,
        score_type_id,
        training_score_types(name, points)
      )
    `)
    .eq('trainer_id', instructorId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Erro ao buscar sessões do instrutor:', error);
    return [];
  }

  return data;
}

export async function getStudentSessions(studentId, limit = 15) {
  const { data, error } = await supabase
    .from('trainings')
    .select(`
      *,
      trainer:users!trainings_trainer_id_fkey(discord_id, username),
      training_scores(
        id,
        points,
        score_type_id,
        training_score_types(name, points)
      )
    `)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Erro ao buscar sessões do aluno:', error);
    return [];
  }

  return data;
}

// ============ PONTUAÇÃO ============

export async function addTrainingScore(trainingId, scoreTypeId, points) {
  const { data, error } = await supabase
    .from('training_scores')
    .insert({
      training_id: trainingId,
      score_type_id: scoreTypeId,
      points: points
    })
    .select()
    .single();

  if (error) {
    console.error('Erro ao adicionar pontuação:', error);
    throw error;
  }

  return data;
}

export async function getTrainingScores(trainingId) {
  const { data, error } = await supabase
    .from('training_scores')
    .select(`
      *,
      training_score_types(name, points, description)
    `)
    .eq('training_id', trainingId);

  if (error) {
    console.error('Erro ao buscar pontuações:', error);
    return [];
  }

  return data;
}

// ============ MENSAGENS ============

export async function addTrainingMessage(trainingId, senderId, message) {
  const { data, error } = await supabase
    .from('training_messages')
    .insert({
      training_id: trainingId,
      sender_id: senderId,
      message: message
    })
    .select()
    .single();

  if (error) {
    console.error('Erro ao adicionar mensagem:', error);
    throw error;
  }

  return data;
}

export async function getTrainingMessages(trainingId) {
  const { data, error } = await supabase
    .from('training_messages')
    .select(`
      *,
      sender:users!training_messages_sender_id_fkey(discord_id, username)
    `)
    .eq('training_id', trainingId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erro ao buscar mensagens:', error);
    return [];
  }

  return data;
}

// ============ ALUNO-INSTRUTOR ============

export async function claimStudent(instructorId, studentId) {
  const { data, error } = await supabase
    .from('student_instructors')
    .insert({
      instructor_id: instructorId,
      student_id: studentId
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      throw new Error('Este aluno já está associado a um instrutor.');
    }
    console.error('Erro ao reivindicar aluno:', error);
    throw error;
  }

  return data;
}

export async function unclaimStudent(instructorId, studentId) {
  const { error } = await supabase
    .from('student_instructors')
    .delete()
    .eq('instructor_id', instructorId)
    .eq('student_id', studentId);

  if (error) {
    console.error('Erro ao remover associação:', error);
    throw error;
  }

  return true;
}

export async function getInstructorStudents(instructorId) {
  const { data, error } = await supabase
    .from('student_instructors')
    .select('student_id')
    .eq('instructor_id', instructorId);

  if (error) {
    console.error('Erro ao buscar alunos do instrutor:', error);
    return [];
  }

  // Return just the student IDs, let the command handler fetch additional data
  return data.map(row => ({ student_id: row.student_id }));
}

export async function getStudentInstructor(studentId) {
  const { data, error } = await supabase
    .from('student_instructors')
    .select(`
      instructor_id,
      instructor:users!student_instructors_instructor_id_fkey(discord_id, username)
    `)
    .eq('student_id', studentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') { 
      return null;
    }
    console.error('Erro ao buscar instrutor do aluno:', error);
    return null;
  }

  return data;
}

// ============ FUNÇÕES LEGADAS (Compatibilidade) ============

export async function addTrainingSession(instructorId, studentId, type, duration, points, notes = '', status = 'complete') {
  // Primeiro, criar a sessão
  const session = await createTrainingSession(instructorId, studentId, notes, duration);
  
  // Se for completed, marcar como completada
  if (status === 'completed') {
    await completeTrainingSession(session.id, notes);
  } else if (status === 'partial') {
    await partialTrainingSession(session.id, notes);
  }

  // Adicionar pontuação
  const scoreTypes = await getScoreTypes();
  const scoreTypeKey = Object.keys(scoreTypes).find(key => scoreTypes[key].name === type);
  
  if (scoreTypeKey && scoreTypes[scoreTypeKey]) {
    await addTrainingScore(session.id, scoreTypes[scoreTypeKey].id, points);
  }

  return session;
}
