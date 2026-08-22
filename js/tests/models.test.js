/* js/tests/models.test.js */
import { describe, it, expect } from './runner.js';
import { createTask, getTask, updateTask, deleteTask } from '../models/task.js';
import db from '../db.js';

describe('IndexedDB CRUD Database Models', () => {

  it('should create, read, update, and delete tasks in IndexedDB', async () => {
    // 1. Create Task
    const newId = await createTask({
      name: 'Temp Integration Test Task 🗑️',
      bucket: 'health',
      priority: 5,
      estimatedMinutes: 25,
      energyLevel: 'low',
      preferredTime: 'morning'
    });

    expect(newId).toBeTruthy();

    // 2. Read Task
    const fetched = await getTask(newId);
    expect(fetched).toBeTruthy();
    expect(fetched.name).toBe('Temp Integration Test Task 🗑️');
    expect(fetched.priority).toBe(5);

    // 3. Update Task
    await updateTask(newId, {
      name: 'Updated Integration Test Task 🗑️',
      priority: 2
    });

    const updated = await getTask(newId);
    expect(updated.name).toBe('Updated Integration Test Task 🗑️');
    expect(updated.priority).toBe(2);

    // 4. Delete/Archive Task
    await deleteTask(newId);
    
    // Check it's marked as inactive/archived
    const archived = await db.tasks.get(newId);
    expect(archived.isActive).toBeFalsy();

    // Completely clean up from database to avoid pollution
    await db.tasks.delete(newId);
    const deleted = await db.tasks.get(newId);
    expect(deleted).toBeFalsy();
  });

});
