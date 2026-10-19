import { it, expect } from "vitest";
import { renderLabel } from "../components/LinkedInPostPanel";

// The queue header line: 3 images, or 3 images plus the video when config `video` is set.
it("names what is ready, and never claims the video when it failed", () => {
  expect(renderLabel({ state: "done", done: 3, total: 3 })).toBe("3 images ready");
  expect(renderLabel({ state: "done", done: 4, total: 4 })).toBe("3 images + video ready");
  expect(renderLabel({ state: "rendering", done: 3, total: 4, note: "rendering the video" })).toBe("3/4 done, rendering the video");
  expect(renderLabel({ state: "failed", done: 3, total: 4, error: "video: remotion exited 1" })).toBe("3 of 4 ready, failed: video: remotion exited 1");
  expect(renderLabel({ state: "failed", done: 0, total: 3, error: "engine down" })).toBe("failed: engine down");
  expect(renderLabel({ state: "done", done: 0, total: 0 })).toBe("no AI image prompt, text only");
});
