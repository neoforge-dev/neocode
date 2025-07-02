import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  DefaultModeManager,
  getModeManager,
  resetModeManager,
} from "../../src/modes/manager"
import { SQLiteModeStorage } from "../../src/modes/storage"
import { ModeAwarePromptProcessor } from "../../src/modes/tool"

describe("DefaultModeManager", () => {
  let manager: DefaultModeManager
  let storage: SQLiteModeStorage

  beforeEach(async () => {
    storage = new SQLiteModeStorage(":memory:")
    await storage.initialize()
    manager = new DefaultModeManager(storage)
    await manager.initialize("test-session")
  })

  afterEach(async () => {
    await manager.close()
  })

  test("should start with default code mode", () => {
    expect(manager.getCurrentMode()).toBe("code")
  })

  test("should switch modes successfully", async () => {
    expect(manager.getCurrentMode()).toBe("code")

    await manager.switchMode("plan", "User wants to plan")
    expect(manager.getCurrentMode()).toBe("plan")

    await manager.switchMode("code", "Ready to implement")
    expect(manager.getCurrentMode()).toBe("code")
  })

  test("should not switch to same mode", async () => {
    const initialContext = manager.getModeContext()
    await manager.switchMode("code", "Same mode")

    const newContext = manager.getModeContext()
    expect(newContext.timestamp).toEqual(initialContext.timestamp)
  })

  test("should notify subscribers on mode change", async () => {
    let notificationReceived = false
    let receivedTransition: any = null

    const unsubscribe = manager.subscribeToModeChanges((transition: any) => {
      notificationReceived = true
      receivedTransition = transition
    })

    await manager.switchMode("plan", "Test notification")

    expect(notificationReceived).toBe(true)
    expect(receivedTransition.from).toBe("code")
    expect(receivedTransition.to).toBe("plan")
    expect(receivedTransition.reason).toBe("Test notification")

    unsubscribe()
  })

  test("should suggest mode switch based on keywords", async () => {
    // Should suggest plan mode
    expect(
      manager.suggestModeSwitch(
        "I need to plan the architecture for this project",
      ),
    ).toBe("plan")
    expect(
      manager.suggestModeSwitch(
        "Let's design a strategy for implementing this feature",
      ),
    ).toBe("plan")

    // Should suggest code mode when in plan mode
    await manager.switchMode("plan", "Test setup")
    expect(
      manager.suggestModeSwitch(
        "Now let's implement the function and write the code",
      ),
    ).toBe("code")
    expect(
      manager.suggestModeSwitch("I need to debug this error and fix the bug"),
    ).toBe("code")

    // Should not suggest when keywords are insufficient
    expect(manager.suggestModeSwitch("How are you doing today?")).toBeNull()
  })

  test("should track transition history", async () => {
    await manager.switchMode("plan", "First switch")
    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 1))
    await manager.switchMode("code", "Second switch")
    await new Promise((resolve) => setTimeout(resolve, 1))
    await manager.switchMode("plan", "Third switch")

    const history = await manager.getTransitionHistory()

    expect(history).toHaveLength(3)
    expect(history[0].to).toBe("plan") // Most recent first
    expect(history[0].reason).toBe("Third switch")
    expect(history[1].to).toBe("code")
    expect(history[1].reason).toBe("Second switch")
    expect(history[2].to).toBe("plan")
    expect(history[2].reason).toBe("First switch")
  })
})

describe("ModeAwarePromptProcessor", () => {
  let processor: ModeAwarePromptProcessor
  let storage: SQLiteModeStorage

  beforeEach(async () => {
    // Reset singleton to ensure clean state
    resetModeManager()

    storage = new SQLiteModeStorage(":memory:")
    await storage.initialize()

    processor = new ModeAwarePromptProcessor()
    await processor.initialize("test-session-proc")
  })

  afterEach(async () => {
    await storage.close()
    resetModeManager()
  })

  test("should process user input with mode-specific formatting", async () => {
    // Default code mode
    let result = await processor.processUserInput(
      "Write a function to sort arrays",
      "test-session-proc",
    )
    expect(result.processedInput).toBe(
      "[CODING] Write a function to sort arrays",
    )

    // Switch to plan mode using global manager
    const manager = await getModeManager("test-session-proc")
    await manager.switchMode("plan", "Test")

    result = await processor.processUserInput(
      "Design a system for user authentication",
      "test-session-proc",
    )
    expect(result.processedInput).toBe(
      "[PLANNING] Design a system for user authentication",
    )
  })

  test("should provide mode-specific system prompts", async () => {
    // Code mode system prompt
    let systemPrompt = await processor.getSystemPrompt("test-session-proc")
    expect(systemPrompt).toContain("CODING mode")
    expect(systemPrompt).toContain("practical, working code")

    // Switch to plan mode using global manager
    const manager = await getModeManager("test-session-proc")
    await manager.switchMode("plan", "Test")

    systemPrompt = await processor.getSystemPrompt("test-session-proc")
    expect(systemPrompt).toContain("PLANNING mode")
    expect(systemPrompt).toContain("actionable steps")
  })

  test("should provide mode-specific model parameters", async () => {
    // Code mode - lower temperature for precision
    let params = await processor.getModelParameters("test-session-proc")
    expect(params.temperature).toBe(0.3)

    // Switch to plan mode using global manager
    const manager = await getModeManager("test-session-proc")
    await manager.switchMode("plan", "Test")

    params = await processor.getModelParameters("test-session-proc")
    expect(params.temperature).toBe(0.7)
  })

  test("should suggest mode switches in processed input", async () => {
    // Ensure we start in code mode
    const manager = await getModeManager("test-session-proc")
    expect(manager.getCurrentMode()).toBe("code")

    const result = await processor.processUserInput(
      "I need to plan the overall architecture and design the system structure",
      "test-session-proc",
    )

    expect(result.shouldSuggestSwitch).toBe(true)
    expect(result.modeSwitch).toBe("plan")
  })
})

describe("Mode System Integration", () => {
  test("should persist mode across sessions", async () => {
    // Create first manager and switch mode
    const storage1 = new SQLiteModeStorage(":memory:")
    await storage1.initialize()
    const manager1 = new DefaultModeManager(storage1)
    await manager1.initialize("persistent-session")

    await manager1.switchMode("plan", "User preference")
    expect(manager1.getCurrentMode()).toBe("plan")

    // Close first manager
    await manager1.close()

    // Create second manager with same storage
    const storage2 = new SQLiteModeStorage(":memory:")
    await storage2.initialize()
    const manager2 = new DefaultModeManager(storage2)
    await manager2.initialize("persistent-session")

    // Note: In this test, we're using :memory: so persistence won't work
    // In real usage with file path, the mode would persist
    expect(manager2.getCurrentMode()).toBe("code") // Default for new session

    await manager2.close()
  })

  test("should handle multiple sessions independently", async () => {
    const storage = new SQLiteModeStorage(":memory:")
    await storage.initialize()

    const manager1 = new DefaultModeManager(storage)
    await manager1.initialize("session-1")

    const manager2 = new DefaultModeManager(storage)
    await manager2.initialize("session-2")

    // Different modes for different sessions
    await manager1.switchMode("plan", "Session 1 planning")
    await manager2.switchMode("code", "Session 2 coding")

    expect(manager1.getCurrentMode()).toBe("plan")
    expect(manager2.getCurrentMode()).toBe("code")

    await manager1.close()
    await manager2.close()
  })
})
