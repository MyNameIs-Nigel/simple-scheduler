export type McpPromptDefinition = {
  name: string;
  description: string;
  arguments?: {
    name: string;
    description: string;
    required?: boolean;
  }[];
};

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: "daily_agenda",
    description:
      "Generates today's commitments formatted as a clear briefing with priority items, transitions, and free blocks.",
    arguments: [
      {
        name: "date",
        description: "Optional ISO date (defaults to today).",
        required: false,
      },
    ],
  },
  {
    name: "week_ahead",
    description:
      "Generates a seven-day lookahead with shape commentary: heavy days, free study/focus blocks, and potential collisions.",
    arguments: [
      {
        name: "from",
        description: "Optional ISO start date (defaults to start of current week).",
        required: false,
      },
    ],
  },
  {
    name: "find_time_for",
    description:
      "Guided scheduling assistant prompt: checks conflicts, proposes ideal slots for a planned activity, and prepares options.",
    arguments: [
      {
        name: "activity",
        description: "Description of the activity or event to schedule.",
        required: true,
      },
      {
        name: "durationMinutes",
        description: "Expected duration in minutes (e.g. 60, 90, 120).",
        required: false,
      },
      {
        name: "window",
        description: "Search timeframe ('this week', 'next week', 'tomorrow').",
        required: false,
      },
    ],
  },
];

export function renderPrompt(
  name: string,
  args: Record<string, string> = {},
): {
  description: string;
  messages: {
    role: "user";
    content: {
      type: "text";
      text: string;
    };
  }[];
} {
  if (name === "daily_agenda") {
    const dateArg = args.date ? `for ${args.date}` : "for today";
    return {
      description: "Daily agenda briefing",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please give me my daily agenda briefing ${dateArg}. First call get_agenda with window='today' (or the specified date). Summarize my commitments chronologically, highlighting early morning starts, tight transitions, any mirrored work shifts, and open windows for focus.`,
          },
        },
      ],
    };
  }

  if (name === "week_ahead") {
    const fromArg = args.from ? `starting ${args.from}` : "for the coming week";
    return {
      description: "Week ahead schedule overview",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please provide a week-ahead overview ${fromArg}. Use summarize_schedule to check the workload shape, then get_agenda with window='this week' or 'next week' to identify the heaviest days, key deadlines, long unbroken focus blocks, and any schedule risks.`,
          },
        },
      ],
    };
  }

  if (name === "find_time_for") {
    const activity = args.activity || "an activity";
    const duration = args.durationMinutes ? `${args.durationMinutes} minutes` : "1 hour";
    const window = args.window || "this week";
    return {
      description: `Guided scheduling for: ${activity}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I need to find time for "${activity}" (approx. ${duration}) during ${window}. Please call find_free_time with durationMinutes=${args.durationMinutes || 60} and window='${window}'. Evaluate the suggested slots, check for conflicts if a specific time looks best, and recommend 2-3 optimal times.`,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
}
