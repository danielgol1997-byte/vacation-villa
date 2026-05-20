import type { PlanItem, TaskDay, VacationState, VacationTask } from "./types";

type SeedTask = {
  title: string;
  needed: number;
  assignees: string[];
  day: TaskDay;
  notes?: string;
};

const taskRows: SeedTask[] = [
  { title: "הכנת רשימת קניות כללית לסופר", needed: 1, assignees: ["מיכל"], day: "לפני" },
  { title: "קנייה אונליין עם משלוח לוילה", needed: 1, assignees: ["הדסה"], day: "לפני" },
  {
    title: "הכנת רשימת ציוד נלווה שצריך להביא (שעוני שבת. משחקי קופסא, כדור, פריזבי, ערכת הבדלה וכו)",
    needed: 1,
    assignees: ["שירה"],
    day: "לפני",
  },
  { title: "הבאת / וידוא הבאת הציוד הנלווה", needed: 1, assignees: ["שירה"], day: "לפני" },
  {
    title: "הזמנה מקייטרינג שיעשה לנו משלוח (סגירת משלוח, כמויות, אוכל - 2 ארוחות שבת, לא לשכוח אופציות לצמחונים)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "רשימת קניות למנגל חוץ מבשר (כולל מנה אחרונה, סלטים, לחמים, וכו)",
    needed: 1,
    assignees: ["מיכל"],
    day: "לפני",
  },
  {
    title: "רשימת קניות בשר + קנייה (בקצבייה או הוספה לסופר עיל)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "בראנצ שישי - מציאת והזמנת מקום לאכול בו בשישי בבוקר",
    needed: 1,
    assignees: ["מורדי"],
    day: "לפני",
  },
  { title: "מנגל - מינגול", needed: 2, assignees: ["מורדי"], day: "חמישי" },
  { title: "מנגל - 2 סלטים גדולים", needed: 2, assignees: ["הדסה"], day: "חמישי" },
  { title: "מנגל - תפוחי אדמה וירקות בתנור", needed: 1, assignees: [], day: "חמישי" },
  {
    title: "מנגל - הכנת הבשרים / ירקות (מרינדה וכו)",
    needed: 2,
    assignees: ["מרלי"],
    day: "חמישי",
  },
  { title: "מנגל - לערוך שולחן", needed: 2, assignees: ["מיכל", "מיכאל"], day: "חמישי" },
  { title: "מנגל - סידור ואיפוס", needed: 3, assignees: [], day: "חמישי" },
  {
    title: "מאפים לשבת - הזמנה / איסוף של מאפים שווים ממאפייה שווה. גם עוגות, גם מאפים פרווה וגם מאפים חלביים כולל פיציות ובורקסים לסעודה שלישית",
    needed: 1,
    assignees: ["הדסה"],
    day: "לפני",
  },
  { title: "א. בוקר ראשון - להכין", needed: 2, assignees: [], day: "ראשון" },
  {
    title: "פעילות שישי - תכנון רפטינג / מסלול / כל משהו אחר שנראה לכם (נגיש!)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "פעילות משפחתית #1 - הכנת משחק / הפעלה - לערב שבת",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "פעילות משפחתית #2 - שבת אחר הצהרים - הכנת משחק / הפעלה / כל דבר שעולה על רוחכם",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  {
    title: "אוכל שבת - לשים אוכל על הפלטה בערב שבת",
    needed: 1,
    assignees: ["מרלי"],
    day: "שישי",
  },
  { title: "אוכל שבת - לשים אוכל על הפלטה בשבת בבוקר", needed: 1, assignees: ["מיכל"], day: "שבת" },
  { title: "ארוחה שבת - להכין סלט גדול לערב שבת", needed: 1, assignees: ["הדסה"], day: "שישי" },
  { title: "ארוחה שבת - להכין סלט גדול לשבת בבוקר", needed: 1, assignees: ["הדסה"], day: "שבת" },
  { title: "ארוחה שבת - עורכים שולחן ערב שבת", needed: 2, assignees: ["הדסה", "איתמר"], day: "שישי" },
  { title: "ארוחה שבת - עורכים שולחן שבת בבוקר", needed: 2, assignees: ["מיכל", "מיכאל"], day: "שבת" },
  { title: "ארוחת שבת - מגישים - מפנים - מנקים ארוחה ערב", needed: 3, assignees: ["מורדי", "תהילה"], day: "שישי" },
  { title: "ארוחת שבת - מגישים - מפנים - מנקים ארוחה צהרים", needed: 3, assignees: ["הדסה", "איתמר", "נחמה"], day: "שבת" },
  {
    title: "שעוני שבת - להגדיר ולשים כולל מזגן בחללים מרכזיים, אור איפה שצריך וכו לקראת שבת + פלטה מיחם וכו",
    needed: 1,
    assignees: [],
    day: "שישי",
  },
  {
    title: "בדרך לצפון - תכנון פעילות למתכננים להגיע מוקדם בדרך לצפון לחלוקת הדרך :)",
    needed: 1,
    assignees: [],
    day: "לפני",
  },
  { title: "ארוחת שבת - חיתוך ירקות לסעודה שלישית", needed: 1, assignees: ["תהילה"], day: "שבת" },
  { title: "ארוחת שבת - לערוך לסעודה שלישית", needed: 2, assignees: ["מרלי"], day: "שבת" },
  { title: "ארוחת שבת - להגיש - לפנות - לנקות סעודה שלישית", needed: 3, assignees: ["מרלי", "נחמה"], day: "שבת" },
  { title: "ארוחת שבת - לשים על הפלטה לסעודה שלישית", needed: 1, assignees: ["מרלי"], day: "שבת" },
  { title: "ארוחת שבת - לחתוך פירות למנה אחרונה בצהרים", needed: 1, assignees: ["מיכל"], day: "שבת" },
  {
    title: "הערכת מצב - בשישי בבוקר לבדוק אם יש דברים שחסר לפני שבת כי חוסל או שכחנו ולדאוג שקונים לפני שהחנויות נסגרות",
    needed: 1,
    assignees: ["אמא", "מרלי"],
    day: "שישי",
  },
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
