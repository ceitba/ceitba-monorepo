import { describe, expect, test } from "bun:test";
import { DEFAULT_SCHEDULER_OPTIONS, generateSchedules, type SubjectInput } from "../src";

const subj = (id: string, commissions: [string, string, string, string][]): SubjectInput => ({
  subject_id: id, name: id, course_start: "2026-08-10", course_end: "2026-11-28",
  commissions: commissions.map(([name, day, from, to]) => ({
    name, schedule: [{ day, time_from: from, time_to: to, building: "SDF", classroom: "1" }]
  }))
});

const A = subj("A", [["A1", "MONDAY", "08:00", "10:00"], ["A2", "TUESDAY", "08:00", "10:00"]]);
const B = subj("B", [["B1", "MONDAY", "09:00", "11:00"], ["B2", "WEDNESDAY", "08:00", "10:00"]]);

describe("generateSchedules", () => {
  test("skips overlapping combinations by default", () => {
    const r = generateSchedules([A, B], DEFAULT_SCHEDULER_OPTIONS, []);
    const combos = r.schedules.map(s => s.slots.map(x => x.commission).sort().join("+"));
    expect(combos.sort()).toEqual(["A1+B2", "A2+B1", "A2+B2"]);
    expect(r.truncated).toBe(false);
  });

  test("limited overlap allows up to 30 minutes, unlimited allows any", () => {
    const C = subj("C", [["C1", "MONDAY", "09:30", "11:00"]]);
    expect(generateSchedules([A, C], { ...DEFAULT_SCHEDULER_OPTIONS, allowOverlap: true }, []).schedules
      .some(s => s.slots.some(x => x.commission === "A1"))).toBe(true);
    expect(generateSchedules([A, B], { ...DEFAULT_SCHEDULER_OPTIONS, allowUnlimitedOverlap: true }, []).schedules).toHaveLength(4);
  });

  test("blocked times remove commissions", () => {
    const r = generateSchedules([A, B], DEFAULT_SCHEDULER_OPTIONS, [{ day: "MONDAY", from: "07:00", to: "12:00" }]);
    expect(r.schedules.map(s => s.slots.map(x => x.commission).sort().join("+"))).toEqual(["A2+B2"]);
  });

  test("selected commissions restrict choices; ranking prefers fewer gaps", () => {
    const r = generateSchedules([{ ...A, selectedCommissions: ["A2"] }, B], DEFAULT_SCHEDULER_OPTIONS, []);
    expect(r.schedules.every(s => s.slots.some(x => x.commission === "A2"))).toBe(true);
  });

  test("result cap truncates", () => {
    const r = generateSchedules([A, B], { ...DEFAULT_SCHEDULER_OPTIONS, allowUnlimitedOverlap: true }, [], { maxResults: 2 });
    expect(r.schedules).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});
