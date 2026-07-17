// ─────────────────────────────────────────────────────────────────────────────
// Vitest spec para `resolveMixColor` (Phase 2 §3.30).
//
// Cubre:
//   • happy paths in-bounds para ambas familias
//   • consistencia contra todos los items de RENEWABLE_MIX / NON_RENEWABLE_MIX
//   • fallbacks runtime-safe: NaN / float / negative / out-of-bounds
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  C,
  RENEWABLE_MIX,
  NON_RENEWABLE_MIX,
  resolveMixColor,
} from "../design-tokens";

describe("resolveMixColor", () => {
  describe("renewable family — happy paths", () => {
    it("returns palette hex for valid in-range index", () => {
      expect(resolveMixColor("renewable", 0)).toBe(C.renewableAlt[0]);
      expect(resolveMixColor("renewable", 1)).toBe(C.renewableAlt[1]);
      expect(resolveMixColor("renewable", 2)).toBe(C.renewableAlt[2]);
      expect(resolveMixColor("renewable", 3)).toBe(C.renewableAlt[3]);
    });

    it("matches every RENEWABLE_MIX item by colorIndex", () => {
      RENEWABLE_MIX.forEach((item) => {
        expect(resolveMixColor("renewable", item.colorIndex)).toBe(
          C.renewableAlt[item.colorIndex],
        );
      });
    });
  });

  describe("nonRenewable family — happy paths", () => {
    it("returns palette hex for valid in-range index", () => {
      expect(resolveMixColor("nonRenewable", 0)).toBe(C.nonRenewableAlt[0]);
      expect(resolveMixColor("nonRenewable", 1)).toBe(C.nonRenewableAlt[1]);
      expect(resolveMixColor("nonRenewable", 2)).toBe(C.nonRenewableAlt[2]);
      expect(resolveMixColor("nonRenewable", 3)).toBe(C.nonRenewableAlt[3]);
    });

    it("matches every NON_RENEWABLE_MIX item by colorIndex", () => {
      NON_RENEWABLE_MIX.forEach((item) => {
        expect(resolveMixColor("nonRenewable", item.colorIndex)).toBe(
          C.nonRenewableAlt[item.colorIndex],
        );
      });
    });
  });

  describe("runtime-safe fallbacks", () => {
    it("falls back to renewableDim for negative index", () => {
      expect(resolveMixColor("renewable", -1)).toBe(C.renewableDim);
    });

    it("falls back to renewableDim for out-of-bounds positive index", () => {
      expect(resolveMixColor("renewable", 99)).toBe(C.renewableDim);
      expect(resolveMixColor("renewable", 4)).toBe(C.renewableDim);
    });

    it("falls back to nonRenewableDim for negative / out-of-bounds index", () => {
      expect(resolveMixColor("nonRenewable", -1)).toBe(C.nonRenewableDim);
      expect(resolveMixColor("nonRenewable", 99)).toBe(C.nonRenewableDim);
    });

    it("falls back for NaN", () => {
      expect(resolveMixColor("renewable", NaN)).toBe(C.renewableDim);
      expect(resolveMixColor("nonRenewable", NaN)).toBe(C.nonRenewableDim);
    });

    it("falls back for non-integer float", () => {
      expect(resolveMixColor("renewable", 1.5)).toBe(C.renewableDim);
      expect(resolveMixColor("nonRenewable", 0.99)).toBe(C.nonRenewableDim);
    });

    it("falls back for Infinity", () => {
      expect(resolveMixColor("renewable", Infinity)).toBe(C.renewableDim);
    });
  });

  describe("palette integrity — dual-coding lockdown", () => {
    // ⚠ NOTE: este describe block lockea las CSS vars que el palette
    // resuelve. Phase 3 palette rebalance (legítimo) DEBE actualizar TANTO
    // `frontend/src/index.css` (los dos bloques theme) COMO este spec en el
    // mismo commit. Si renuevan los hex en index.css sin tocar este spec,
    // los tests rompen por contrato, no por bug.
    //
    // §3.44 update: los tokens ya no son hex literales — son referencias
    // `var(--c-X)` resueltas por el browser según `data-theme`. Las vars
    // concretas viven en `index.css` `:root` (dark) y `:root[data-theme="light"]`
    // (light override).
    it("renewableAlt[0..3] reference correct CSS variables (theme-resolved)", () => {
      expect(C.renewableAlt[0]).toBe("var(--c-renewable)");
      expect(C.renewableAlt[1]).toBe("var(--c-non-renewable-dim)");
      expect(C.renewableAlt[2]).toBe("var(--c-accent-cyan)");
      expect(C.renewableAlt[3]).toBe("var(--c-renewable-dim)");
    });

    it("nonRenewableAlt[0..3] reference correct CSS variables", () => {
      expect(C.nonRenewableAlt[0]).toBe("var(--c-accent-purple)");
      expect(C.nonRenewableAlt[1]).toBe("var(--c-accent-pink)");
      expect(C.nonRenewableAlt[2]).toBe("var(--c-accent-gold)");
      expect(C.nonRenewableAlt[3]).toBe("var(--c-accent-orange)");
    });

    it("MIX items stay consistent with palette indices (no drift)", () => {
      // Mix[0..3] deben mapear 1:1 a palette[0..3] en orden. Si alguien
      // edita una paleta sin ajustar MIX[i].colorIndex, este test rompe.
      RENEWABLE_MIX.forEach((item, i) => {
        expect(C.renewableAlt[i]).toBe(
          resolveMixColor("renewable", item.colorIndex),
        );
      });
      NON_RENEWABLE_MIX.forEach((item, i) => {
        expect(C.nonRenewableAlt[i]).toBe(
          resolveMixColor("nonRenewable", item.colorIndex),
        );
      });
    });
  });
});
