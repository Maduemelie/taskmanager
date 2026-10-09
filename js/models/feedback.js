/* js/models/feedback.js */
import db from '../db.js';
import { generateId } from '../utils/id.js';

export async function saveDailyFeedback(dateStr, feedbackData) {
  const existing = await db.dailyFeedback.where('date').equals(dateStr).first();
  if (existing) {
    return await db.dailyFeedback.update(existing.id, { ...feedbackData, updatedAt: new Date().toISOString() });
  } else {
    const newFeedback = {
      id: generateId(),
      date: dateStr,
      ...feedbackData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return await db.dailyFeedback.add(newFeedback);
  }
}

export async function getDailyFeedback(dateStr) {
  return await db.dailyFeedback.where('date').equals(dateStr).first();
}
