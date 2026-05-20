import type { PlanItem, TaskDay, VacationState, VacationTask } from "./types";

type SeedTask = {
  title: string;
  needed: number;
  assignees: string[];
  day: TaskDay;
  notes?: string;
};

const taskRows: SeedTask[] = [
  // לפני האירוע — תכנון, הזמנות וקניות
  { title: "הכנת רשימת קניות כללית לסופר", needed: 1, assignees: ["מיכל"], day: "לפני" },
  { title: "קנייה אונליין עם משלוח לוילה", needed: 1, assignees: ["הדסה"], day: "לפני" },
  {
    title: "רשימת ציוד נלווה (שעוני שבת, משחקי קופסא, כדור, פריזבי, ערכת הבדלה וכו)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  { title: "הבאת / וידוא הבאת הציוד הנלווה", needed: 1, assignees: [], day: "לפני" },
  {
    title: "הזמנה מקייטרינג עם משלוח (סגירת משלוח, כמויות, 2 ארוחות שבת)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "רשימת קניות למנגל חוץ מבשר (מנה אחרונה, סלטים, לחמים)",
    needed: 1,
    assignees: ["מיכל"],
    day: "לפני",
  },
  {
    title: "רשימת קניות בשר + קנייה (בקצבייה או הוספה לסופר)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "בראנץ' שישי — מציאת והזמנת מקום",
    needed: 1,
    assignees: ["מורדי"],
    day: "לפני",
  },
  {
    title: "מאפים לשבת — הזמנה / איסוף ממאפייה שווה",
    needed: 1,
    assignees: ["הדסה"],
    day: "לפני",
    notes: "עוגות, מאפים פרווה וחלביים, פיציות ובורקסים לסעודה שלישית.",
  },
  {
    title: "פעילות שישי — תכנון רפטינג / מסלול נגיש",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "פעילות משפחתית #1 — משחק / הפעלה לערב שבת",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "פעילות משפחתית #2 — שבת אחר הצהריים",
    needed: 1,
    assignees: [],
    day: "לפני",
    notes: "משחק, הפעלה, או כל דבר שעולה על רוחכם.",
  },
  {
    title: "בדרך לצפון — תכנון פעילות למקדימים",
    needed: 1,
    assignees: [],
    day: "לפני",
    notes: "פעילות בדרך לצפון כדי לחלק את הדרך.",
  },

  // חמישי — מנגל בערב
  {
    title: "מנגל — מנגלאי/ת",
    needed: 2,
    assignees: ["מורדי"],
    day: "חמישי",
    notes: "כדאי להדליק אש סביב 16:00–17:00.",
  },
  { title: "מנגל — 2 סלטים גדולים", needed: 2, assignees: ["הדסה"], day: "חמישי" },
  { title: "מנגל — תפוחי אדמה וירקות בתנור", needed: 1, assignees: [], day: "חמישי" },
  {
    title: "מנגל — הכנת הבשרים / ירקות (מרינדה וכו)",
    needed: 2,
    assignees: [],
    day: "חמישי",
  },
  { title: "מנגל — לערוך שולחן", needed: 2, assignees: ["מיכל", "מיכאל"], day: "חמישי" },
  { title: "מנגל — סידור ואיפוס", needed: 3, assignees: [], day: "חמישי" },

  // שישי — בוקר, הכנות לשבת, ערב שבת
  {
    title: "שעוני שבת — להגדיר ולשים (מזגן, אור, פלטה, מיחם)",
    needed: 1,
    assignees: [],
    day: "שישי",
  },
  {
    title: "הערכת מצב — לבדוק בשישי בבוקר אם חסר משהו לפני שבת",
    needed: 1,
    assignees: [],
    day: "שישי",
    notes: "לדאוג לקנות לפני שהחנויות נסגרות.",
  },
  {
    title: "אוכל שבת — לשים על הפלטה בערב שבת",
    needed: 1,
    assignees: ["מרלי"],
    day: "שישי",
  },
  {
    title: "ארוחת שבת — סלט גדול לערב שבת",
    needed: 1,
    assignees: ["הדסה"],
    day: "שישי",
  },
  {
    title: "ארוחת שבת — עורכים שולחן ערב שבת",
    needed: 2,
    assignees: ["הדסה", "איתמר"],
    day: "שישי",
  },
  {
    title: "ארוחת שבת — מגישים, מפנים ומנקים ארוחת ערב",
    needed: 3,
    assignees: ["מורדי", "תהילה"],
    day: "שישי",
  },

  // שבת — בוקר, צהריים, סעודה שלישית
  {
    title: "אוכל שבת — לשים על הפלטה בבוקר",
    needed: 1,
    assignees: ["מיכל"],
    day: "שבת",
  },
  {
    title: "ארוחת שבת — סלט גדול לבוקר",
    needed: 1,
    assignees: ["הדסה"],
    day: "שבת",
  },
  {
    title: "ארוחת שבת — עורכים שולחן בוקר",
    needed: 2,
    assignees: ["מיכל", "מיכאל"],
    day: "שבת",
  },
  {
    title: "ארוחת שבת — מגישים, מפנים ומנקים בוקר",
    needed: 3,
    assignees: ["הדסה", "איתמר"],
    day: "שבת",
  },
  {
    title: "ארוחת שבת — חיתוך פירות למנה אחרונה בצהריים",
    needed: 1,
    assignees: ["מיכל"],
    day: "שבת",
  },
  {
    title: "סעודה שלישית — חיתוך ירקות",
    needed: 1,
    assignees: ["תהילה"],
    day: "שבת",
  },
  { title: "סעודה שלישית — עריכת שולחן", needed: 2, assignees: ["מרלי"], day: "שבת" },
  {
    title: "סעודה שלישית — להגיש, לפנות, לנקות",
    needed: 3,
    assignees: ["מרלי"],
    day: "שבת",
  },
  {
    title: "סעודה שלישית — לשים אוכל על הפלטה",
    needed: 1,
    assignees: ["מרלי"],
    day: "שבת",
  },

  // ראשון — בוקר ביציאה הביתה
  { title: "ארוחת בוקר ראשון — להכין", needed: 2, assignees: [], day: "ראשון" },
];

const planItems: PlanItem[] = [
  {
    id: "plan-1",
    day: "חמישי",
    title: "פעילות בדרך לצפון",
    notes: "למקדימים, כדי לחלק את הדרך",
  },
  {
    id: "plan-2",
    day: "חמישי",
    title: "מנגל בוילה",
    startTime: "17:00",
    location: "בוילה",
    notes: "להדליק אש סביב 16:00",
  },
  {
    id: "plan-3",
    day: "שישי",
    title: "בראנץ' בוקר",
    startTime: "09:30",
  },
  {
    id: "plan-4",
    day: "שישי",
    title: "פעילות יום",
  },
  {
    id: "plan-5",
    day: "שבת",
    title: "פעילויות משפחתיות בבית",
  },
];

export const seedState: VacationState = {
  tasks: taskRows.map((task, index) => ({
    id: `task-${index + 1}`,
    title: task.title,
    needed: task.needed,
    assignees: task.assignees,
    day: task.day,
    notes: task.notes ?? "",
    checklist: [],
    completed: false,
  })),
  planItems,
  members: [],
  memberPrefs: {},
  updatedAt: new Date().toISOString(),
};
