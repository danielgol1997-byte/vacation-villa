import { test, expect, type Page } from "@playwright/test";
import { freshLogin, resetState } from "./helpers";

async function loginAsHadassah(page: Page) {
  await page.goto("/");
  await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();
  await expect(page.locator(".topbar .who")).toContainText("הדסה");
}

async function loginAsNewMember(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "+ הוספת שם חדש" }).click();
  await page.locator(".name-form input").fill(name);
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.locator(".topbar .who")).toContainText(name);
}

function taskCard(page: Page, title: string) {
  return page.locator(".task", { has: page.locator("h3", { hasText: title }) });
}

test.describe("Tasks tab — CRUD + signup", () => {
  test.beforeEach(async ({ request, baseURL, page }) => {
    await resetState(request, baseURL!);
    await freshLogin(page);
  });

  test("signup adds you to the assignees and flips the button label", async ({ page }) => {
    await loginAsNewMember(page, "דניאל");

    const card = taskCard(page, "רשימת קניות");
    await expect(card).toBeVisible();
    await expect(card.locator(".progress-meta span").first()).toHaveText("0/1");

    await card.getByRole("button", { name: "להתנדב" }).click();

    // After signup: progress becomes 1/1, name chip appears, button reads "לבטל"
    await expect(card.locator(".progress-meta span").first()).toHaveText("1/1");
    await expect(card.locator(".chips-soft")).toContainText("דניאל");
    // Single-person task that's now full shows "מלא" pill in badge row
    await expect(card.locator(".badge-row .pill.ok")).toHaveText("מלא");
  });

  test("unsignup removes you and reopens the slot", async ({ page }) => {
    await loginAsNewMember(page, "דניאל");
    const card = taskCard(page, "רשימת קניות");

    await card.getByRole("button", { name: "להתנדב" }).click();
    await expect(card.getByRole("button", { name: "לבטל" })).toBeVisible();

    await card.getByRole("button", { name: "לבטל" }).click();
    await expect(card.getByRole("button", { name: "להתנדב" })).toBeVisible();
    await expect(card.locator(".progress-meta span").first()).toHaveText("0/1");
  });

  test("creating a new task adds it to the list and persists via the API", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginAsNewMember(page, "דניאל");
    await page.getByRole("button", { name: "+ משימה חדשה" }).click();

    await page.locator(".add-form input[name=title]").fill("הבאת מיכל קפה");
    await page.locator(".add-form input[name=needed]").fill("3");
    // Pick Saturday in the day picker
    await page.locator(".day-picker button", { hasText: "שבת" }).click();
    await page.locator(".add-form textarea[name=notes]").fill("חשוב מאוד");

    await page.locator(".add-form button[type=submit]").click();

    const newCard = taskCard(page, "הבאת מיכל קפה");
    await expect(newCard).toBeVisible();
    await expect(newCard.locator(".progress-meta span").first()).toHaveText("0/3");
    await expect(newCard.locator(".day-tag, .meta-chip, h3").first()).toBeVisible();

    // Server-side: confirm the task is persisted via the API
    const res = await request.get(`${baseURL}/api/state`);
    const body = await res.json();
    const found = body.state.tasks.find(
      (t: { title: string }) => t.title === "הבאת מיכל קפה",
    );
    expect(found).toBeTruthy();
    expect(found.needed).toBe(3);
    expect(found.day).toBe("שבת");
    expect(found.notes).toBe("חשוב מאוד");
  });

  test("opening a task shows the modal and toggling completed strikes the title", async ({ page }) => {
    await loginAsHadassah(page);
    await taskCard(page, "מנגל - בשר").click();

    const modal = page.locator(".modal[role=dialog]");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".day-tag")).toHaveText("חמישי");
    await expect(modal.locator("h2")).toHaveText("מנגל - בשר");

    await modal.locator('label.check input[type=checkbox]').check();
    await expect(modal.locator("h2.strike")).toBeVisible();

    // Close and confirm card shows "הושלם" pill
    await modal.getByRole("button", { name: "סגירה" }).click();
    await expect(modal).toBeHidden();
    await expect(taskCard(page, "מנגל - בשר").locator(".badge-row .pill.ok")).toHaveText("הושלם");
  });

  test("checklist: add, toggle, remove items", async ({ page }) => {
    await loginAsHadassah(page);
    await taskCard(page, "מנגל - בשר").click();
    const modal = page.locator(".modal[role=dialog]");

    // Add a new checklist item
    await modal.locator(".checklist-form input").fill("נקניקיות");
    await modal.locator(".checklist-form button[type=submit]").click();
    await expect(modal.locator(".checklist li", { hasText: "נקניקיות" })).toBeVisible();

    // Toggle the new item done
    const newItem = modal.locator(".checklist li", { hasText: "נקניקיות" });
    await newItem.locator("input[type=checkbox]").check();
    await expect(newItem).toHaveClass(/done/);

    // Remove an existing item ("פרגיות")
    const oldItem = modal.locator(".checklist li", { hasText: "פרגיות" });
    await oldItem.getByRole("button", { name: "הסרה" }).click();
    await expect(modal.locator(".checklist li", { hasText: "פרגיות" })).toHaveCount(0);
  });

  test("notes save with a debounce and survive a modal reopen", async ({ page }) => {
    await loginAsHadassah(page);
    await taskCard(page, "רשימת קניות").click();
    const modal = page.locator(".modal[role=dialog]");

    const textarea = modal.locator(".modal-section textarea");
    await textarea.fill("חלב, ביצים, לחם");
    // Notes have a 500ms debounce, plus the server PUT. Wait a beat.
    await page.waitForTimeout(900);

    await modal.getByRole("button", { name: "סגירה" }).click();
    await expect(modal).toBeHidden();

    await taskCard(page, "רשימת קניות").click();
    await expect(page.locator(".modal[role=dialog] textarea")).toHaveValue("חלב, ביצים, לחם");
  });

  test("delete task uses the custom confirm dialog (not browser native)", async ({ page }) => {
    await loginAsHadassah(page);
    await taskCard(page, "סידור הבית").click();

    await page.locator(".modal[role=dialog] .danger-link", { hasText: "מחק משימה" }).click();

    const confirmDialog = page.locator(".confirm[role=alertdialog]");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.locator("h3")).toHaveText("למחוק את המשימה?");

    await confirmDialog.getByRole("button", { name: "מחיקה" }).click();

    await expect(confirmDialog).toBeHidden();
    await expect(taskCard(page, "סידור הבית")).toHaveCount(0);
  });

  test("delete task — cancel keeps it", async ({ page }) => {
    await loginAsHadassah(page);
    await taskCard(page, "סידור הבית").click();
    await page.locator(".modal[role=dialog] .danger-link").click();

    const confirmDialog = page.locator(".confirm[role=alertdialog]");
    await confirmDialog.getByRole("button", { name: "ביטול" }).click();

    await expect(confirmDialog).toBeHidden();
    // Close the task modal too
    await page.locator(".modal[role=dialog]").getByRole("button", { name: "סגירה" }).click();
    await expect(taskCard(page, "סידור הבית")).toBeVisible();
  });

  test("day filter chips only show tasks for that day", async ({ page }) => {
    await loginAsHadassah(page);

    // Default is "הכל" — all 3 tasks present
    await expect(page.locator(".task")).toHaveCount(3);

    await page.locator(".chips button.chip", { hasText: "חמישי" }).click();
    await expect(page.locator(".task")).toHaveCount(1);
    await expect(page.locator(".task h3")).toHaveText("מנגל - בשר");

    await page.locator(".chips button.chip", { hasText: "ראשון" }).click();
    await expect(page.locator(".task h3")).toHaveText("סידור הבית");

    // Back to all
    await page.locator(".chips button.chip", { hasText: "הכל" }).click();
    await expect(page.locator(".task")).toHaveCount(3);
  });

  test('"שלי" tab shows only tasks the current user is signed up for', async ({ page }) => {
    await loginAsHadassah(page);

    await page.getByRole("button", { name: "שלי" }).click();
    // Hadassah is pre-assigned to "מנגל - בשר"
    await expect(page.locator(".task")).toHaveCount(1);
    await expect(page.locator(".task h3")).toHaveText("מנגל - בשר");

    // Sign up for another task too
    await page.getByRole("button", { name: "משימות" }).click();
    await taskCard(page, "רשימת קניות").getByRole("button", { name: "להתנדב" }).click();
    await page.getByRole("button", { name: "שלי" }).click();
    await expect(page.locator(".task")).toHaveCount(2);
  });
});
