# Adaptive AI Planner — Technical Product Specification
**Bucket → Plan → Today → Feedback → Replan**  
Version 1.0 • Implementation-ready product and engineering specification

## 1. Product Definition
Adaptive personal planning system: **CAPTURE → UNDERSTAND → PRIORITIZE → SCHEDULE → EXECUTE → OBSERVE → REFLECT → REPLAN**.

### Core screens
| Screen | Question | Responsibility |
|---|---|---|
| Bucket | What do I need/want to do? | Capture and structure tasks |
| Plan | How should these tasks fit into my day? | Generate/review schedule |
| Today | What should I do now? | Execute/adapt schedule |

## 2. Product Principles
- Planner manages the plan; user manages intent.
- AI interprets ambiguity; deterministic code enforces constraints.
- Completed work is preserved during replanning.
- Progressive disclosure reduces cognitive load.
- Schedule is a living plan.
- Deterministic fallback works without AI.
- AI mutations are validated, auditable, and reviewable.

## 3. UX Specification
### Visual tokens
| Token | Value |
|---|---|
| Background | `#FAF8F5` |
| Surface | `#FFFFFF` |
| Primary | `#F2743A` |
| Text | `#242424` |
| Muted | `#8A8A8A` |
| Border | `#EAE4DD` |
| Success | `#5E9560` |
| Warning | `#E7A43A` |
| Danger | `#C95D55` |

Use a consistent icon system; avoid making emoji the primary metadata language.

## 4. Bucket
Purpose: low-friction capture and organization.

```text
TASK BUCKET
├── Header
├── Search
├── Category filters
├── AI Inbox
├── Category sections
│   └── Task cards
└── Quick Add
```

Task card:
```text
Step count 3000
30 min • Medium energy
Habit • Daily
Priority ●●●○○
```

Natural-language capture:
```text
"Study LangChain for an hour tomorrow morning"
→ structured task
```

Ambiguous tasks enter AI Inbox for clarification.

## 5. Plan
Purpose: create a feasible proposed schedule.

Inputs:
- available time
- priorities
- deadlines
- energy windows
- planning style
- break rules
- focus block limits

Generation pipeline:
```text
Load context
→ normalize tasks
→ build availability
→ apply hard constraints
→ score tasks
→ generate candidate schedule
→ validate
→ calculate quality
→ editable proposal
→ approve
```

## 6. Today
Purpose: execution.

Priority hierarchy:
1. NOW
2. NEXT
3. LATER
4. Progress
5. Replan

Example:
```text
NOW
AI Engineering
8:30–10:00
42 min remaining
████████████░░
[ Continue ]
```

Timeline block types:
- task
- break
- transition
- buffer
- open

Never label a huge free interval as a "Rest Buffer"; use Open/Available Time.

## 7. Domain Model
```ts
interface Task {
  id: string;
  userId: string;
  title: string;
  description?: string;
  categoryId: string;
  estimatedMinutes: number;
  priority: number;
  urgency: number;
  importance: number;
  energy: "low" | "medium" | "high";
  focusRequired: boolean;
  type: "one_time" | "habit";
  recurrence?: RecurrenceRule;
  deadline?: string;
  earliestStart?: string;
  latestStart?: string;
  status: "inbox" | "ready" | "scheduled" | "active" |
          "completed" | "skipped" | "snoozed" | "archived";
}
```

```ts
interface ScheduleBlock {
  id: string;
  planId: string;
  start: string;
  end: string;
  type: "task" | "break" | "transition" | "buffer" | "open";
  taskId?: string;
  status: "scheduled" | "active" | "completed" |
          "skipped" | "rescheduled";
  source: "manual" | "planner" | "replanner";
  locked: boolean;
}
```

```ts
interface DailyPlan {
  id: string;
  userId: string;
  date: string;
  timezone: string;
  version: number;
  status: "draft" | "approved" | "active" | "completed";
  blocks: ScheduleBlock[];
  plannedFocusMinutes: number;
  plannedTaskMinutes: number;
}
```

## 8. Scheduling Engine
### Hard constraints
- no overlaps
- respect fixed commitments
- respect earliest/latest windows
- dependencies
- deadlines
- protected personal/sleep windows
- max focus block

### Soft constraints
- priority
- energy fit
- deadline fit
- context continuity
- user preferences
- completion probability

Baseline score:
```text
0.30 priority
+ 0.20 urgency
+ 0.15 energy fit
+ 0.10 deadline fit
+ 0.10 context continuity
+ 0.05 preference fit
+ 0.10 completion probability
```

## 9. Adaptive Replanning
Triggers:
- skipped task
- task overrun
- urgent task
- changed fixed event
- explicit replan
- energy change

Contract:
```ts
replan({
  planId,
  effectiveFrom,
  preserveCompleted: true,
  preserveStarted: true,
  preserveLockedBlocks: true,
  strategy: "remaining_day"
})
```

Only affected future blocks should normally change.

## 10. AI Architecture
AI:
- task extraction
- decomposition
- estimation suggestions
- explanation
- alternatives
- reflection

Non-AI:
- conflicts
- time arithmetic
- constraints
- auth
- persistence
- versioning
- transactional writes

Architecture:
```text
Mobile
  ↓
API
  ├── Task Service
  ├── Planning Service
  ├── Activity Service
  └── AI Gateway
        ↓
      LLM
```

## 11. API
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/tasks` | Create |
| GET | `/v1/tasks` | List/search |
| PATCH | `/v1/tasks/:id` | Update |
| POST | `/v1/tasks/extract` | AI extraction |
| POST | `/v1/plans/generate` | Generate proposal |
| GET | `/v1/plans/:date` | Active plan |
| POST | `/v1/plans/:id/approve` | Approve |
| POST | `/v1/plans/:id/replan` | Replan |
| POST | `/v1/blocks/:id/start` | Start |
| POST | `/v1/blocks/:id/complete` | Complete |
| POST | `/v1/blocks/:id/skip` | Skip |
| POST | `/v1/daily-feedback` | Reflection |

## 12. Database
Recommended:
- PostgreSQL durable state
- Redis queues/cache
- worker for reminders/AI reflection/calendar sync

Core tables:
`users`, `planning_profiles`, `categories`, `tasks`, `task_dependencies`, `availability_windows`, `daily_plans`, `schedule_blocks`, `plan_events`, `daily_feedback`, `ai_runs`.

## 13. State Machines
Task:
```text
INBOX → READY → SCHEDULED → ACTIVE
                         ├→ COMPLETED
                         ├→ SKIPPED
                         └→ READY
```

Plan:
```text
DRAFT → APPROVED → ACTIVE → COMPLETED
ACTIVE → REPLANNED → ACTIVE
```

## 14. Events
- `task.created`
- `task.updated`
- `task.scheduled`
- `task.started`
- `task.completed`
- `task.skipped`
- `plan.generated`
- `plan.approved`
- `plan.replanned`
- `feedback.submitted`

## 15. Learning Layer
Capture:
- estimated vs actual duration
- completion by time of day
- completion by energy
- skip/snooze frequency
- context switching
- focus block preference
- carry-over frequency
- habit adherence

Do not silently rewrite user data based on weak evidence.

## 16. Security
- per-user authorization
- minimum AI context
- schema validation
- no arbitrary LLM database writes
- idempotency keys
- plan versioning
- audit trail
- encrypted transport/backups
- deterministic fallback

## 17. Testing
Critical:
- no schedule overlaps
- completed tasks preserved
- locked blocks preserved
- AI failure fallback
- malformed AI output rejected
- duplicate approval idempotent
- skipped task replans safely
- timezone correctness

## 18. MVP
### Must
- Bucket CRUD
- natural-language capture
- availability
- deterministic scheduler
- plan proposal/approval
- Today timeline
- start/complete/skip
- remaining-day replan
- versioning
- basic analytics

### Later
- calendar sync
- voice capture
- email/WhatsApp capture
- long-term goals
- advanced personalization
- collaboration

## 19. North Star
> **The planner should make the user's next decision easier.**

The product is not a prettier task manager. It is an adaptive planning system that turns intentions into a realistic plan, helps execute it, learns from what happened, and improves the next plan.

## Reference architecture note
Current AI-planning products and open implementations similarly emphasize capacity/priorities/deadlines, deterministic scheduling, reviewable proposals, and adaptive replanning. See the cited sources in the companion specification.
