import { describe, expect, it } from "vitest";

import { parseView } from "../view";

describe("parseView", () => {
  it("defaults to the week", () => {
    expect(parseView(undefined)).toBe("week");
    expect(parseView("")).toBe("week");
    expect(parseView("fortnight")).toBe("week");
  });

  it("honours an explicit view", () => {
    expect(parseView("month")).toBe("month");
    expect(parseView("week")).toBe("week");
    expect(parseView("agenda")).toBe("agenda");
  });
});
