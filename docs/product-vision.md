# BetterDay product direction

Confirmed with Matteo on November 1, 2026. This describes the agreed direction; the current deployed prototype still generates a repeating weekly routine.

## Purpose

BetterDay is an active day planner that helps people decide what to do next and adapt their plans as life changes. Dynamic scheduling is the central product direction. The calendar presents the plan, the task list expresses what matters, and the scheduler helps turn intentions into realistic use of the remaining day.

The core question is: **Given what matters to me, what has changed, and the time I have left, what is a useful plan from here?**

## The daily loop

1. Capture fixed commitments and flexible tasks, including priorities and estimated effort.
2. Suggest realistic work sessions around appointments, sleep, and available time.
3. Let the user start work, mark it complete, adjust remaining effort, defer it, or add an interruption.
4. Propose an updated plan for the remaining day and explain what moved or could not fit.
5. Let the user preview and apply changes, with Undo available afterward.

The questionnaire provides initial context. Ongoing use should support returning throughout the day without rebuilding the entire routine each time.

## Tasks and progress

Keep appointments, tasks, and scheduled work sessions distinct. Tasks carry priority and estimated remaining effort, with optional deadlines. Work sessions reserve time to make progress on a task. A session ending does not automatically complete the task.

Completed tasks move to a Completed section, and unused future sessions for them are removed. Partial progress and revised estimates inform replanning. Start with one block per task, then introduce an optional ability to split work into sessions with a minimum useful duration.

## Waking and sleep

Users can describe a usual wake-up range and bedtime range. An explicit “I'm awake” action supplies the actual start of the day and triggers a proposed adjustment of flexible work. This is an extension of the same replanning engine. Automatic sleep detection is outside the initial scope.

Protect sleep and fixed commitments. Waking early can create an opportunity, without an obligation to fill every extra minute. Waking late should produce an honest revised plan and show work that no longer fits. The exact rule for selecting a provisional planning time within a range remains an implementation decision to resolve.

## User control and product principles

- Preview changes, then apply them; preserve Undo.
- Keep past/completed work and fixed commitments anchored unless explicitly changed.
- Make replacement, intentional overlap, and rescheduling distinct choices.
- Preserve one-time versus recurring intent.
- Show unscheduled work and explain tradeoffs; do not silently delete or shorten tasks to make a plan fit.
- Leave breathing room and minimize unnecessary reshuffling.
- Prioritize a clear, dependable planning loop over adding calendar features for their own sake.

## Delivery priorities

First fix the time-selection controls. Then establish dated events and tasks, build “Replan today,” and extend it with wake-up adjustments. Calendar exchange, provider sync, and reminders support this direction. The initial planner can work locally with rule-based scheduling; accounts, a backend, and AI are not prerequisites for proving its value.

Success means a user can add an unexpected commitment, understand the revised plan, and resume a meaningful task without manually rebuilding the day.

## Next product phase: habits, hobbies, and wellness

Matteo identified deeper support for building new habits and hobbies, with wellness integrated into dynamic scheduling, as the next product phase. Finish the currently agreed time-entry and dynamic-scheduling work first. Preserve this direction for subsequent planning; specific wellness features and habit-building mechanics have not yet been defined or approved for implementation.

The intended progression is to build a dependable system for adapting the day, then deepen how that system helps users make room for personal growth and well-being over time.

See [the implementation roadmap](user-testing-roadmap.md) for findings, acceptance checks, dependencies, and integration research.
