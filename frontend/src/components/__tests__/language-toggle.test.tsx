import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider } from "@/i18n";
import { LanguageToggle } from "@/components/language-toggle";

describe("LanguageToggle", () => {
  it("toggles between zh and en", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <LanguageToggle />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "中文" }));
  });
});

