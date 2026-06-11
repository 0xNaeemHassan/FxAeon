// Real English translator for unit-test mock contexts (W-21).
// Tests assert against actual catalog content, so copy drift fails CI.
import { i18n } from "../../src/i18n";

export const tEn = (key: string, vars?: Record<string, unknown>): string =>
  i18n.t("en", key, vars as never);
