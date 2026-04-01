import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BudgetWarningBanner } from "../src/components/budget-warning-banner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("BudgetWarningBanner", () => {
  it("renders warning copy with API key and upgrade actions", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <BudgetWarningBanner status="warning" onDismiss={vi.fn()} />
      </MemoryRouter>,
    );

    expect(markup).toContain("budget.banner.warningTitle");
    expect(markup).toContain("budget.banner.warningDescription");
    expect(markup).toContain("budget.banner.apiKey");
    expect(markup).toContain("budget.banner.upgrade");
    expect(markup).not.toContain("budget.banner.depletedTitle");
  });

  it("renders depleted copy separately from warning state", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <BudgetWarningBanner status="depleted" onDismiss={vi.fn()} />
      </MemoryRouter>,
    );

    expect(markup).toContain("budget.banner.depletedTitle");
    expect(markup).toContain("budget.banner.depletedDescription");
    expect(markup).not.toContain("budget.banner.warningTitle");
  });
});
