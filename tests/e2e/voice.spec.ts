import { expect, test, type Page } from "@playwright/test";
import { freshLogin, resetState, TEST_SEED } from "./helpers";

type AssistMock = {
  match: RegExp;
  response: {
    speech: string;
    resolved: unknown[];
    needsClarification?: boolean;
  };
};

async function installVoiceMocks(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((event?: unknown) => void) | null;

    class MockUtterance {
      text: string;
      lang = "";
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      onend: Handler = null;
      onerror: Handler = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    class MockRecognition {
      static instances: MockRecognition[] = [];

      lang = "en-US";
      continuous = true;
      interimResults = true;
      maxAlternatives = 1;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: Handler = null;
      onaudiostart: Handler = null;
      started = false;

      constructor() {
        MockRecognition.instances.push(this);
      }

      start() {
        this.started = true;
        this.onaudiostart?.({});
      }

      stop() {
        this.started = false;
      }

      abort() {
        this.started = false;
      }

      emit(text: string, isFinal: boolean) {
        this.onresult?.({
          resultIndex: 0,
          results: [
            {
              isFinal,
              0: { transcript: text },
            },
          ],
        });
      }

      end() {
        this.started = false;
        this.onend?.();
      }
    }

    Object.assign(window, {
      SpeechRecognition: MockRecognition,
      webkitSpeechRecognition: MockRecognition,
      SpeechSynthesisUtterance: MockUtterance,
      __villaMockRecognition: MockRecognition,
    });

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices() {
          return [{ name: "Samantha", lang: "en-US", localService: true }];
        },
        speak(utt: MockUtterance) {
          window.setTimeout(() => utt.onend?.({}), 0);
        },
        addEventListener() {},
        onvoiceschanged: null,
      },
    });
  });
}

async function latestRecognitionSpeak(
  page: Page,
  text: string,
  opts: { final?: boolean; end?: boolean } = {},
) {
  await page.evaluate(
    ({ text, final, end }) => {
      const Ctor = (
        window as typeof window & {
          __villaMockRecognition: {
            instances: Array<{
              emit: (text: string, isFinal: boolean) => void;
              end: () => void;
            }>;
          };
        }
      ).__villaMockRecognition;
      const rec = Ctor.instances[Ctor.instances.length - 1];
      if (!rec) throw new Error("No mock recognition instance");
      rec.emit(text, final);
      if (end) rec.end();
    },
    { text, final: opts.final ?? true, end: opts.end ?? false },
  );
}

async function wake(page: Page) {
  await latestRecognitionSpeak(page, "hey villa");
  await expect(page.getByText("Speak now…")).toBeVisible();
  // setStatusSafe starts a fresh recognizer on a short timeout after the
  // "Yes?" TTS finishes. Give that recognizer a beat to become the latest
  // instance before sending the actual command.
  await page.waitForTimeout(500);
}

async function confirmByVoice(page: Page) {
  await expect(page.getByRole("button", { name: "Yes, confirm" })).toBeVisible();
  // Confirmation also starts a fresh recognizer after the spoken prompt.
  await page.waitForTimeout(500);
  await latestRecognitionSpeak(page, "yes");
}

async function setupVoicePage(page: Page, baseURL: string) {
  await freshLogin(page);
  await installVoiceMocks(page);
  await resetState(page.request, baseURL);
  await page.goto("/");
  await page.getByRole("button", { name: "+ הוספת שם חדש" }).click();
  await page.locator(".name-form input").fill("דניאל");
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.locator(".topbar .who")).toContainText("דניאל");
}

function mockAssist(page: Page, mocks: AssistMock[]) {
  const seen: string[] = [];
  return {
    seen,
    ready: page.route("**/api/assist", async (route) => {
      const body = route.request().postDataJSON() as { command?: string };
      const command = body.command ?? "";
      seen.push(command);
      const mock = mocks.find((item) => item.match.test(command));
      if (!mock) {
        throw new Error(`Unexpected assist command: ${command}`);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          transcript: command,
          language: "en",
          proposal: {
            speech: mock.response.speech,
            needsClarification: mock.response.needsClarification ?? false,
            actions: [],
          },
          resolved: mock.response.resolved,
          needsClarification: mock.response.needsClarification ?? false,
        }),
      });
    }),
  };
}

test.describe("voice assistant state machine", () => {
  test("mobile interim speech + recognizer end commits the command and applies a created task", async ({
    page,
    baseURL,
  }) => {
    await setupVoicePage(page, baseURL!);
    mockAssist(page, [
      {
        match: /bring towels/i,
        response: {
          speech: "Create a towels task, OK?",
          resolved: [
            {
              type: "createTask",
              title: "להביא מגבות",
              day: "לפני",
              needed: 1,
              notes: "",
              assignMe: true,
            },
          ],
        },
      },
    ]);

    await wake(page);
    await latestRecognitionSpeak(page, "create a task bring towels", {
      final: false,
      end: true,
    });

    await expect(page.getByRole("button", { name: "Yes, confirm" })).toBeVisible({
      timeout: 6000,
    });
    await confirmByVoice(page);
    await expect(page.getByRole("heading", { name: "להביא מגבות" })).toBeVisible();
  });

  test("can edit task day and assign another person by voice", async ({
    page,
    baseURL,
  }) => {
    await setupVoicePage(page, baseURL!);
    mockAssist(page, [
      {
        match: /move.*grill.*friday.*michal/i,
        response: {
          speech: "Move BBQ and add Michal, OK?",
          resolved: [
            {
              type: "changeTaskDay",
              taskId: "t-grill",
              taskTitle: "מנגל - בשר",
              day: "שישי",
            },
            {
              type: "addAssignee",
              taskId: "t-grill",
              taskTitle: "מנגל - בשר",
              member: "מיכל",
            },
          ],
        },
      },
    ]);

    await wake(page);
    await latestRecognitionSpeak(page, "move grill to friday and add michal");
    await confirmByVoice(page);

    await expect
      .poll(async () => {
        const state = await (await page.request.get(`${baseURL}/api/state`)).json();
        const grill = state.state.tasks.find((task: { id: string }) => task.id === "t-grill");
        return { day: grill.day, assignees: grill.assignees };
      })
      .toEqual({ day: "שישי", assignees: ["הדסה", "מיכל"] });
  });

  test("can switch an assignment from one person to another by voice", async ({
    page,
    baseURL,
  }) => {
    await setupVoicePage(page, baseURL!);
    mockAssist(page, [
      {
        match: /switch.*grill.*hadassah.*daniel/i,
        response: {
          speech: "Switch BBQ assignment, OK?",
          resolved: [
            {
              type: "removeAssignee",
              taskId: "t-grill",
              taskTitle: "מנגל - בשר",
              member: "הדסה",
            },
            {
              type: "addAssignee",
              taskId: "t-grill",
              taskTitle: "מנגל - בשר",
              member: "דניאל",
            },
          ],
        },
      },
    ]);

    await wake(page);
    await latestRecognitionSpeak(page, "switch grill from hadassah to daniel");
    await confirmByVoice(page);

    await expect
      .poll(async () => {
        const state = await (await page.request.get(`${baseURL}/api/state`)).json();
        const grill = state.state.tasks.find((task: { id: string }) => task.id === "t-grill");
        return grill.assignees;
      })
      .toEqual(["דניאל"]);
  });

  test("read-only info answers skip confirmation and return to wake-word listening", async ({
    page,
    baseURL,
  }) => {
    await setupVoicePage(page, baseURL!);
    const assist = mockAssist(page, [
      {
        match: /what am i signed up for/i,
        response: {
          speech: "You are not signed up yet.",
          resolved: [{ type: "answer", text: "You are not signed up yet." }],
        },
      },
      {
        match: /what still needs people/i,
        response: {
          speech: "Shopping and cleanup still need people.",
          resolved: [
            {
              type: "answer",
              text: "Shopping and cleanup still need people.",
            },
          ],
        },
      },
    ]);

    await wake(page);
    await latestRecognitionSpeak(page, "what am I signed up for");

    await expect(page.getByText("You are not signed up yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, confirm" })).toHaveCount(0);

    await latestRecognitionSpeak(page, "hey villa");
    await expect(page.getByText("Speak now…")).toBeVisible();
    await page.waitForTimeout(500);
    await latestRecognitionSpeak(page, "what still needs people", {
      final: false,
      end: true,
    });
    await expect
      .poll(() => assist.seen, { timeout: 7000 })
      .toEqual(["what am I signed up for", "what still needs people"]);
    await expect(page.getByText("Shopping and cleanup still need people.")).toBeVisible();
  });
});
