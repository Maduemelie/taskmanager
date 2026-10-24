import { getActiveTasks, recordCompletion } from '../models/task.js';
import { getTodayPlan, markTaskStatus } from '../models/plan.js';
import { showHabitCalendarModal } from '../components/habitCalendar.js';
import { isTaskDueOn } from '../engine/recurrence.js';
import { showToast } from '../components/toast.js';
import { triggerHaptic } from '../utils/haptics.js';
import { today } from '../utils/date.js';

let showAllHabits = false;

export function initHabitsView() {
  const filter = document.getElementById('habits-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      showAllHabits = filter.value === 'all';
      renderHabitsView();
    });
  }
}

export async function renderHabitsView() {
  const list = document.getElementById('habits-list');
  const count = document.getElementById('habits-due-count');
  const filter = document.getElementById('habits-filter');
  if (!list) return;
  if (filter) filter.value = showAllHabits ? 'all' : 'due';

  const tasks = (await getActiveTasks()).filter(task => task.type === 'habit' || task.isHabit);
  const dueHabits = tasks.filter(task => isTaskDueOn(task, today()));
  const visibleHabits = showAllHabits ? tasks : dueHabits;
  if (count) count.textContent = showAllHabits
    ? `${tasks.length} ${tasks.length === 1 ? 'habit' : 'habits'}`
    : `${dueHabits.length} due today`;

  list.replaceChildren();
  if (!visibleHabits.length) {
    const empty = document.createElement('div');
    empty.className = 'habit-empty-state';
    empty.innerHTML = `
      <h2>${tasks.length ? 'No habits due today' : 'Start with one habit'}</h2>
      <p>${tasks.length ? 'Your next scheduled habit will show up here when it is due.' : 'Create a habit and check in here each time you complete it.'}</p>
      ${tasks.length ? '' : '<a class="btn btn-primary" href="#add-task">Create a habit</a>'}
    `;
    list.appendChild(empty);
    return;
  }

  const plan = await getTodayPlan();
  visibleHabits.forEach(task => {
    const due = isTaskDueOn(task, today());
    const completed = (task.completionHistory || []).some(entry => entry.date === today());
    const card = document.createElement('article');
    card.className = 'habit-list-card';

    const details = document.createElement('div');
    details.className = 'habit-list-details';
    const title = document.createElement('h2');
    title.textContent = task.title || task.name || 'Habit';
    const meta = document.createElement('p');
    const recurrence = task.recurrence?.type || 'daily';
    meta.textContent = `${recurrence.charAt(0).toUpperCase()}${recurrence.slice(1)}${task.currentStreak ? ` · ${task.currentStreak} check-in streak` : ''}`;
    details.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'habit-list-actions';
    const historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.className = 'btn btn-ghost habit-history-btn';
    historyButton.textContent = 'History';
    historyButton.addEventListener('click', () => showHabitCalendarModal(task, plan?.id, async () => {
      await checkInHabit(task.id, plan);
    }));
    actions.appendChild(historyButton);

    if (due && !completed) {
      const doneButton = document.createElement('button');
      doneButton.type = 'button';
      doneButton.className = 'btn btn-primary habit-checkin-btn';
      doneButton.textContent = 'Mark done';
      doneButton.addEventListener('click', async () => {
        doneButton.disabled = true;
        await checkInHabit(task.id, plan);
      });
      actions.appendChild(doneButton);
    } else if (completed) {
      const doneLabel = document.createElement('span');
      doneLabel.className = 'habit-done-label';
      doneLabel.textContent = 'Done today';
      actions.appendChild(doneLabel);
    } else {
      const restLabel = document.createElement('span');
      restLabel.className = 'habit-rest-label';
      restLabel.textContent = 'Not due today';
      actions.appendChild(restLabel);
    }

    card.append(details, actions);
    list.appendChild(card);
  });
}

async function checkInHabit(taskId, plan) {
  triggerHaptic(20);
  const plannedEntry = plan?.plannedTasks?.find(task => task.taskId === taskId && task.status !== 'completed');
  if (plannedEntry) await markTaskStatus(plan.id, taskId, 'completed', 0);
  else await recordCompletion(taskId, 0);
  showToast('Habit checked in', 'success');
  await renderHabitsView();
}
