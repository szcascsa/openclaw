import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  resolveMainSessionKeyFromConfig: vi.fn(() => "agent:main:main"),
  getLastHeartbeatEvent: vi.fn(() => null),
  setHeartbeatsEnabled: vi.fn(),
  requestHeartbeatNow: vi.fn(),
  enqueueSystemEvent: vi.fn(),
  isSystemEventContextChanged: vi.fn(() => false),
  listSystemPresence: vi.fn(() => []),
  updateSystemPresence: vi.fn(() => ({
    next: {},
    changedKeys: [],
    key: "presence:key",
  })),
  broadcastPresenceSnapshot: vi.fn(),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveMainSessionKeyFromConfig: mocks.resolveMainSessionKeyFromConfig,
}));

vi.mock("../../infra/heartbeat-events.js", () => ({
  getLastHeartbeatEvent: mocks.getLastHeartbeatEvent,
}));

vi.mock("../../infra/heartbeat-runner.js", () => ({
  setHeartbeatsEnabled: mocks.setHeartbeatsEnabled,
}));

vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: mocks.requestHeartbeatNow,
}));

vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: mocks.enqueueSystemEvent,
  isSystemEventContextChanged: mocks.isSystemEventContextChanged,
}));

vi.mock("../../infra/system-presence.js", () => ({
  listSystemPresence: mocks.listSystemPresence,
  updateSystemPresence: mocks.updateSystemPresence,
}));

vi.mock("../server/presence-events.js", () => ({
  broadcastPresenceSnapshot: mocks.broadcastPresenceSnapshot,
}));

import { systemHandlers } from "./system.js";

function createContext(): GatewayRequestContext {
  return {
    broadcast: vi.fn(),
    incrementPresenceVersion: () => 1,
    getHealthVersion: () => 1,
  } as unknown as GatewayRequestContext;
}

async function invokeSystemEvent(params: Record<string, unknown>) {
  const respond = vi.fn();
  await systemHandlers["system-event"]({
    params: params as never,
    respond,
    context: createContext(),
    req: { type: "req", id: "system-event-test", method: "system-event" },
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("systemHandlers.system-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveMainSessionKeyFromConfig.mockReturnValue("agent:main:main");
    mocks.updateSystemPresence.mockReturnValue({
      next: {},
      changedKeys: [],
      key: "presence:key",
    });
    mocks.isSystemEventContextChanged.mockReturnValue(false);
  });

  it("enqueues non-node text and requests an immediate system-event wake", async () => {
    const respond = await invokeSystemEvent({ text: "Run health checks now." });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith("Run health checks now.", {
      sessionKey: "agent:main:main",
    });
    expect(mocks.requestHeartbeatNow).toHaveBeenCalledWith({
      reason: "system-event",
      sessionKey: "agent:main:main",
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("does not enqueue or wake when text is empty", async () => {
    const respond = await invokeSystemEvent({ text: "   " });

    expect(mocks.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(mocks.requestHeartbeatNow).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "text required" }),
    );
  });

  it("does not wake when node presence input produces no queued delta", async () => {
    mocks.updateSystemPresence.mockReturnValue({
      next: { host: "node-a", ip: "10.0.0.10", reason: "periodic" },
      changedKeys: [],
      key: "presence:node-a",
    });

    const respond = await invokeSystemEvent({ text: "Node: node-a", reason: "periodic" });

    expect(mocks.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(mocks.requestHeartbeatNow).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("queues node presence deltas and wakes immediately", async () => {
    mocks.updateSystemPresence.mockReturnValue({
      next: {
        host: "node-a",
        ip: "10.0.0.10",
        version: "2026.2.26",
        mode: "local",
        reason: "manual",
      },
      changedKeys: ["host", "version"],
      key: "presence:node-a",
    });
    mocks.isSystemEventContextChanged.mockReturnValue(true);

    await invokeSystemEvent({ text: "Node: node-a", reason: "manual" });

    expect(mocks.enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("Node: node-a"),
      {
        sessionKey: "agent:main:main",
        contextKey: "presence:node-a",
      },
    );
    expect(mocks.requestHeartbeatNow).toHaveBeenCalledWith({
      reason: "system-event",
      sessionKey: "agent:main:main",
    });
  });
});

