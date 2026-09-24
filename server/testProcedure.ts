// Port of routes/test_procedure.py — parse the checklist markdown into
// structured sections/tests/steps for the interactive Test Procedure page.
import fs from "fs";
import path from "path";
import { DOCS_MD_DIR } from "./docsMeta";

const SOURCES: Record<string, string> = {
  accounting: "ACCOUNTING_TASKS.md",
  technical: "TEST_PROCEDURE.md",
};

const RE_SECTION = /^##\s+§(\d+)\s+(.+?)\s*$/;
const RE_TC = /^###\s+((?:TC|AT)-\d+-\d+[a-z]?):?\s+(.+?)\s*$/;
const RE_STEP = /^(\d+)\.\s+(.+?)\s*$/;
const RE_META = /^\*\*([A-Z][\w\- ]+?):\*\*\s+(.+?)\s*$/;
const RE_HRULE = /^-{3,}\s*$/;

interface Step { num: number; text: string; expected: string; details: string[] | string }
interface Tc { id: string; title: string; priority: string; type: string; preconditions: string; steps: Step[] }
interface Section { section_num: number; section: string; tests: Tc[] }

function parseTestProcedure(text: string): Section[] {
  const sections: Section[] = [];
  let curSection: Section | null = null;
  let curTc: Tc | null = null;
  let curStep: Step | null = null;
  let inSteps = false;

  const flushStep = () => {
    if (curStep != null) { curTc!.steps.push(curStep); curStep = null; }
  };
  const flushTc = () => {
    flushStep();
    if (curTc != null) { curSection!.tests.push(curTc); curTc = null; }
  };
  const flushSection = () => {
    flushTc();
    if (curSection != null) { sections.push(curSection); curSection = null; }
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");

    if (RE_HRULE.test(line)) { flushTc(); inSteps = false; continue; }

    let m = RE_SECTION.exec(line);
    if (m) {
      flushSection();
      curSection = { section_num: Number(m[1]), section: m[2], tests: [] };
      inSteps = false;
      continue;
    }

    m = RE_TC.exec(line);
    if (m && curSection != null) {
      flushTc();
      curTc = { id: m[1], title: m[2], priority: "", type: "", preconditions: "", steps: [] };
      inSteps = false;
      continue;
    }

    if (curTc == null) continue;

    m = RE_META.exec(line);
    if (m && !inSteps && curStep == null) {
      const key = m[1].toLowerCase(), val = m[2];
      if (key.includes("priority")) {
        curTc.priority = val.split("·")[0].trim();
        if (val.toLowerCase().includes("type")) {
          const tm = /\*\*Type:\*\*\s+(.+)/i.exec(val);
          if (tm) curTc.type = tm[1].trim();
        }
      } else if (key.trim() === "type") {
        curTc.type = val;
      } else if (key.includes("pre-conditions") || key.includes("preconditions")) {
        curTc.preconditions = val;
      }
      continue;
    }

    if (line.trim().toLowerCase().startsWith("**steps:**")) { inSteps = true; continue; }

    m = RE_STEP.exec(line);
    if (m) {
      flushStep();
      inSteps = true;
      curStep = { num: Number(m[1]), text: m[2], expected: "", details: [] };
      continue;
    }

    const stripped = line.trim();
    if (curStep == null && stripped && !stripped.startsWith("**")) {
      // Content before any explicit step → synthesize step 1.
      inSteps = true;
      curStep = { num: 1, text: "Run the test", expected: "", details: [] };
    }

    if (curStep != null) {
      const details = curStep.details as string[];
      if (!stripped) { details.push(""); continue; }
      if (stripped.startsWith("- **Expected:**")) {
        curStep.expected = stripped.slice("- **Expected:**".length).trim();
        continue;
      }
      if (stripped.startsWith("**Expected:**")) {
        curStep.expected = stripped.slice("**Expected:**".length).trim();
        continue;
      }
      if (stripped.startsWith("- [ ] Pass") || stripped.startsWith("[ ] Pass")) continue;
      details.push(line);
    }
  }
  flushSection();

  const nonEmpty = sections.filter(s => s.tests.length);
  for (const s of nonEmpty) {
    for (const t of s.tests) {
      for (const step of t.steps) step.details = (step.details as string[]).join("\n").trim();
    }
  }
  return nonEmpty;
}

const cache = new Map<string, { mtime: number; data: Section[] }>();

export function loadTestProcedure(source: string) {
  const filename = SOURCES[source] ?? SOURCES.accounting;
  const fp = path.join(DOCS_MD_DIR, filename);
  if (!fs.existsSync(fp)) return { notFound: `docs/${filename} not found` };
  const mtime = fs.statSync(fp).mtimeMs / 1000;
  let entry = cache.get(filename);
  if (!entry || entry.mtime !== mtime) {
    entry = { mtime, data: parseTestProcedure(fs.readFileSync(fp, "utf-8")) };
    cache.set(filename, entry);
  }
  const sections = entry.data;
  return {
    source,
    filename: `docs/${filename}`,
    sections,
    total_tests: sections.reduce((s, x) => s + x.tests.length, 0),
    total_steps: sections.reduce((s, x) => s + x.tests.reduce((a, t) => a + t.steps.length, 0), 0),
    mtime: Math.floor(mtime),
  };
}
