/* js/engine/test-pipeline.js */
import { generateDayPlan } from './planner.js';
import { addUnplannedTask, rescheduleRemaining, suggestDeferrals, applyDeferrals } from './reschedule.js';

export function runPipelineTests() {
  console.log('=============== STARTING PLANNING ENGINE PIPELINE TEST ===============');

  // 1. Mock preferences
  const preferences = {
    wakeTime: '07:00',
    sleepTime: '23:00',
    buckets: [
      { id: 'health', name: 'Health' },
      { id: 'learning', name: 'Learning' },
      { id: 'home', name: 'Home' }
    ]
  };

  // 2. Mock tasks
  const nowStr = new Date().toISOString();
  const mockTasks = [
    {
      id: 'task-1',
      name: 'Gym Workout 🏃‍♂️',
      bucket: 'health',
      priority: 4,
      estimatedMinutes: 45,
      energyLevel: 'high',
      preferredTime: 'morning',
      createdAt: nowStr,
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    },
    {
      id: 'task-2',
      name: 'Read AI Book 📚',
      bucket: 'learning',
      priority: 3,
      estimatedMinutes: 30,
      energyLevel: 'medium',
      preferredTime: 'evening',
      createdAt: nowStr,
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    },
    {
      id: 'task-3',
      name: 'Clean kitchen counter 🧽',
      bucket: 'home',
      priority: 2,
      estimatedMinutes: 20,
      energyLevel: 'low',
      preferredTime: 'evening',
      createdAt: nowStr,
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    },
    {
      id: 'task-4',
      name: 'Practice React Coding 💻',
      bucket: 'learning',
      priority: 5,
      estimatedMinutes: 60,
      energyLevel: 'high',
      preferredTime: 'afternoon',
      createdAt: nowStr,
      completionHistory: [],
      isActive: true,
      isArchived: false,
      recurrence: { type: 'daily', interval: 1 }
    }
  ];

  // 3. Test Day Plan Generation
  // Capacity: 120 minutes (Gym: 45 + React: 60 + Read: 30 = 135 -> Should only pick Gym + React = 105)
  console.log('1. Generating day plan for capacity: 120 minutes...');
  let plan = {
    date: new Date().toISOString().split('T')[0],
    capacity: 120,
    plannedTasks: generateDayPlan(mockTasks, preferences, 120, 'high')
  };
  
  console.log('Generated Plan (Chronological):');
  plan.plannedTasks.forEach(t => {
    console.log(` - [${t.scheduledTime}] ${t.name} (${t.estimatedMinutes}m, Priority: ${t.priority}, Preferred: ${t.preferredTime})`);
  });

  // 4. Simulate Reality Mode: Add interruption
  console.log('\n2. Reality Interruption: "Fix kitchen sink" (40m) at 10:00...');
  const unplannedTask = {
    taskId: 'unplanned-1',
    name: 'Fix kitchen sink 🔧',
    bucket: 'home',
    estimatedMinutes: 40
  };
  
  // Add unplanned task
  plan = addUnplannedTask(plan, unplannedTask, '10:00');
  
  // Reschedule subsequent tasks forward by 40 minutes
  plan = rescheduleRemaining(plan, '10:00', 40, 'unplanned-1');

  console.log('Plan after interruption and reschedule:');
  plan.plannedTasks.forEach(t => {
    console.log(` - [${t.scheduledTime}] ${t.name} (${t.estimatedMinutes}m, Status: ${t.status}, Unplanned: ${t.isUnplanned})`);
  });

  // 5. Test capacity overflow / deferrals
  console.log('\n3. Checking for capacity overflow...');
  const deferrals = suggestDeferrals(plan, 120, mockTasks, preferences, 'high');
  console.log('Suggested Deferrals:', deferrals);

  if (deferrals.length > 0) {
    console.log('Applying suggested deferrals...');
    plan = applyDeferrals(plan, deferrals.map(d => d.taskId));
  }

  console.log('Final plan after deferrals:');
  plan.plannedTasks.forEach(t => {
    console.log(` - [${t.scheduledTime}] ${t.name} (${t.estimatedMinutes}m, Status: ${t.status}, Unplanned: ${t.isUnplanned})`);
  });

  console.log('=============== END OF PLANNING ENGINE PIPELINE TEST ===============');
}
