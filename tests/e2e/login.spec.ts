import { test, expect } from "@playwright/test";
import { freshLogin, resetState } from "./helpers";

test.describe("Login flow", () => {
  test.beforeEach(async ({ request, baseURL, page }) => {
    await resetState(request, baseURL!);
    await freshLogin(page);
  });

  test("first visit lands on the picker, not auto-logged-in", async ({ page }) => {
    await page.goto("/");

    // Picker visible
    await expect(page.locator(".login-card h1")).toHaveText("וילה 2026");
    await expect(page.locator(".login-card p").first()).toHaveText("מי את/ה?");

    // Pre-seeded names from tasks (Hadassah is in the test seed) appear as buttons
    await expect(page.locator(".member-grid button.member", { hasText: "הדסה" })).toBeVisible();

    // Add-new affordance is present
    await expect(page.getByRole("button", { name: "+ הוספת שם חדש" })).toBeVisible();

    // Main app shell should NOT be present yet
    await expect(page.locator(".topbar")).toHaveCount(0);
  });

  test("tapping an existing member logs in immediately", async ({ page }) => {
    await page.goto("/");
    await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();

    // Now in the main app, signed in as Hadassah
    await expect(page.locator(".topbar .who")).toContainText("הדסה");
    // Tabs visible
    await expect(page.getByRole("button", { name: "משימות" })).toBeVisible();
    await expect(page.getByRole("button", { name: "שלי" })).toBeVisible();
    await expect(page.getByRole("button", { name: "תכנית" })).toBeVisible();
  });

  test('"+ הוספת שם חדש" with a brand-new name logs that user in', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "+ הוספת שם חדש" }).click();
    await page.locator(".name-form input").fill("יואב");
    await page.getByRole("button", { name: "המשך" }).click();

    await expect(page.locator(".topbar .who")).toContainText("יואב");
  });

  test("fuzzy match prompts for confirmation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "+ הוספת שם חדש" }).click();
    // Hebrew typo of הדסה — single-letter change to trigger fuzzy
    await page.locator(".name-form input").fill("הדסא");
    await page.getByRole("button", { name: "המשך" }).click();

    await expect(page.locator(".prompt p")).toContainText("התכוונת");
    await expect(page.locator(".prompt strong")).toHaveText("הדסה");

    await page.getByRole("button", { name: "כן" }).click();
    await expect(page.locator(".topbar .who")).toContainText("הדסה");
  });

  test("same-name disambiguation appends a suffix", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "+ הוספת שם חדש" }).click();
    await page.locator(".name-form input").fill("הדסה");
    await page.getByRole("button", { name: "המשך" }).click();

    // Exact-match prompt: "X כבר רשום/ה" with two choices
    await expect(page.locator(".prompt strong")).toHaveText("הדסה");

    await page.getByRole("button", { name: /אני הדסה אחר/ }).click();

    // Distinguish stage — input for the suffix
    await expect(page.locator(".prompt p")).toContainText("הוסיפי שם משפחה");

    await page.locator(".name-form input").fill("ל'");
    await page.locator(".name-form button[type=submit]").click();

    await expect(page.locator(".topbar .who")).toContainText("הדסה ל'");
  });

  test("reload after login does NOT auto-restore — picker shows again", async ({ page }) => {
    await page.goto("/");
    await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();
    await expect(page.locator(".topbar .who")).toContainText("הדסה");

    // Hard reload — should land back on picker because the app no longer
    // reads localStorage to auto-login (shared-device safety).
    await page.reload();
    await expect(page.locator(".login-card h1")).toHaveText("וילה 2026");
    await expect(page.locator(".topbar")).toHaveCount(0);
  });
});

test.describe("Login flow — edit / delete names", () => {
  test.beforeEach(async ({ request, baseURL, page }) => {
    await resetState(request, baseURL!);
    await freshLogin(page);
  });

  test('"ערוך שמות" toggle reveals × badges on tiles', async ({ page }) => {
    await page.goto("/");
    // Off by default
    await expect(page.locator(".member-delete")).toHaveCount(0);

    await page.getByRole("button", { name: "ערוך שמות" }).click();
    await expect(page.locator(".login-card .login-head p")).toHaveText("עריכת שמות");

    // Every tile now has a delete badge — seed has one assignee: הדסה
    await expect(page.locator(".member-delete")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^מחיקת/ })).toBeVisible();

    // Exiting edit mode hides them again
    await page.getByRole("button", { name: "סיום עריכה" }).click();
    await expect(page.locator(".member-delete")).toHaveCount(0);
  });

  test("renaming a member updates the list, login chip, and all assignees", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ערוך שמות" }).click();
    await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();

    // Rename prompt should appear with the original prefilled
    await expect(page.locator(".prompt strong")).toHaveText("הדסה");
    const input = page.locator(".name-form input");
    await expect(input).toHaveValue("הדסה");

    await input.fill("הדסה ל'");
    await page.getByRole("button", { name: "שמירה" }).click();

    // Back to browse with the new name in the grid
    await expect(page.locator(".member-grid button.member", { hasText: "הדסה ל'" })).toBeVisible();
    await expect(page.locator(".member-grid button.member", { hasText: /^הדסה$/ })).toHaveCount(0);

    // Login as the renamed person to make sure she's still wired up
    // (exit edit mode first)
    await page.getByRole("button", { name: "סיום עריכה" }).click();
    await page.locator(".member-grid button.member", { hasText: "הדסה ל'" }).click();
    await expect(page.locator(".topbar .who")).toContainText("הדסה ל'");

    // Server side: the task previously assigned to "הדסה" now points to "הדסה ל'"
    const res = await request.get(`${baseURL}/api/state`);
    const body = await res.json();
    const grillTask = body.state.tasks.find((t: { id: string }) => t.id === "t-grill");
    expect(grillTask.assignees).toContain("הדסה ל'");
    expect(grillTask.assignees).not.toContain("הדסה");
  });

  test("renaming blocks exact duplicate of another existing name", async ({
    page,
    request,
    baseURL,
  }) => {
    // Seed with two members so we can collide
    await resetState(request, baseURL!, {
      tasks: [
        {
          id: "t1",
          title: "test",
          needed: 1,
          assignees: ["A", "B"],
          day: "לפני",
          notes: "",
          checklist: [],
          completed: false,
        },
      ],
      planItems: [],
      members: ["A", "B"],
      memberPrefs: {},
      updatedAt: new Date().toISOString(),
    } as never);

    await page.goto("/");
    await page.getByRole("button", { name: "ערוך שמות" }).click();
    await page.locator(".member-grid button.member", { hasText: /^A$/ }).click();

    await page.locator(".name-form input").fill("B");
    await page.getByRole("button", { name: "שמירה" }).click();

    await expect(page.locator(".error.small")).toContainText(/כבר קיים/);
    // Still in rename stage; original name unchanged in grid
    await expect(page.locator(".member-grid button.member", { hasText: /^A$/ })).toBeVisible();
  });

  test("delete via the × badge confirms and removes name from members + assignees", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ערוך שמות" }).click();

    const tile = page.locator(".member-cell", { has: page.locator("button.member", { hasText: "הדסה" }) });
    await tile.locator(".member-delete").click();

    const confirmDialog = page.locator(".confirm[role=alertdialog]");
    await expect(confirmDialog.locator("h3")).toHaveText("למחוק את השם?");
    await confirmDialog.getByRole("button", { name: "מחיקה" }).click();

    await expect(page.locator(".member-grid button.member", { hasText: "הדסה" })).toHaveCount(0);

    // Server-side: assignees no longer contain her
    const res = await request.get(`${baseURL}/api/state`);
    const body = await res.json();
    const grillTask = body.state.tasks.find((t: { id: string }) => t.id === "t-grill");
    expect(grillTask.assignees).not.toContain("הדסה");
  });

  test("delete — cancel keeps the name", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ערוך שמות" }).click();

    const tile = page.locator(".member-cell", { has: page.locator("button.member", { hasText: "הדסה" }) });
    await tile.locator(".member-delete").click();

    await page.locator(".confirm[role=alertdialog]").getByRole("button", { name: "ביטול" }).click();

    await expect(page.locator(".member-grid button.member", { hasText: "הדסה" })).toBeVisible();
  });

  test("inside the rename prompt, 'מחיקת השם' also deletes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ערוך שמות" }).click();
    await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();

    // Big red link inside the prompt
    await page.getByRole("button", { name: /^מחיקת השם/ }).click();

    await page.locator(".confirm[role=alertdialog]").getByRole("button", { name: "מחיקה" }).click();
    await expect(page.locator(".member-grid button.member", { hasText: "הדסה" })).toHaveCount(0);

    // The rename prompt should have closed automatically since its
    // target name is now gone.
    await expect(page.locator(".prompt strong", { hasText: "הדסה" })).toHaveCount(0);
  });
});
