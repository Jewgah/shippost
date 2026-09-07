import { describe, it, expect, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMFY_DEFAULT_URL,
  canStartLocally,
  clearRenderPhase,
  comfyBaseUrl,
  comfyIsUp,
  comfyLogPath,
  comfyProbeUrl,
  engineStartError,
  phaseFilePath,
  readRenderPhase,
  starterDiagnosis,
  writeRenderPhase,
} from "@/lib/comfy";

// /api/render decides ONE thing before it does any work: is ComfyUI already answering, or does
// this click have to start it first. Everything the card then shows (a "starting" hint instead
// of a two-minute bare spinner, an error naming the log to read) hangs off that decision, so the
// pieces of it are pinned here rather than only exercised through a spawn.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shippost-comfy-"));
const phaseFile = phaseFilePath(tmp);

afterEach(() => {
  fs.rmSync(phaseFile, { force: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("comfyBaseUrl", () => {
  it("defaults to the one port the engine actually starts", () => {
    expect(comfyBaseUrl({})).toBe(COMFY_DEFAULT_URL);
    expect(comfyBaseUrl({ SHIPPOST_COMFY_URL: "" })).toBe(COMFY_DEFAULT_URL);
    expect(comfyBaseUrl({ SHIPPOST_COMFY_URL: "   " })).toBe(COMFY_DEFAULT_URL);
  });

  it("honours SHIPPOST_COMFY_URL, trimmed", () => {
    expect(comfyBaseUrl({ SHIPPOST_COMFY_URL: " http://127.0.0.1:9000 " })).toBe("http://127.0.0.1:9000");
  });

  it("honours SHIPPOST_COMFY_PORT the way comfy-headless.sh does, URL still winning", () => {
    // The renderer reads URL only, so without this the route would probe 8188, start a server on
    // 8189, flip the card to "rendering", and then watch the renderer exit 2 against 8188.
    expect(comfyBaseUrl({ SHIPPOST_COMFY_PORT: "8189" })).toBe("http://127.0.0.1:8189");
    expect(comfyBaseUrl({ SHIPPOST_COMFY_PORT: " 8189 " })).toBe("http://127.0.0.1:8189");
    expect(comfyBaseUrl({ SHIPPOST_COMFY_URL: "http://gpu.local:7000", SHIPPOST_COMFY_PORT: "8189" })).toBe(
      "http://gpu.local:7000"
    );
    // Not a port number: fall back rather than build a URL that cannot resolve.
    expect(comfyBaseUrl({ SHIPPOST_COMFY_PORT: "eight-one-eight-nine" })).toBe(COMFY_DEFAULT_URL);
  });
});

describe("starterDiagnosis", () => {
  it("takes the script's own line, not the last one", () => {
    // Measured: comfy-headless.sh's no-venv failure prints the cause first and a generic install
    // hint second, so a last-line convention would show the hint and hide the path.
    const stderr =
      "shippost: no ComfyUI venv at /tmp/no-comfy-here/venv/bin/python\n" +
      "  Install ComfyUI (https://github.com/comfyanonymous/ComfyUI) or set SHIPPOST_COMFY_DIR.\n";
    expect(starterDiagnosis(stderr)).toBe("shippost: no ComfyUI venv at /tmp/no-comfy-here/venv/bin/python");
  });

  it("falls back to the first line when nothing is prefixed, and to null when there is nothing", () => {
    expect(starterDiagnosis("bash: jq: command not found\nsomething else\n")).toBe("bash: jq: command not found");
    expect(starterDiagnosis("   \n\n")).toBeNull();
    expect(starterDiagnosis("")).toBeNull();
  });
});

describe("comfyProbeUrl", () => {
  it("does not produce a doubled slash when the base carries a trailing one", () => {
    expect(comfyProbeUrl("http://127.0.0.1:8188")).toBe("http://127.0.0.1:8188/system_stats");
    expect(comfyProbeUrl("http://127.0.0.1:8188//")).toBe("http://127.0.0.1:8188/system_stats");
  });

  it("resolves a trailing slash away at the source, since the base is also given to the renderer", () => {
    expect(comfyBaseUrl({ SHIPPOST_COMFY_URL: "http://127.0.0.1:8188/" })).toBe("http://127.0.0.1:8188");
  });
});

describe("canStartLocally", () => {
  it("allows the loopback forms the script can actually bring up", () => {
    for (const base of ["http://127.0.0.1:8188", "http://localhost:8188", "http://[::1]:8188", "http://0.0.0.0:8188"]) {
      expect(canStartLocally(base)).toBe(true);
    }
  });

  it("refuses a remote engine, which the starter would answer by booting a local one", () => {
    // comfy-headless.sh always launches `main.py --listen 127.0.0.1` and only POLLS the
    // configured URL, so starting on behalf of a remote base costs ~20 GB here, waits out the
    // full 180 s against a host that was never going to answer, and then reports failure.
    expect(canStartLocally("http://gpu.local:7000")).toBe(false);
    expect(canStartLocally("http://192.168.1.50:8188")).toBe(false);
    expect(canStartLocally("not a url at all")).toBe(false);
    expect(canStartLocally("")).toBe(false);
  });
});

describe("comfyLogPath / engineStartError", () => {
  it("names the file comfy-headless.sh actually appends to", () => {
    expect(comfyLogPath("/drafts")).toBe("/drafts/.comfy.log");
  });

  it("quotes the diagnosis and names the log when there is one to read", () => {
    // A server that died 40 s into loading leaves its reason only in the log, so the path earns
    // its place in the message whenever the file exists.
    expect(engineStartError("shippost: ComfyUI exited during startup", "/drafts/.comfy.log")).toBe(
      "Couldn't start the image engine: shippost: ComfyUI exited during startup. See /drafts/.comfy.log"
    );
    // A detail that already ends in a period must not produce "…startup.. See …".
    expect(engineStartError("shippost: ComfyUI exited during startup.", "/drafts/.comfy.log")).toBe(
      "Couldn't start the image engine: shippost: ComfyUI exited during startup. See /drafts/.comfy.log"
    );
    expect(engineStartError(null, "/drafts/.comfy.log")).toBe(
      "Couldn't start the image engine. See /drafts/.comfy.log"
    );
  });

  it("does not name a log that was never written", () => {
    // The no-venv path exits before the script creates the drafts dir or the log, so naming the
    // file would send someone after something that is not there.
    expect(engineStartError("shippost: no ComfyUI venv at /nope/venv/bin/python", null)).toBe(
      "Couldn't start the image engine: shippost: no ComfyUI venv at /nope/venv/bin/python."
    );
    expect(engineStartError("   ", null)).toBe("Couldn't start the image engine.");
    expect(engineStartError()).toBe("Couldn't start the image engine.");
  });
});

describe("render phase file", () => {
  it("round-trips a phase while a run holds the lock", () => {
    writeRenderPhase(phaseFile, "starting");
    expect(readRenderPhase(phaseFile, true)).toBe("starting");
    writeRenderPhase(phaseFile, "rendering");
    expect(readRenderPhase(phaseFile, true)).toBe("rendering");
  });

  it("reports nothing once the run is no longer running", () => {
    // A killed run leaves its phase file behind; without this the card would claim "starting"
    // forever, on a run that is not running at all.
    writeRenderPhase(phaseFile, "starting");
    expect(readRenderPhase(phaseFile, false)).toBeNull();
  });

  it("treats a missing or unrecognised file as no phase rather than throwing", () => {
    expect(readRenderPhase(phaseFile, true)).toBeNull(); // never written
    fs.writeFileSync(phaseFile, "half-written-garbage");
    expect(readRenderPhase(phaseFile, true)).toBeNull();
  });

  it("clears, and clearing twice is not an error", () => {
    writeRenderPhase(phaseFile, "rendering");
    clearRenderPhase(phaseFile);
    expect(fs.existsSync(phaseFile)).toBe(false);
    expect(() => clearRenderPhase(phaseFile)).not.toThrow();
  });

  it("never throws when the phase cannot be written (an unwritable path is not a failed render)", () => {
    expect(() => writeRenderPhase(path.join(tmp, "no-such-dir", ".render_phase"), "starting")).not.toThrow();
  });
});

describe("comfyIsUp", () => {
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("is true only for an ok response, and swallows a refused connection", async () => {
    await withFetch(async () => new Response("{}", { status: 200 }), async () => {
      expect(await comfyIsUp("http://127.0.0.1:8188")).toBe(true);
    });
    // A server answering 404 on /system_stats is not the server we want to POST a graph to.
    await withFetch(async () => new Response("nope", { status: 404 }), async () => {
      expect(await comfyIsUp("http://127.0.0.1:8188")).toBe(false);
    });
    await withFetch(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        expect(await comfyIsUp("http://127.0.0.1:8188")).toBe(false);
      }
    );
  });

  it("probes the resolved base URL, not a hardcoded one", async () => {
    let seen = "";
    await withFetch(
      async (input: RequestInfo | URL) => {
        seen = String(input);
        return new Response("{}", { status: 200 });
      },
      async () => {
        await comfyIsUp("http://127.0.0.1:9999");
      }
    );
    expect(seen).toBe("http://127.0.0.1:9999/system_stats");
  });
});
