# BetterDay questionnaire draft

## Welcome

**Let's make room for a better day.**

Tell us about your usual week and what you'd like more time for. We'll suggest a routine you can adjust.

For this version, your answers and schedule are saved in this browser on this device.

Button: **Get started**

## Step 1 of 4: Your day

### When do you usually wake up and go to bed?

- Wake-up time: time field, required.
- Bedtime: time field, required.
- **Same every day** selected by default.
- Optional link: **My times vary by day**. Opens day-specific overrides without making users re-enter unchanged days.

Helper text: Use the routine you want to plan around. You can change these times later.

Button: **Next: Commitments**

## Step 2 of 4: Your commitments

### What is already on your calendar?

Helper text: Add classes, work, appointments, or other regular commitments. Include travel time in the block or add it separately.

Each commitment has:

- Name: short text, required.
- Days: Monday through Sunday buttons; select one or more.
- Start and end: time fields, required.
- Remove action.

Button: **Add a commitment**

Allow users to continue with no commitments using **I don't have any yet**.

Buttons: **Back**, **Next: Make time**

## Step 3 of 4: Make time for you

### What would you like to make time for?

Helper text: Choose up to three activities to start.

Choices:

- Studying or focused work
- Movement or exercise
- A hobby or personal project
- Rest and relaxation
- Something else: short text

Allow a custom activity to be added more than once with different names.

For each selected activity, show only:

- **How long each time?** 15 / 30 / 45 / 60 minutes / Other.
- **How many times per week?** 1-7 sessions.
- **When works best?** No preference / Morning / Afternoon / Evening.
- Optional **Choose available days**: all days allowed by default. Day selection is a strict limit; time of day is a preference.

Helper text: Put your most important activity first. We'll try to fit activities in that order.

Provide accessible **Move up** and **Move down** controls when multiple activities are selected. Require at least one activity to generate a schedule.

### What is your biggest scheduling challenge? (Optional)

Choose one, or skip:

- Fitting everything in
- Keeping a consistent routine
- Making time to recharge

Use this answer for a brief, relevant recommendation beside the schedule. It should not silently add activities or change the user's requested times.

Buttons: **Back**, **Next: Review**

## Step 4 of 4: Review your week

**Does this look right?**

Show a compact summary of:

- Wake-up and bedtime, including day-specific changes.
- Fixed commitments.
- Activities in priority order, with duration, weekly frequency, available days, and time preference.
- Scheduling challenge, if answered.

Each section has an **Edit** action that preserves the other answers.

Helper text: We'll keep your commitments in place, leave some time open, and suggest times for your activities. If something cannot fit, we'll show you.

Buttons: **Back**, **Create my schedule**

## First version behavior

- Plan a repeating Monday-Sunday week. Specific dates, calendar imports, and accounts can come later.
- Treat sleep as unavailable time, including sleep that crosses midnight. Do not prescribe sleep duration.
- Validate conflicting fixed commitments before generation and explain which entries overlap. Flag commitments that conflict with sleep for review.
- Do not overlap activities, place them in sleep, or silently shorten requested sessions. Preserve fixed commitments.
- Use activity order as the initial priority. Treat available days as strict limits and preferred time of day as a preference. Explain placements outside a preferred window.
- Start with a visible default of 10-minute transition gaps around suggested activities where they meet other events. Leave unused time unfilled. The gap is a product default, not a health recommendation.
- Show unmet requests, for example: **1 of your 3 study sessions couldn't fit. Try changing your availability or session length.**
- Let users edit answers or adjust suggested blocks after generation, checking adjustments for conflicts.
- Save answers and the resulting schedule on this device. Preserve entered answers when moving between steps.
- Use calming cool greens, clear field labels, visible progress, keyboard-accessible controls, and inline error messages.
- Do not collect account credentials, demographic details, or medical information.
