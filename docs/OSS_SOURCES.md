# Open Source Sources for Takeoff MVP

This document tracks external projects reviewed for the takeoff MVP, what we reuse, and how we stay license-safe.

## Can we extract without forking?

Yes. We do not need to fork to benefit from open source.

Practical options:

1. Re-implement algorithms and UX patterns from public source (safest default).
2. Vendor selected files directly into this repo with attribution and license notices (only when license permits).
3. Add a dependency/package and call it directly (when technically compatible).

For openmud, option 1 is preferred for frontend takeoff UI and parsing logic.

## Reviewed sources

## 1) elstruck/pdf-takeoff
- Repo: https://github.com/elstruck/pdf-takeoff
- What is useful:
  - Two-canvas workflow (base PDF + annotation overlay)
  - Calibration flow (known distance -> pixels-per-unit)
  - Linear + area measurement interactions
- License status:
  - README says MIT.
  - Repository currently has no `LICENSE` file in root via API.
  - GitHub does not detect a license for this repo metadata.
- Decision:
  - Use as a behavioral reference only until license file is present.
  - Do not copy code verbatim right now.

## 2) ocrmypdf/OCRmyPDF
- Repo: https://github.com/ocrmypdf/OCRmyPDF
- License: MPL-2.0 (detected)
- What is useful:
  - Mature OCR pipeline architecture for scanned PDFs
  - Robust OCR preprocessing conventions
- Decision:
  - Use as architecture reference for server-side OCR phase.
  - If code reuse is needed later, keep MPL obligations in a clearly isolated module.

## 3) Zinalr44/AI-Powered-Material-Estimation-from-Architectural-PDFs
- Repo: https://github.com/Zinalr44/AI-Powered-Material-Estimation-from-Architectural-PDFs
- What is useful:
  - Practical extraction flow: PDF text + OCR + structured estimation output
  - Prompt-to-structured-output approach
- License status:
  - No detected license in repository metadata.
- Decision:
  - Reference pipeline ideas only.
  - Do not copy source files directly.

## 4) anomalyco/opencode
- Repo: https://github.com/anomalyco/opencode
- License: MIT
- What is useful:
  - Agent orchestration patterns (tool routing, retries, provider abstraction)
- Decision:
  - Use architecture patterns for chat tooling evolution.
  - Not a direct code import target for takeoff UI.

## What we already adopted in openmud

In `public/pages/takeoff.html`, we have already adopted:
- two-layer measurement canvas interaction
- calibration-first workflow
- structured takeoff line extraction
- measurement candidate normalization

This implementation is native to openmud code and not a direct copy.

## Next pull-in plan (no fork required)

1. Extract takeoff measurement logic into `public/js/takeoff/measurement-core.js`.
2. Add area polygon measurement mode and per-page measurement persistence.
3. Add server-side scanned OCR fallback with:
   - `pdf2image` + `pytesseract` + preprocessing
   - confidence notes per page
4. Add tests for:
   - calibration math
   - distance/area calculations
   - token and measurement extraction from sample plans

