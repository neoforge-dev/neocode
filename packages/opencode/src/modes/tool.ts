import { Tool } from "../tool/tool"
import { z } from "zod"
import { getModeManager } from "./manager"
import type { Mode } from "./types"

/**
 * ModeTool - Tool for switching between plan and code modes
 */
export const ModeTool = Tool.define({
  id: "mode",
  description: "Switch between plan and code modes",
  parameters: z.object({
    action: z
      .enum(["switch", "status", "suggest", "history"])
      .describe("Mode action to perform"),
    mode: z
      .enum(["plan", "code"])
      .optional()
      .describe("Target mode for switch action"),
    input: z
      .string()
      .optional()
      .describe("Input text for mode suggestion analysis"),
  }),
  async execute(params, ctx) {
    const modeManager = await getModeManager(ctx.sessionID)

    switch (params.action) {
      case "switch":
        if (!params.mode) {
          throw new Error("Mode parameter required for switch action")
        }

        const currentMode = modeManager.getCurrentMode()
        if (currentMode === params.mode) {
          return {
            metadata: { title: "Mode Status" },
            output: `Already in ${params.mode} mode`,
          }
        }

        await modeManager.switchMode(params.mode, "User requested via command")

        const strategy = modeManager.getPromptStrategy(params.mode)

        return {
          metadata: { title: "Mode Switched" },
          output: `Switched to ${params.mode.toUpperCase()} mode\n\n${strategy.systemPrompt.split("\n")[0]}`,
        }

      case "status":
        const context = modeManager.getModeContext()
        const promptStrategy = modeManager.getPromptStrategy(context.mode)

        return {
          metadata: { title: "Current Mode" },
          output: `Current mode: ${context.mode.toUpperCase()}\n\nMode behavior:\n${promptStrategy.systemPrompt.split("\n\n")[1] || promptStrategy.systemPrompt}`,
        }

      case "suggest":
        if (!params.input) {
          throw new Error("Input parameter required for suggest action")
        }

        const suggestion = modeManager.suggestModeSwitch(params.input)
        const current = modeManager.getCurrentMode()

        if (!suggestion) {
          return {
            metadata: { title: "Mode Suggestion" },
            output: `No mode switch suggested. Current mode (${current.toUpperCase()}) seems appropriate for: "${params.input}"`,
          }
        }

        return {
          metadata: { title: "Mode Suggestion" },
          output: `💡 Consider switching to ${suggestion.toUpperCase()} mode for better results with: "${params.input}"\n\nUse /mode switch ${suggestion} to switch modes.`,
        }

      case "history":
        const transitions = await modeManager.getTransitionHistory(10)

        if (transitions.length === 0) {
          return {
            metadata: { title: "Mode History" },
            output: "No mode transitions recorded yet.",
          }
        }

        const historyText = transitions
          .map(
            (t) =>
              `${t.timestamp.toLocaleString()}: ${t.from} → ${t.to} (${t.reason})`,
          )
          .join("\n")

        return {
          metadata: { title: "Mode History" },
          output: `Recent mode transitions:\n\n${historyText}`,
        }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})

/**
 * Enhanced prompt processor that applies mode-specific formatting
 */
export class ModeAwarePromptProcessor {
  private sessionId?: string

  async initialize(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    // Initialize global manager for this session
    await getModeManager(sessionId)
  }

  async processUserInput(
    input: string,
    sessionId?: string,
  ): Promise<{
    processedInput: string
    modeSwitch?: Mode
    shouldSuggestSwitch?: boolean
  }> {
    const currentSessionId = sessionId || this.sessionId
    if (!currentSessionId) {
      return { processedInput: input }
    }

    const modeManager = await getModeManager(currentSessionId)
    const currentMode = modeManager.getCurrentMode()
    const strategy = modeManager.getPromptStrategy(currentMode)

    // Check for mode switch suggestion
    const suggestedMode = modeManager.suggestModeSwitch(input)

    // Apply mode-specific formatting
    let processedInput = input
    if (strategy.userPromptPrefix) {
      processedInput = strategy.userPromptPrefix + input
    }

    return {
      processedInput,
      modeSwitch: suggestedMode || undefined,
      shouldSuggestSwitch: !!suggestedMode,
    }
  }

  async getSystemPrompt(sessionId?: string): Promise<string> {
    const currentSessionId = sessionId || this.sessionId
    if (!currentSessionId) {
      return ""
    }

    const modeManager = await getModeManager(currentSessionId)
    const currentMode = modeManager.getCurrentMode()
    const strategy = modeManager.getPromptStrategy(currentMode)

    return strategy.systemPrompt
  }

  async getModelParameters(
    sessionId?: string,
  ): Promise<{ temperature?: number }> {
    const currentSessionId = sessionId || this.sessionId
    if (!currentSessionId) {
      return {}
    }

    const modeManager = await getModeManager(currentSessionId)
    const currentMode = modeManager.getCurrentMode()
    const strategy = modeManager.getPromptStrategy(currentMode)

    return {
      temperature: strategy.temperature,
    }
  }

  async close(): Promise<void> {
    // Close is handled by global manager
  }
}

// Singleton processor instance
let globalProcessor: ModeAwarePromptProcessor | null = null

export async function getPromptProcessor(
  sessionId?: string,
): Promise<ModeAwarePromptProcessor> {
  if (!globalProcessor) {
    globalProcessor = new ModeAwarePromptProcessor()
    if (sessionId) {
      await globalProcessor.initialize(sessionId)
    }
  }
  return globalProcessor
}
