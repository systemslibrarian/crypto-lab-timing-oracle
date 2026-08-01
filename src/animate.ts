/**
 * DOM rendering + stepping for the deterministic mechanism animations.
 *
 * All state shown here comes from the pure models in mechanism.ts, so what the
 * learner watches is the exact instruction-level cause of the leak, not a
 * timer-derived approximation. Accessibility: every cell is styled by icon/text
 * AND colour (never colour alone), the counters live in an aria-live region, and
 * the play control has an explicit label.
 */

import {
  traceConstantCompare,
  traceExponent,
  traceVulnerableCompare,
  type CompareTrace,
  type ExponentTrace
} from "./mechanism";

const STEP_MS = 240;

let respectMotion = false;
function prefersReducedMotion(): boolean {
  if (!respectMotion && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * String-compare mechanism
 * ------------------------------------------------------------------ */

type CompareEls = {
  targetRow: HTMLElement;
  guessRow: HTMLElement;
  vulnCount: HTMLElement;
  ctCount: HTMLElement;
  status: HTMLElement;
};

function buildCompareRow(row: HTMLElement, chars: string[], kind: "target" | "guess"): void {
  row.innerHTML = "";
  const labelSpan = document.createElement("span");
  labelSpan.className = "mech-rowlabel";
  labelSpan.textContent = kind === "target" ? "secret" : "guess";
  row.appendChild(labelSpan);
  for (let i = 0; i < chars.length; i += 1) {
    const cell = document.createElement("span");
    cell.className = "mech-cell mech-cell--idle";
    cell.dataset.index = String(i);
    cell.textContent = chars[i];
    row.appendChild(cell);
  }
}

function paintCompareCells(row: HTMLElement, trace: CompareTrace, upTo: number): void {
  const cells = row.querySelectorAll<HTMLElement>(".mech-cell");
  cells.forEach((cell, i) => {
    const step = trace.steps[i];
    let cls = "mech-cell--idle";
    let mark = "";
    if (i <= upTo && step) {
      if (step.status === "match") {
        cls = "mech-cell--match";
        mark = "✓";
      } else if (step.status === "mismatch") {
        cls = "mech-cell--mismatch";
        mark = "✗";
      } else if (step.status === "skipped") {
        cls = "mech-cell--skipped";
        mark = "–";
      } else {
        cls = "mech-cell--scanned";
        mark = "•";
      }
    }
    cell.className = `mech-cell ${cls}`;
    cell.dataset.mark = mark;
  });
}

export type CompareAnimator = {
  render(target: string, guess: string): void;
  destroy(): void;
};

/**
 * Wire the string-compare mechanism panel. Shows the vulnerable early-exit walk
 * next to a running vulnerable/constant-time operation counter, then the counter
 * makes the leak explicit: the vulnerable count changes with the guess while the
 * constant-time count stays pinned to the full length.
 */
export function createCompareAnimator(root: HTMLElement, playButton: HTMLButtonElement): CompareAnimator {
  const els: CompareEls = {
    targetRow: root.querySelector<HTMLElement>("[data-role=target-row]")!,
    guessRow: root.querySelector<HTMLElement>("[data-role=guess-row]")!,
    vulnCount: root.querySelector<HTMLElement>("[data-role=vuln-count]")!,
    ctCount: root.querySelector<HTMLElement>("[data-role=ct-count]")!,
    status: root.querySelector<HTMLElement>("[data-role=mech-status]")!
  };

  let timer = 0;
  let currentTarget = "";
  let currentGuess = "";

  function clearTimer(): void {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
  }

  function render(target: string, guess: string): void {
    clearTimer();
    currentTarget = target;
    currentGuess = guess;
    const vulnTrace = traceVulnerableCompare(target, guess);
    const constTrace = traceConstantCompare(target, guess);
    const maxLen = vulnTrace.steps.length;

    const targetChars = vulnTrace.steps.map((s) => s.targetChar);
    const guessChars = vulnTrace.steps.map((s) => s.guessChar);
    buildCompareRow(els.targetRow, targetChars, "target");
    buildCompareRow(els.guessRow, guessChars, "guess");

    const finish = (): void => {
      paintCompareCells(els.guessRow, vulnTrace, maxLen - 1);
      els.vulnCount.textContent = String(vulnTrace.operations);
      els.ctCount.textContent = String(constTrace.operations);
      const stoppedAt = vulnTrace.firstMismatch;
      if (stoppedAt === -1) {
        els.status.textContent = `Full match: the vulnerable loop ran all ${vulnTrace.operations} byte checks — the slowest possible case.`;
      } else {
        els.status.textContent =
          `Vulnerable loop bailed out at byte ${stoppedAt + 1} of ${maxLen}: only ${vulnTrace.operations} byte checks ran. ` +
          `A closer guess runs MORE checks and takes longer — that difference is the leak. ` +
          `The constant-time compare always runs ${constTrace.operations}.`;
      }
    };

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    let cursor = 0;
    els.vulnCount.textContent = "0";
    els.ctCount.textContent = String(constTrace.operations);
    els.status.textContent = "Stepping the vulnerable compare byte by byte…";

    const tick = (): void => {
      paintCompareCells(els.guessRow, vulnTrace, cursor);
      // Running vulnerable op count = inspected bytes so far (match/mismatch, not skipped).
      const inspected = vulnTrace.steps.slice(0, cursor + 1).filter((s) => s.status !== "skipped").length;
      els.vulnCount.textContent = String(inspected);
      cursor += 1;
      if (cursor < maxLen && vulnTrace.steps[cursor - 1].status !== "mismatch") {
        timer = window.setTimeout(tick, STEP_MS);
      } else {
        // paint any trailing skipped cells at once, then settle final state
        paintCompareCells(els.guessRow, vulnTrace, maxLen - 1);
        finish();
      }
    };
    tick();
  }

  playButton.addEventListener("click", () => {
    // An explicit press of Replay is a request to SEE the animation, so it
    // deliberately bypasses the reduced-motion check for this one run. (The flag
    // name reads backwards: setting it true makes prefersReducedMotion() return
    // false.) Auto-renders on input still jump straight to the end.
    respectMotion = true;
    render(currentTarget, currentGuess);
    respectMotion = false;
  });

  return {
    render,
    destroy(): void {
      clearTimer();
    }
  };
}

/* ------------------------------------------------------------------ *
 * RSA exponent-bit mechanism
 * ------------------------------------------------------------------ */

export type ExponentAnimator = {
  render(value: number): void;
  destroy(): void;
};

function buildBitRow(row: HTMLElement, trace: ExponentTrace): void {
  row.innerHTML = "";
  trace.bits.forEach((bit, i) => {
    const cell = document.createElement("span");
    cell.className = `mech-bit mech-bit--${bit}`;
    cell.dataset.index = String(i);
    cell.textContent = String(bit);
    cell.setAttribute("aria-hidden", "true");
    row.appendChild(cell);
  });
}

/**
 * Wire the RSA square-and-multiply mechanism. Steps across the exponent bits and
 * tallies squares/multiplies for the naive schedule (extra multiply appears only
 * on 1-bits — timing tracks the Hamming weight) versus the ladder (one of each,
 * every bit). The visible per-bit "×" flash on 1-bits is the secret-dependent
 * branch made concrete.
 */
export function createExponentAnimator(root: HTMLElement, playButton: HTMLButtonElement): ExponentAnimator {
  const bitRow = root.querySelector<HTMLElement>("[data-role=bit-row]")!;
  const naiveTally = root.querySelector<HTMLElement>("[data-role=naive-tally]")!;
  const ladderTally = root.querySelector<HTMLElement>("[data-role=ladder-tally]")!;
  const status = root.querySelector<HTMLElement>("[data-role=exp-status]")!;

  let timer = 0;
  let currentValue = 0;

  function clearTimer(): void {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
  }

  function paintTally(trace: ExponentTrace, step: number): void {
    const s = trace.steps[Math.min(step, trace.steps.length - 1)];
    naiveTally.textContent = `${s.naiveSquares} squares · ${s.naiveMultiplies} multiplies`;
    ladderTally.textContent = `${s.ladderSquares} squares · ${s.ladderMultiplies} multiplies`;
  }

  function highlightBit(index: number, active: boolean): void {
    const cells = bitRow.querySelectorAll<HTMLElement>(".mech-bit");
    cells.forEach((cell, i) => {
      cell.classList.toggle("mech-bit--active", active && i === index);
      if (i === index && active && cell.classList.contains("mech-bit--1")) {
        cell.dataset.mark = "×"; // extra multiply fires on this 1-bit
      } else if (i < index || (i === index && !active)) {
        cell.dataset.mark = cell.classList.contains("mech-bit--1") ? "×" : "";
      }
    });
  }

  function render(value: number): void {
    clearTimer();
    currentValue = value;
    const trace = traceExponent(value);
    buildBitRow(bitRow, trace);

    const finish = (): void => {
      highlightBit(trace.bits.length, false);
      paintTally(trace, trace.steps.length - 1);
      status.textContent =
        `Naive did ${trace.naiveMultiplies} multiplies for ${trace.hammingWeight} one-bits — its multiply count IS the secret's Hamming weight, so timing leaks the bits. ` +
        `The ladder did ${trace.ladderMultiplies} multiplies (one per bit) no matter the bit values.`;
    };

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    status.textContent = "Stepping square-and-multiply across the exponent bits…";
    let i = 0;
    const tick = (): void => {
      highlightBit(i, true);
      paintTally(trace, i);
      i += 1;
      if (i < trace.bits.length) {
        timer = window.setTimeout(tick, STEP_MS);
      } else {
        timer = window.setTimeout(finish, STEP_MS);
      }
    };
    tick();
  }

  playButton.addEventListener("click", () => {
    respectMotion = true;
    render(currentValue);
    respectMotion = false;
  });

  return {
    render,
    destroy(): void {
      clearTimer();
    }
  };
}
