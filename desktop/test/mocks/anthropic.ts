/**
 * Mock Anthropic provider for integration tests.
 * Returns canned responses tied to prompt class keywords.
 */

import { vi } from "vitest";

export type MockResponse =
  | { ok: true; value: string }
  | { ok: false; error: { kind: string; cause?: unknown } };

export function buildAnthropicMock(responses?: Map<string, MockResponse>) {
  const defaultResponses: Map<string, MockResponse> = responses ?? new Map([
    [
      "triage_cleanup",
      {
        ok: true,
        value: JSON.stringify({
          type: "task",
          title: "Take car in for service",
          dueDate: "Friday",
          nextAction: "Call the dealership to book",
        }),
      },
    ],
    [
      "make_startable",
      {
        ok: true,
        value: JSON.stringify({
          firstStep: "Open last year's proposal doc",
          steps: ["List 5 key changes needed", "Block 90 min on calendar"],
        }),
      },
    ],
    [
      "brain_dump_split",
      {
        ok: true,
        value: JSON.stringify({
          tasks: [
            { title: "Buy groceries" },
            { title: "Call dentist for appointment" },
            { title: "Reply to Sarah's email" },
            { title: "Take car for oil change" },
          ],
        }),
      },
    ],
  ]);

  const mockComplete = vi.fn(async (system: string, _user: string): Promise<MockResponse> => {
    // Detect action from system prompt keywords
    for (const [key, resp] of defaultResponses) {
      if (system.toLowerCase().includes(key.replace(/_/g, " ")) || system.toLowerCase().includes(key)) {
        return resp;
      }
    }
    return { ok: true, value: '{"title":"Untitled"}' };
  });

  return { mockComplete };
}

export const MOCK_401_RESPONSE: MockResponse = {
  ok: false,
  error: { kind: "auth" },
};

export const MOCK_429_RESPONSE: MockResponse = {
  ok: false,
  error: { kind: "quota" },
};

export const MOCK_TIMEOUT_RESPONSE: MockResponse = {
  ok: false,
  error: { kind: "timeout" },
};

export const MOCK_NETWORK_RESPONSE: MockResponse = {
  ok: false,
  error: { kind: "network" },
};
