/* js/tests/models.test.js */
import { describe, it, expect } from './runner.js';
import { createTask, getTask, updateTask, deleteTask } from '../models/task.js';
import { escapeHTML, validateImportSchema, sanitizeImportData } from '../views/settings.js';
import db from '../db.js';

describe('IndexedDB CRUD Database Models & Data Safety', () => {

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

  it('should escape HTML characters in task text to prevent XSS', () => {
    const malicious = '<script>alert("XSS")</script>&"test"\'';
    const escaped = escapeHTML(malicious);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp;&quot;test&quot;&#039;');
    
    // Non-string edge cases
    expect(escapeHTML(null)).toBe(null);
    expect(escapeHTML(undefined)).toBe(undefined);
    expect(escapeHTML(123)).toBe(123);
  });

  it('should validate backup import schema structure', () => {
    const validData = {
      tasks: [{ id: 't1', name: 'Task 1', bucket: 'home' }],
      dailyPlans: [{ id: 'p1', date: '2026-08-24', plannedTasks: [] }],
      preferences: [{ id: 'user_default', buckets: [] }]
    };
    expect(validateImportSchema(validData)).toBeTruthy();

    const invalidData = {
      tasks: 'not an array'
    };
    let threw = false;
    try {
      validateImportSchema(invalidData);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBeTruthy();
  });

  it('should sanitize all task fields during data import', () => {
    const backup = {
      tasks: [
        { id: 't1', name: '<img src=x onerror=alert(1)>', description: '<b>Important</b>', bucket: 'home' }
      ],
      dailyPlans: [
        { id: 'p1', date: '2026-08-24', plannedTasks: [{ taskId: 't1', name: '<script>alert(1)</script>' }] }
      ],
      preferences: [
        { id: 'user_default', buckets: [{ id: 'home', name: '<style>body{}</style>' }] }
      ]
    };
    const clean = sanitizeImportData(backup);
    expect(clean.tasks[0].name).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(clean.tasks[0].description).toBe('&lt;b&gt;Important&lt;/b&gt;');
    expect(clean.dailyPlans[0].plannedTasks[0].name).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(clean.preferences[0].buckets[0].name).toBe('&lt;style&gt;body{}&lt;/style&gt;');
  });

});
