export const LOOP_SKILL = {
  id: "pstack-loop",
  name: "loop",
  description:
    "Run a pstack task on an OpenCode schedule until a predicate passes. Use for /loop, 'keep checking', or an overnight run.",
  source: "adapter/loop/SKILL.md",
  autoinvoke: false,
  content: `# Loop

Run a task on a schedule until a predicate passes. On OpenCode this is an automation.

1. Confirm three things: the interval, the task, and the pass-or-fail predicate.
2. Create the automation with the automation tool.
   - trigger: \`{ "type": "every", "every": "<interval>" }\`, or a \`cron\` trigger for a wall-clock schedule.
   - action: \`{ "type": "prompt", "to": { "session": "<current session id>" }, "prompt": "<task>. Check: <predicate>. If it passes, delete this automation and report the result. Otherwise continue." }\`
3. Report the automation id, the interval, and how to stop it. Do not sleep, poll, or duplicate the scheduled work.

Stop the automation with the automation tool's delete action when the predicate passes or the user asks.
`,
}

export const LOOP_COMMAND = {
  name: "loop",
  description: LOOP_SKILL.description,
  skillId: LOOP_SKILL.id,
}
