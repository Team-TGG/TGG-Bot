// Sistema de Treinamento usando Banco de Dados SQL

import { getClient } from './db.js';
import { getUserByDiscordId, reactivateOrAddUser } from './db.js';

const supabase = getClient();

// ============ HELPER FUNCTIONS ============

export async function getOrCreateInstructorByDiscordId(discordId) {
  const user = await getUserByDiscordId(discordId);
  if (!user) {
    throw new Error(`Usuário com Discord ID ${discordId} não encontrado no banco de dados.`);
  }

  // Try to find existing instructor
  const { data: existingInstructor, error: findError } = await supabase
    .from('instructors')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (findError && findError.code !== 'PGRST116') {
    throw findError;
  }

  if (existingInstructor) {
    return existingInstructor;
  }

  // Create new instructor if doesn't exist
  const { data: newInstructor, error: createError } = await supabase
    .from('instructors')
    .insert({
      user_id: user.id,
      status: true,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  return newInstructor;
}

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
  // Get or create instructor record for trainer
  const trainer = await getOrCreateInstructorByDiscordId(trainerId);
  
  // Get user record for student
  let student = await getUserByDiscordId(studentId);
  
  console.log('[DEBUG] trainer:', trainer);
  console.log('[DEBUG] student:', student);
  
  if (!trainer) {
    throw new Error(`Instrutor com Discord ID ${trainerId} não encontrado no banco de dados. O usuário precisa estar registrado no sistema.`);
  }
  
  // Auto-create student if doesn't exist
  if (!student) {
    try {
      console.log(`[DEBUG] Creating student with Discord ID: ${studentId}`);
      
      // Create student with default values
      const createdUser = await reactivateOrAddUser(studentId, '0', 'Aluno');
      console.log(`[DEBUG] Created user:`, createdUser);
      
      // Get the newly created user from database
      student = await getUserByDiscordId(studentId);
      console.log(`[DEBUG] Fetched student from DB:`, student);
      
      if (!student || !student.id) {
        throw new Error('Não foi possível criar ou encontrar o aluno no banco de dados. O ID do usuário é inválido.');
      }
      
      // Verify the student exists in the users table
      const { data: verifyStudent, error: verifyError } = await supabase
        .from('users')
        .select('id')
        .eq('id', student.id)
        .single();
      
      if (verifyError || !verifyStudent) {
        throw new Error(`O aluno com UUID ${student.id} não existe na tabela users. Verificação de integridade falhou.`);
      }
      
      console.log(`[DEBUG] Student verified in users table with ID: ${student.id}`);
    } catch (err) {
      console.error('[ERROR] Failed to create student:', err);
      throw new Error(`Não foi possível criar o aluno no banco de dados: ${err.message}`);
    }
  }

  console.log('[DEBUG] trainer.id:', trainer.id, 'student.id:', student.id);

  // Verify trainer exists in instructors table
  const { data: verifyTrainer, error: verifyTrainerError } = await supabase
    .from('instructors')
    .select('id')
    .eq('id', trainer.id)
    .single();
  
  if (verifyTrainerError || !verifyTrainer) {
    throw new Error(`O instrutor com UUID ${trainer.id} não existe na tabela instructors. Verificação de integridade falhou.`);
  }

  console.log('[DEBUG] Creating training session with validated IDs');

  const { data, error } = await supabase
    .from('trainings')
    .insert({
      trainer_id: trainer.id,
      student_id: student.id,
      status: 'active',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('Erro ao criar sessão de treinamento:', error);
    throw error;
  }

  // Add notes to training_messages table if provided
  if (notes && data?.id) {
    await supabase
      .from('training_messages')
      .insert({
        training_id: data.id,
        sender_id: trainer.id,
        message: notes,
        created_at: new Date().toISOString()
      });
  }

  return data;
}

export async function completeTrainingSession(trainingId, notes = '') {
  const { data, error } = await supabase
    .from('trainings')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString()
    })
    .eq('id', trainingId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao completar sessão de treinamento:', error);
    throw error;
  }

  // Add notes to training_messages table if provided
  if (notes) {
    await supabase
      .from('training_messages')
      .insert({
        training_id: trainingId,
        sender_id: data?.trainer_id,
        message: notes,
        created_at: new Date().toISOString()
      });
  }

  return data;
}

export async function partialTrainingSession(trainingId, notes = '') {
  const { data, error } = await supabase
    .from('trainings')
    .update({
      status: 'partial'
    })
    .eq('id', trainingId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao atualizar sessão de treinamento:', error);
    throw error;
  }

  // Add notes to training_messages table if provided
  if (notes) {
    await supabase
      .from('training_messages')
      .insert({
        training_id: trainingId,
        sender_id: data?.trainer_id,
        message: notes,
        created_at: new Date().toISOString()
      });
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
  // Convert Discord IDs to database UUIDs
  const instructor = await getOrCreateInstructorByDiscordId(instructorId);
  
  if (!instructor) {
    throw new Error(`Instrutor com Discord ID ${instructorId} não encontrado no banco de dados.`);
  }

  // Ensure we have a valid student record in 'users' table
  let student = await getUserByDiscordId(studentId);
  
  if (!student) {
    console.log(`[DEBUG] Student ${studentId} not found, creating...`);
    student = await reactivateOrAddUser(studentId, '0', 'Aluno');
    console.log(`[DEBUG] Created student:`, student.id);
  } else if (!student.active) {
    console.log(`[DEBUG] Student ${studentId} found but inactive, reactivating...`);
    student = await reactivateOrAddUser(studentId, student.brawlhalla_id || '0', student.username || 'Aluno');
    console.log(`[DEBUG] Reactivated student:`, student.id);
  }

  if (!student || !student.id) {
    throw new Error(`Não foi possível obter um ID válido para o aluno ${studentId}`);
  }

  // Double check existence in 'users' table to avoid FK violation
  const { data: userExists, error: checkError } = await supabase
    .from('users')
    .select('id')
    .eq('id', student.id)
    .single();

  if (checkError || !userExists) {
    console.error(`[ERROR] Student ID ${student.id} not found in users table despite creation attempt:`, checkError);
    // Final fallback: search again by discord_id
    const finalCheck = await getUserByDiscordId(studentId);
    if (!finalCheck) {
      throw new Error(`Erro crítico: Aluno ${studentId} não existe na tabela 'users' (FK constraint fail)`);
    }
    student = finalCheck;
  }

  console.log(`[DEBUG] Final student ID for association: ${student.id}`);

  const { data, error } = await supabase
    .from('student_instructors')
    .insert({
      instructor_id: instructor.id,
      student_id: student.id
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Este aluno já está associado a um instrutor.');
    }
    console.error('Erro ao reivindicar aluno:', error);
    throw error;
  }

  return data;
}

export async function unclaimStudent(instructorId, studentId) {
  // Convert Discord IDs to database UUIDs
  const instructor = await getOrCreateInstructorByDiscordId(instructorId);
  const student = await getUserByDiscordId(studentId);
  
  if (!instructor) {
    throw new Error(`Instrutor com Discord ID ${instructorId} não encontrado no banco de dados.`);
  }
  
  if (!student) {
    throw new Error(`Aluno com Discord ID ${studentId} não encontrado no banco de dados.`);
  }

  console.log(`[DEBUG] unclaimStudent - instructor.id: ${instructor.id}, student.id: ${student.id}`);

  // Verify both exist in their respective tables
  const { data: verifyInstructor, error: verifyInstructorError } = await supabase
    .from('instructors')
    .select('id')
    .eq('id', instructor.id)
    .single();
  
  if (verifyInstructorError || !verifyInstructor) {
    throw new Error(`O instrutor com UUID ${instructor.id} não existe na tabela instructors.`);
  }

  const { data: verifyStudent, error: verifyStudentError } = await supabase
    .from('users')
    .select('id')
    .eq('id', student.id)
    .single();
  
  if (verifyStudentError || !verifyStudent) {
    throw new Error(`O aluno com UUID ${student.id} não existe na tabela users.`);
  }

  console.log('[DEBUG] Deleting student_instructors record with validated IDs');

  const { error } = await supabase
    .from('student_instructors')
    .delete()
    .eq('instructor_id', instructor.id)
    .eq('student_id', student.id);

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
