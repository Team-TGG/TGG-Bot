import { getClient } from './db.js';

// Training Score Types
export async function getScoreTypes() {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('training_score_types')
      .select('*');
    
    if (error) throw error;
    
    // Convert to object format for compatibility
    const scoreTypes = {};
    data.forEach(type => {
      scoreTypes[type.type_key] = {
        name: type.name,
        base_points: type.base_points,
        multiplier: type.multiplier
      };
    });
    
    return scoreTypes;
  } catch (error) {
    console.error('Error getting score types:', error);
    return {};
  }
}

// Training Sessions
export async function addTrainingSession(instructorId, studentId, type, duration, points, notes = '', status = 'complete') {
  const client = getClient();
  
  try {
    // Insert training session
    const { data, error } = await client
      .from('training_sessions')
      .insert({
        instructor_id: instructorId,
        student_id: studentId,
        type_key: type,
        duration: duration,
        points: points,
        notes: notes,
        status: status
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update instructor stats if session is complete
    if (status === 'complete') {
      await updateInstructorStats(instructorId, type, points);
    }
    
    return data;
  } catch (error) {
    console.error('Error adding training session:', error);
    throw error;
  }
}

export async function getInstructorSessions(instructorId, limit = 10) {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('training_sessions')
      .select('*')
      .eq('instructor_id', instructorId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error getting instructor sessions:', error);
    return [];
  }
}

export async function getStudentSessions(studentId, limit = 10) {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('training_sessions')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error getting student sessions:', error);
    return [];
  }
}

// Instructor Stats
async function updateInstructorStats(instructorId, type, points) {
  const client = getClient();
  
  try {
    // Check if stats exist
    const { data: existingStats, error: fetchError } = await client
      .from('instructor_stats')
      .select('*')
      .eq('instructor_id', instructorId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    if (existingStats) {
      // Update existing stats
      const typesCompleted = existingStats.types_completed || {};
      typesCompleted[type] = (typesCompleted[type] || 0) + 1;
      
      const { error: updateError } = await client
        .from('instructor_stats')
        .update({
          total_points: existingStats.total_points + points,
          sessions_completed: existingStats.sessions_completed + 1,
          types_completed: typesCompleted,
          last_activity: new Date().toISOString()
        })
        .eq('instructor_id', instructorId);
      
      if (updateError) throw updateError;
    } else {
      // Create new stats
      const { error: insertError } = await client
        .from('instructor_stats')
        .insert({
          instructor_id: instructorId,
          total_points: points,
          sessions_completed: 1,
          types_completed: { [type]: 1 },
          last_activity: new Date().toISOString()
        });
      
      if (insertError) throw insertError;
    }
  } catch (error) {
    console.error('Error updating instructor stats:', error);
    throw error;
  }
}

export async function addRoleHolderPoints(instructorId, points, type = 'general') {
  await updateInstructorStats(instructorId, type, points);
  
  // Return updated stats
  return await getRoleHolderStats(instructorId);
}

export async function getRoleHolderStats(instructorId) {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('instructor_stats')
      .select('*')
      .eq('instructor_id', instructorId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data || {
      total_points: 0,
      sessions_completed: 0,
      types_completed: {},
      last_activity: null
    };
  } catch (error) {
    console.error('Error getting role holder stats:', error);
    return {
      total_points: 0,
      sessions_completed: 0,
      types_completed: {},
      last_activity: null
    };
  }
}

export async function getRoleHolderLeaderboard() {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('instructor_stats')
      .select('*')
      .order('total_points', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error getting role holder leaderboard:', error);
    return [];
  }
}

// Leaderboards
export async function getInstructorLeaderboard() {
  const client = getClient();
  
  try {
    const { data: sessions, error: sessionsError } = await client
      .from('training_sessions')
      .select('instructor_id, type_key, points, created_at')
      .eq('status', 'complete');
    
    if (sessionsError) throw sessionsError;
    
    const scoreTypes = await getScoreTypes();
    
    // Aggregate instructor scores
    const instructorScores = {};
    sessions.forEach(session => {
      const { instructor_id, type_key, points } = session;
      const scoreType = scoreTypes[type_key];
      
      if (!instructorScores[instructor_id]) {
        instructorScores[instructor_id] = {
          instructor_id,
          total_points: 0,
          scores: {}
        };
      }
      
      const actualPoints = scoreType ? points * scoreType.base_points * scoreType.multiplier : points;
      instructorScores[instructor_id].total_points += actualPoints;
      
      if (!instructorScores[instructor_id].scores[type_key]) {
        instructorScores[instructor_id].scores[type_key] = 0;
      }
      instructorScores[instructor_id].scores[type_key] += points;
    });
    
    // Sort and return top 10
    return Object.values(instructorScores)
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, 10);
  } catch (error) {
    console.error('Error getting instructor leaderboard:', error);
    return [];
  }
}

export async function getStudentLeaderboard() {
  const client = getClient();
  
  try {
    const { data: sessions, error: sessionsError } = await client
      .from('training_sessions')
      .select('student_id, type_key, points, created_at')
      .eq('status', 'complete');
    
    if (sessionsError) throw sessionsError;
    
    const scoreTypes = await getScoreTypes();
    
    // Aggregate student scores
    const studentScores = {};
    sessions.forEach(session => {
      const { student_id, type_key, points } = session;
      const scoreType = scoreTypes[type_key];
      
      if (!studentScores[student_id]) {
        studentScores[student_id] = {
          student_id,
          total_points: 0,
          scores: {}
        };
      }
      
      const actualPoints = scoreType ? points * scoreType.base_points * scoreType.multiplier : points;
      studentScores[student_id].total_points += actualPoints;
      
      if (!studentScores[student_id].scores[type_key]) {
        studentScores[student_id].scores[type_key] = 0;
      }
      studentScores[student_id].scores[type_key] += points;
    });
    
    // Sort and return top 10
    return Object.values(studentScores)
      .sort((a, b) => b.total_points - a.total_points)
      .slice(0, 10);
  } catch (error) {
    console.error('Error getting student leaderboard:', error);
    return [];
  }
}

export async function calculateTotalScore(userId, isInstructor = false) {
  const client = getClient();
  
  try {
    const { data: sessions, error } = await client
      .from('training_sessions')
      .select('type_key, points')
      .eq(isInstructor ? 'instructor_id' : 'student_id', userId)
      .eq('status', 'complete');
    
    if (error) throw error;
    
    const scoreTypes = await getScoreTypes();
    
    return sessions.reduce((total, session) => {
      const scoreType = scoreTypes[session.type_key];
      if (!scoreType) return total;
      return total + (session.points * scoreType.base_points * scoreType.multiplier);
    }, 0);
  } catch (error) {
    console.error('Error calculating total score:', error);
    return 0;
  }
}

// Shop System
export async function getShopItems() {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('shop_items')
      .select('*');
    
    if (error) throw error;
    
    // Convert to old format for compatibility
    return (data || []).map(item => ({
      id: item.item_id,
      category: item.category,
      name: item.name,
      description: item.description,
      cost: item.cost,
      type: item.type,
      ...item.properties
    }));
  } catch (error) {
    console.error('Error getting shop items:', error);
    return [];
  }
}

export async function getShopItemsByCategory(category) {
  const items = await getShopItems();
  return items.filter(item => item.category === category);
}

export async function purchaseItem(userId, itemId) {
  const client = getClient();
  
  try {
    // Get item details
    const { data: item, error: itemError } = await client
      .from('shop_items')
      .select('*')
      .eq('item_id', itemId)
      .single();
    
    if (itemError) throw itemError;
    if (!item) throw new Error('Item não encontrado na loja.');
    
    // Check user points
    const userPoints = await calculateTotalScore(userId);
    if (userPoints < item.cost) {
      throw new Error(`Pontos insuficientes. Você tem ${userPoints} pontos, mas precisa de ${item.cost} pontos.`);
    }
    
    // Record purchase
    const { error: purchaseError } = await client
      .from('purchase_history')
      .insert({
        user_id: userId,
        item_id: itemId,
        cost: item.cost
      });
    
    if (purchaseError) throw purchaseError;
    
    // Apply reward effect
    await applyRewardEffect(userId, {
      id: item.item_id,
      type: item.type,
      ...item.properties
    });
    
    return {
      success: true,
      item: {
        id: item.item_id,
        category: item.category,
        name: item.name,
        description: item.description,
        cost: item.cost,
        type: item.type,
        ...item.properties
      },
      remaining_points: userPoints - item.cost
    };
  } catch (error) {
    console.error('Error purchasing item:', error);
    throw error;
  }
}

export async function applyRewardEffect(userId, item) {
  const client = getClient();
  
  try {
    // Get current preferences
    const { data: currentPrefs, error: fetchError } = await client
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    const preferences = currentPrefs?.preferences || {};
    
    // Apply effect based on item type
    let updatedPreferences = { ...preferences };
    
    switch (item.type) {
      case 'custom_color':
        updatedPreferences.custom_color = item.color;
        break;
        
      case 'custom_image':
        updatedPreferences.custom_pfp = item.image_url;
        break;
        
      case 'student_highlight':
        updatedPreferences.highlighted_student = item.target_student_id;
        break;
        
      case 'priority_student':
        updatedPreferences.priority_student = item.target_student_id;
        break;
        
      case 'point_multiplier':
        updatedPreferences.point_multiplier = item.multiplier_value;
        break;
        
      case 'ticket_bonus':
        updatedPreferences.ticket_bonus = item.bonus_multiplier;
        break;
        
      case 'early_access_promo':
        updatedPreferences.early_access_promo = item.discount_percentage;
        break;
        
      case 'consultative_vote':
        updatedPreferences.consultative_vote = true;
        break;
        
      case 'mentor_role':
        updatedPreferences.mentor_role = true;
        break;
        
      default:
        // For other types like role_temp, public_praise, etc.
        // These would be handled by Discord bot logic
        break;
    }
    
    // Update preferences
    if (currentPrefs) {
      const { error: updateError } = await client
        .from('user_preferences')
        .update({ preferences: updatedPreferences })
        .eq('user_id', userId);
      
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await client
        .from('user_preferences')
        .insert({
          user_id: userId,
          preferences: updatedPreferences
        });
      
      if (insertError) throw insertError;
    }
    
    return true;
  } catch (error) {
    console.error('Error applying reward effect:', error);
    throw error;
  }
}

export async function getUserPurchaseHistory(userId) {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('purchase_history')
      .select(`
        *,
        shop_items:item_id (
          item_id,
          name,
          category,
          description,
          cost,
          type,
          properties
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(purchase => ({
      user_id: purchase.user_id,
      item_id: purchase.item_id,
      cost: purchase.cost,
      timestamp: purchase.created_at,
      item: purchase.shop_items ? {
        id: purchase.shop_items.item_id,
        name: purchase.shop_items.name,
        category: purchase.shop_items.category,
        description: purchase.shop_items.description,
        cost: purchase.shop_items.cost,
        type: purchase.shop_items.type,
        ...purchase.shop_items.properties
      } : null
    }));
  } catch (error) {
    console.error('Error getting user purchase history:', error);
    return [];
  }
}

export async function getUserPreferences(userId) {
  const client = getClient();
  
  try {
    const { data, error } = await client
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data?.preferences || {};
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return {};
  }
}

// Utility function
export function hasInstructorRole(member, instructorRoleId) {
  if (!instructorRoleId) return true;
  return member.roles.cache.has(instructorRoleId);
}
