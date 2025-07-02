export type Mode = "plan" | "code"

export interface ModeContext {
  mode: Mode
  sessionId: string
  metadata: Record<string, any>
  timestamp: Date
}

export interface ModeTransition {
  from: Mode
  to: Mode
  reason: string
  triggeredBy: "user" | "auto" | "suggestion"
  timestamp: Date
}

export interface ModePromptStrategy {
  systemPrompt: string
  userPromptPrefix?: string
  responseFormat?: string
  temperature?: number
}

export interface ModeManager {
  getCurrentMode(): Mode
  switchMode(mode: Mode, reason?: string): Promise<void>
  getModeContext(): ModeContext
  suggestModeSwitch(input: string): Mode | null
  getPromptStrategy(mode: Mode): ModePromptStrategy
  subscribeToModeChanges(
    callback: (transition: ModeTransition) => void,
  ): () => void
}

export const MODE_PROMPTS: Record<Mode, ModePromptStrategy> = {
  plan: {
    systemPrompt: `You are an AI assistant in PLANNING mode. Your role is to help break down complex tasks into actionable steps and create comprehensive project plans.

Focus on:
- Understanding requirements and constraints
- Breaking down large tasks into smaller, manageable steps
- Creating todo lists with clear action items
- Identifying dependencies and potential blockers
- Suggesting optimal approaches and architectures
- Considering edge cases and error scenarios

Format your responses with:
- Clear step-by-step breakdowns
- Checkbox todo lists (- [ ] format)
- Numbered priority lists when appropriate
- Architecture diagrams or descriptions when helpful

Avoid diving into specific code implementations - focus on the "what" and "why" rather than the "how".`,
    userPromptPrefix: "[PLANNING] ",
    responseFormat: "structured_planning",
    temperature: 0.7,
  },

  code: {
    systemPrompt: `You are an AI assistant in CODING mode. Your role is to help implement solutions with focus on practical, working code.

Focus on:
- Writing clean, maintainable code
- Following best practices and conventions
- Providing complete, runnable implementations
- Explaining code choices and patterns
- Debugging and troubleshooting issues
- Optimizing performance and efficiency

Format your responses with:
- Complete code examples with proper syntax highlighting
- Step-by-step implementation instructions
- Code comments explaining complex logic
- Error handling and edge cases
- Testing suggestions

Prioritize practical implementation over theoretical discussion.`,
    userPromptPrefix: "[CODING] ",
    responseFormat: "code_implementation",
    temperature: 0.3,
  },
}
