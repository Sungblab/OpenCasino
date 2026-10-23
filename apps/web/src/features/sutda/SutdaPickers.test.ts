import { describe, expect, it } from "vitest";
import { withRo } from "./SutdaPickers";

describe("withRo", () => {
  it("picks 로/으로 by the last syllable", () => {
    expect(["6끗", "알리", "38광땡", "갑오", "세륙", "구사", "망통", "땡잡이"].map(withRo))
      .toEqual(["6끗으로", "알리로", "38광땡으로", "갑오로", "세륙으로", "구사로", "망통으로", "땡잡이로"]);
  });
});
