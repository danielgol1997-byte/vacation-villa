import type { Page, Request } from "@playwright/test";

/**
 * Minimal test seed — small enough to keep selectors unambiguous, but
 * rich enough to cover the assignee-color, multi-person, and pre-seeded
 * assignee cases.
 */
export const TEST_SEED = {
  tasks: [
    {
      id: "t-shop",
      title: "רשימת קניות",
      needed: 1,
      assignees: [] as string[],
      day: "לפני" as const,
      notes: "",
      checklist: [],
      completed: false,
    },
    {
      id: "t-grill",
      title: "מנגל - בשר",
      needed: 2,
      assignees: ["הדסה"] as string[],
      day: "חמישי" as const,
      notes: "להזמין מראש.",
      checklist: [
        { id: "i1", text: "פרגיות", done: false },
        { id: "i2", text: "המבורגרים", done: true },
      ],
      completed: false,
    },
    {
      id: "t-cleanup",
      title: "סידור הבית",
      needed: 1,
      assignees: [] as string[],
      day: "ראשון" as const,
      notes: "",
      checklist: [],
      completed: false,
    },
  ],
  planItems: [
    {
      id: "p-grill",
      day: "חמישי" as const,
      title: "מנגל",
      startTime: "17:00",
      location: "בוילה",
    },
    {
      id: "p-walk",
      day: "שישי" as const,
      title: "טיול בוקר",
    },
  ],
  members: [] as string[],
  memberPrefs: {},
  updatedAt: new Date().toISOString(),
};

/**
 * Reset the dev server's state to a known seed by PUTting it through the
 * normal API path. Returns nothing — assert via UI afterwards.
 */
export async function resetState(
  request: Request | { put: (url: string, opts: { data: unknown }) => Promise<unknown> },
  baseURL: string,
  seed: typeof TEST_SEED = TEST_SEED,
) {
  // playwright passes APIRequestContext; we expect `.put` to be available
  const ctx = request as unknown as {
    put: (url: string, opts: { data: unknown }) => Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>;
  };
  const res = await ctx.put(`${baseURL}/api/state`, { data: seed });
  if (!res.ok()) {
    throw new Error(
      `Failed to reset state: ${res.status()} ${await res.text()}`,
    );
  }
}

/**
 * Drop the localStorage name so the login screen always renders fresh.
 * (Belt-and-suspenders — the app already no longer auto-restores from
 * localStorage on boot, but tests shouldn't depend on that detail.)
 */
export async function freshLogin(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("vacation-name");
    } catch {
      // ignore (SSR / private browsing edge cases)
    }
  });
}
