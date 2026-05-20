export type TaskDay = "לפני" | "חמישי" | "שישי" | "שבת" | "ראשון";
export type PlanDay = "חמישי" | "שישי" | "שבת" | "ראשון";

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type VacationTask = {
  id: string;
  title: string;
  needed: number;
  assignees: string[];
  day: TaskDay;
  notes: string;
  checklist: ChecklistItem[];
  completed: boolean;
};

export type PlanItem = {
  id: string;
  day: PlanDay;
  title: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  pricePerPerson?: number;
  notes?: string;
};

export type AssistantLanguage = "he" | "en";

export type MemberPrefs = {
  language: AssistantLanguage;
};

export type VacationState = {
  tasks: VacationTask[];
  planItems: PlanItem[];
  members: string[];
  memberPrefs: Record<string, MemberPrefs>;
  updatedAt: string;
};
