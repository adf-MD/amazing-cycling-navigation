import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ConnectivityIcon } from "./ConnectivityIcon.tsx";

describe("ConnectivityIcon", () => {
  it("renders without throwing for both online and offline", () => {
    const { container: online } = render(<ConnectivityIcon online={true} />);
    const { container: offline } = render(<ConnectivityIcon online={false} />);
    expect(online.querySelector("svg")).not.toBeNull();
    expect(offline.querySelector("svg")).not.toBeNull();
  });

  it("is aria-hidden, since the caller always renders adjacent accessible text", () => {
    const { container } = render(<ConnectivityIcon online={true} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("distinguishes offline from online by an added shape element, not colour alone", () => {
    const { container: online } = render(<ConnectivityIcon online={true} />);
    const { container: offline } = render(<ConnectivityIcon online={false} />);

    expect(online.querySelector("line")).toBeNull();
    expect(offline.querySelector("line")).not.toBeNull();
    // Every other glyph element is identical between the two variants —
    // the only structural difference is the added strike.
    expect(online.querySelectorAll("circle, path")).toHaveLength(
      offline.querySelectorAll("circle, path").length,
    );
  });

  it("respects a custom sizePx", () => {
    const { container } = render(<ConnectivityIcon online={true} sizePx={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });

  it("defaults to a 16px size", () => {
    const { container } = render(<ConnectivityIcon online={true} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
  });
});
