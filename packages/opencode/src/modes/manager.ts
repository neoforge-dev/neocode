import type {
  Mode,
  ModeContext,
  ModeTransition,
  ModeManager,
  ModePromptStrategy,
} from "./types"
import { MODE_PROMPTS } from "./types"
import type { ModeStorage } from "./storage"
import { SQLiteModeStorage } from "./storage"

export class DefaultModeManager implements ModeManager {
  private currentContext: ModeContext | null = null
  private storage: ModeStorage
  private subscribers: Set<(transition: ModeTransition) => void> = new Set()

  constructor(storage?: ModeStorage) {
    this.storage = storage || new SQLiteModeStorage(":memory:")
  }

  async initialize(sessionId: string): Promise<void> {
    if (this.storage instanceof SQLiteModeStorage) {
      await this.storage.initialize()
    }

    // Load existing context or create default
    this.currentContext = await this.storage.getModeContext(sessionId)

    if (!this.currentContext) {
      this.currentContext = {
        mode: "code", // Default to code mode
        sessionId,
        metadata: {},
        timestamp: new Date(),
      }
      await this.storage.setModeContext(this.currentContext)
    }
  }

  getCurrentMode(): Mode {
    return this.currentContext?.mode || "code"
  }

  async switchMode(
    mode: Mode,
    reason = "User requested",
    triggeredBy: "user" | "auto" | "suggestion" = "user",
  ): Promise<void> {
    if (!this.currentContext) {
      throw new Error("Mode manager not initialized")
    }

    const previousMode = this.currentContext.mode

    if (previousMode === mode) {
      return // No change needed
    }

    // Create transition
    const transition: ModeTransition = {
      from: previousMode,
      to: mode,
      reason,
      triggeredBy,
      timestamp: new Date(),
    }

    // Update context
    this.currentContext = {
      ...this.currentContext,
      mode,
      timestamp: new Date(),
    }

    // Persist changes
    await this.storage.setModeContext(this.currentContext)
    await this.storage.logTransition({
      ...transition,
      sessionId: this.currentContext.sessionId,
    })

    // Notify subscribers
    this.notifySubscribers(transition)
  }

  getModeContext(): ModeContext {
    if (!this.currentContext) {
      throw new Error("Mode manager not initialized")
    }
    return { ...this.currentContext }
  }

  suggestModeSwitch(input: string): Mode | null {
    const currentMode = this.getCurrentMode()
    const lowerInput = input.toLowerCase()

    // Keywords that suggest planning mode
    const planKeywords = [
      "plan",
      "strategy",
      "approach",
      "architecture",
      "design",
      "roadmap",
      "requirements",
      "breakdown",
      "steps",
      "organize",
      "structure",
      "outline",
      "spec",
      "specification",
      "analysis",
    ]

    // Keywords that suggest coding mode
    const codeKeywords = [
      "implement",
      "code",
      "write",
      "build",
      "create",
      "develop",
      "fix",
      "debug",
      "optimize",
      "refactor",
      "test",
      "deploy",
      "function",
      "class",
      "method",
      "variable",
      "bug",
      "error",
    ]

    const planScore = planKeywords.reduce((score, keyword) => {
      return score + (lowerInput.includes(keyword) ? 1 : 0)
    }, 0)

    const codeScore = codeKeywords.reduce((score, keyword) => {
      return score + (lowerInput.includes(keyword) ? 1 : 0)
    }, 0)

    // Only suggest if there's a clear preference and it's different from current
    if (planScore > codeScore && planScore >= 2 && currentMode !== "plan") {
      return "plan"
    }

    if (codeScore > planScore && codeScore >= 2 && currentMode !== "code") {
      return "code"
    }

    return null
  }

  getPromptStrategy(mode: Mode): ModePromptStrategy {
    return MODE_PROMPTS[mode]
  }

  subscribeToModeChanges(
    callback: (transition: ModeTransition) => void,
  ): () => void {
    this.subscribers.add(callback)

    return () => {
      this.subscribers.delete(callback)
    }
  }

  private notifySubscribers(transition: ModeTransition): void {
    for (const callback of this.subscribers) {
      try {
        callback(transition)
      } catch (error) {
        console.error("Error in mode change callback:", error)
      }
    }
  }

  async getTransitionHistory(limit?: number): Promise<ModeTransition[]> {
    if (!this.currentContext) {
      return []
    }
    return this.storage.getTransitionHistory(
      this.currentContext.sessionId,
      limit,
    )
  }

  async close(): Promise<void> {
    await this.storage.close()
  }
}

// Session-aware manager instances
const sessionManagers: Map<string, DefaultModeManager> = new Map()

export async function getModeManager(
  sessionId?: string,
): Promise<DefaultModeManager> {
  if (!sessionId) {
    throw new Error("sessionId is required for mode manager")
  }

  let manager = sessionManagers.get(sessionId)
  if (!manager) {
    const dbPath = process.env["OPENCODE_DB_PATH"] || ":memory:"
    manager = new DefaultModeManager(new SQLiteModeStorage(dbPath))
    await manager.initialize(sessionId)
    sessionManagers.set(sessionId, manager)
  }

  return manager
}

// Test helper to reset singleton
export function resetModeManager(): void {
  sessionManagers.clear()
}
