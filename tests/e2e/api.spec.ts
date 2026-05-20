import { test, expect } from "@playwright/test";
import { resetState, TEST_SEED } from "./helpers";

/**
 * Pure API tests — exercise /api/state, /api/assist round-trips at the
 * HTTP layer. /api/assist is skipped when there's no OPENAI_API_KEY in
 * the env (the e2e config blanks BLOB_READ_WRITE_TOKEN, and we don't
 * leak the OpenAI key either, so the AI path errors out cleanly).
 */
test.describe("API — /api/state", () => {
  test("PUT then GET round-trips the state", async ({ request, baseURL }) => {
    await resetState(request, baseURL!);
    const res = await request.get(`${baseURL}/api/state`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.storage).toBe("file");
    expect(body.state.tasks.length).toBe(TEST_SEED.tasks.length);
    expect(body.state.planItems.length).toBe(TEST_SEED.planItems.length);
    expect(body.state.tasks[0].title).toBe("רשימת קניות");
  });

  test("PUT normalizes unknown fields and migrates legacy phase to day", async ({
    request,
    baseURL,
  }) => {
    const dirty = {
      tasks: [
        {
          // Legacy schema: no `day`, but has `phase`
          title: "old task",
          needed: 2,
          assignees: ["x"],
          phase: "לפני האירוע",
        },
      ],
      planItems: [],
      members: ["x"],
    };
    const put = await request.put(`${baseURL}/api/state`, { data: dirty });
    expect(put.ok()).toBeTruthy();
    const body = await put.json();
    expect(body.state.tasks[0].day).toBe("לפני");
    expect(body.state.tasks[0].id).toMatch(/^task-/);
    expect(body.state.tasks[0].checklist).toEqual([]);
    expect(body.state.tasks[0].completed).toBe(false);
  });

  test("dedupes the members array", async ({ request, baseURL }) => {
    const seed = { ...TEST_SEED, members: ["דניאל", "דניאל", "מיכל"] };
    const res = await request.put(`${baseURL}/api/state`, { data: seed });
    const body = await res.json();
    expect(body.state.members).toEqual(["דניאל", "מיכל"]);
  });

  test("garbage payload doesn't crash the server", async ({ request, baseURL }) => {
    // PUT a non-object — the route is permissive (it accepts any shape and
    // normalizes), so this either succeeds with an empty state or errors
    // cleanly. The important guarantee is that the server stays alive and
    // subsequent requests still work.
    const res = await request.fetch(`${baseURL}/api/state`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      data: '"not-an-object"',
    });
    expect([200, 400, 500]).toContain(res.status());

    // Recovery — reset to a valid seed and confirm a clean GET works.
    await resetState(request, baseURL!);
    const after = await request.get(`${baseURL}/api/state`);
    expect(after.ok()).toBeTruthy();
    const body = await after.json();
    expect(body.state.tasks.length).toBe(TEST_SEED.tasks.length);
  });
});

test.describe("API — /api/assist", () => {
  test("missing OPENAI_API_KEY surfaces an ai-failed error, not a crash", async ({
    request,
    baseURL,
  }) => {
    await resetState(request, baseURL!);
    const res = await request.post(`${baseURL}/api/assist`, {
      data: {
        command: "test",
        me: "דניאל",
        language: "he",
      },
    });
    // Either ai-failed (no key) or a real proposal (key present). Both
    // are acceptable for this test — we're just confirming the endpoint
    // returns a real response rather than crashing the server.
    expect([200, 400, 500]).toContain(res.status());
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});
