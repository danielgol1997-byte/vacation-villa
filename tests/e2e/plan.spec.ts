import { test, expect, type Page } from "@playwright/test";
import { freshLogin, resetState } from "./helpers";

async function loginAsHadassah(page: Page) {
  await page.goto("/");
  await page.locator(".member-grid button.member", { hasText: "הדסה" }).click();
  await expect(page.locator(".topbar .who")).toContainText("הדסה");
}

test.describe("Plan tab — CRUD", () => {
  test.beforeEach(async ({ request, baseURL, page }) => {
    await resetState(request, baseURL!);
    await freshLogin(page);
  });

  test("plan tab shows items for the selected day, filtered by chip", async ({ page }) => {
    await loginAsHadassah(page);
    await page.getByRole("button", { name: "תכנית" }).click();

    // Thursday is the default — should show the grill item from seed
    await expect(page.locator(".plan h3")).toHaveText("מנגל");
    await expect(page.locator(".plan")).toHaveCount(1);

    // Switch to Friday — should show the walk
    await page.locator(".chips button.chip", { hasText: "שישי" }).click();
    await expect(page.locator(".plan h3")).toHaveText("טיול בוקר");

    // Switch to Saturday — empty state
    await page.locator(".chips button.chip", { hasText: "שבת" }).click();
    await expect(page.locator(".plan")).toHaveCount(0);
    await expect(page.locator(".empty")).toContainText("אין עדיין תכנית");
  });

  test("create a plan item with full details", async ({ page, request, baseURL }) => {
    await loginAsHadassah(page);
    await page.getByRole("button", { name: "תכנית" }).click();
    await page.locator(".chips button.chip", { hasText: "שבת" }).click();

    await page.getByRole("button", { name: /\+ הוספה לשבת/ }).click();
    await page.locator(".add-form input[name=title]").fill("סעודת שבת");
    await page.locator(".add-form input[name=startTime]").fill("13:00");
    await page.locator(".add-form input[name=endTime]").fill("15:00");
    await page.locator(".add-form input[name=location]").fill("חצר הוילה");
    await page.locator(".add-form input[name=pricePerPerson]").fill("80");
    await page.locator(".add-form textarea[name=notes]").fill("יין מהוילה");

    await page.locator(".add-form button[type=submit]").click();

    await expect(page.locator(".plan h3", { hasText: "סעודת שבת" })).toBeVisible();
    const card = page.locator(".plan", { has: page.locator("h3", { hasText: "סעודת שבת" }) });
    await expect(card).toContainText("חצר הוילה");
    await expect(card).toContainText("₪80 לאדם");

    // Server-side persistence check
    const res = await request.get(`${baseURL}/api/state`);
    const body = await res.json();
    const item = body.state.planItems.find(
      (p: { title: string }) => p.title === "סעודת שבת",
    );
    expect(item).toBeTruthy();
    expect(item.day).toBe("שבת");
    expect(item.startTime).toBe("13:00");
    expect(item.endTime).toBe("15:00");
    expect(item.location).toBe("חצר הוילה");
    expect(item.pricePerPerson).toBe(80);
    expect(item.notes).toBe("יין מהוילה");
  });

  test("delete plan item triggers the custom confirm dialog", async ({ page }) => {
    await loginAsHadassah(page);
    await page.getByRole("button", { name: "תכנית" }).click();
    await page.locator(".chips button.chip", { hasText: "שישי" }).click();

    const card = page.locator(".plan", { has: page.locator("h3", { hasText: "טיול בוקר" }) });
    await card.getByRole("button", { name: "מחיקה" }).click();

    const confirmDialog = page.locator(".confirm[role=alertdialog]");
    await expect(confirmDialog.locator("h3")).toHaveText("למחוק מהתכנית?");
    await confirmDialog.getByRole("button", { name: "מחיקה" }).click();

    await expect(page.locator(".plan", { has: page.locator("h3", { hasText: "טיול בוקר" }) })).toHaveCount(0);
  });
});
