import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The renderer lives outside the app package (it runs from bash and from a spawned process), so
// it is imported by URL: a literal specifier would make tsc try to type-resolve a plain .mjs.
const engineDir = path.resolve(__dirname, "..", "..", "engine");
const importRenderer = () => import(pathToFileURL(path.join(engineDir, "render-visual.mjs")).href);
const workflowText = () => fs.readFileSync(path.join(engineDir, "workflows", "linkedin-hero-flux.json"), "utf8");

// renderedVisualOptions() is what tells a draft card "this option already has an image", so the
// card can show the PNG instead of firing a request that 404s. It reads a directory of files
// written by an external renderer, which is exactly the kind of input that arrives malformed.

let tmp: string;
let visualsDir: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-visuals-"));
  visualsDir = path.join(tmp, ".visuals");
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ author: { name: "T" }, brand: { name: "B" }, output: { draftsDir: tmp }, app: {} })
  );
  process.env.SHIPPOST_CONFIG = path.join(tmp, "config.json");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("renderedVisualOptions", () => {
  it("returns [] when nothing has ever been rendered (no .visuals dir)", async () => {
    const { renderedVisualOptions } = await import("@/lib/drafts");
    expect(renderedVisualOptions("2026-09-06_145923")).toEqual([]);
  });

  it("lists only this draft's option numbers, sorted, ignoring other drafts and stray files", async () => {
    const { renderedVisualOptions } = await import("@/lib/drafts");
    fs.mkdirSync(visualsDir, { recursive: true });
    for (const f of [
      "2026-09-06_145923-o3.png",
      "2026-09-06_145923-o1.png",
      "2026-09-06_145923-o1.png.tmp", // a render in flight must not count as done
      "2026-09-05_091738-o1.png", // a different draft
      "2026-09-06_145923.png", // no option suffix
      "notes.txt",
    ]) {
      fs.writeFileSync(path.join(visualsDir, f), "x");
    }
    expect(renderedVisualOptions("2026-09-06_145923")).toEqual([1, 3]);
    expect(renderedVisualOptions("2026-09-05_091738")).toEqual([1]);
  });

  it("lists carousels separately from heroes, and hides one older than the draft it was built from", async () => {
    const { carouselOptions, renderedVisualOptions } = await import("@/lib/drafts");
    // "Edit with AI" rewrites an option in place and keeps its number, so a PDF built before an
    // edit would keep its filename while holding copy the post no longer says.
    fs.mkdirSync(visualsDir, { recursive: true });
    fs.writeFileSync(path.join(visualsDir, "2026-09-06_145923-o2.pdf"), "x");
    fs.writeFileSync(path.join(visualsDir, "2026-09-06_145923-o4.pdf"), "x");
    fs.writeFileSync(path.join(tmp, "2026-09-06_145923.md"), "# draft");
    // o2 predates the draft file, o4 postdates it
    const draftMtime = fs.statSync(path.join(tmp, "2026-09-06_145923.md")).mtime;
    fs.utimesSync(path.join(visualsDir, "2026-09-06_145923-o2.pdf"), draftMtime, new Date(draftMtime.getTime() - 60_000));
    fs.utimesSync(path.join(visualsDir, "2026-09-06_145923-o4.pdf"), draftMtime, new Date(draftMtime.getTime() + 60_000));
    expect(carouselOptions("2026-09-06_145923")).toEqual([4]);
    // the hero listing is untouched by any of this
    expect(renderedVisualOptions("2026-09-06_145923")).toEqual([1, 3]);
  });

  it("refuses a malformed draft id instead of globbing the directory with it", async () => {
    const { renderedVisualOptions } = await import("@/lib/drafts");
    // A traversal attempt and a regex metacharacter both fail the draft-id guard, so neither
    // reaches readdir and neither can be interpreted as a pattern.
    expect(renderedVisualOptions("../../etc")).toEqual([]);
    expect(renderedVisualOptions(".*")).toEqual([]);
    expect(renderedVisualOptions("")).toEqual([]);
  });
});

// The renderer is plain ESM under engine/ (it has to run from bash and from a spawned process,
// with no bundler), but its graph building is pure and worth pinning here: a prompt is arbitrary
// user-ish text and it ends up inside a JSON document ComfyUI must accept.
describe("render-visual: buildGraph", () => {
  it("puts a prompt containing quotes and backslashes into the graph without breaking the JSON", async () => {
    const { buildGraph } = await importRenderer();
    const template = workflowText();
    const nasty = 'a "velvet" rope, path C:\\studio, 50% \u2014 {"not":"json"}';
    const graph = buildGraph(template, nasty, 47);

    expect(graph["2"].inputs.text).toBe(nasty);
    // the whole graph must still survive a JSON round trip - that is what gets POSTed
    expect(JSON.parse(JSON.stringify(graph))["2"].inputs.text).toBe(nasty);
  });

  it("sends the seed as a number (KSampler's seed input is typed INT) and keeps the pinned settings", async () => {
    const { buildGraph } = await importRenderer();
    const graph = buildGraph(workflowText(), "a prompt", 1234);
    expect(typeof graph["4"].inputs.seed).toBe("number");
    expect(graph["4"].inputs.seed).toBe(1234);
    // flux-schnell settings, pinned: changing any of these silently ruins every render
    expect(graph["4"].inputs.steps).toBe(4);
    expect(graph["4"].inputs.cfg).toBe(1.0);
    expect(graph["4"].inputs.sampler_name).toBe("euler");
    expect(graph["4"].inputs.scheduler).toBe("simple");
    expect(graph["1"].inputs.ckpt_name).toBe("flux1-schnell-fp8.safetensors");
    // 1088x1360 is the renderable multiple-of-16 size that downscales exactly to 1080x1350
    expect(graph["3"].inputs).toMatchObject({ width: 1088, height: 1360, batch_size: 1 });
    expect(graph["5"].inputs.text).toBe(""); // empty negative, required by the schema at cfg 1.0
  });

  it("refuses a workflow whose nodes were renamed rather than writing the prompt nowhere", async () => {
    const { buildGraph } = await importRenderer();
    expect(() => buildGraph(JSON.stringify({ "2": { class_type: "Nope", inputs: {} } }), "p", 1)).toThrow(
      /changed shape/
    );
  });
});

describe("render-visual: errorFromHistory", () => {
  it("reports a failed execution so the poll loop stops instead of waiting out its timeout", async () => {
    const { errorFromHistory } = await importRenderer();
    const history = {
      abc: {
        status: {
          status_str: "error",
          messages: [["execution_start", {}], ["execution_error", { exception_message: "MPS out of memory" }]],
        },
        outputs: {},
      },
    };
    expect(errorFromHistory(history, "abc")).toBe("MPS out of memory");
    expect(errorFromHistory({ abc: { status: { status_str: "success" }, outputs: {} } }, "abc")).toBeNull();
    expect(errorFromHistory({}, "abc")).toBeNull(); // still queued - not an error
  });
});
