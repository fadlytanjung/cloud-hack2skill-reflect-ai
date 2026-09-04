// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "../MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders headings, emphasis, and lists as semantic elements", () => {
    render(
      <MarkdownRenderer
        content={
          "# Title\n\n## Section\n\nSome **bold** and *italic* prose.\n\n- first\n- second\n\n1. one\n2. two"
        }
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders a blockquote and a horizontal rule", () => {
    const { container } = render(<MarkdownRenderer content={"> quoted insight\n\n---\n"} />);
    expect(container.querySelector("blockquote")).toHaveTextContent("quoted insight");
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("renders a GFM table, which requires the remark-gfm plugin", () => {
    render(<MarkdownRenderer content={"| Mood | Count |\n| --- | --- |\n| Calm | 3 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Mood" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Calm" })).toBeInTheDocument();
  });

  it("renders inline code without the copy affordance", () => {
    render(<MarkdownRenderer content={"Use `npm test` to verify."} />);
    expect(screen.getByText("npm test").tagName).toBe("CODE");
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("renders a fenced block with its language label and a copy button", () => {
    render(<MarkdownRenderer content={"```typescript\nconst a = 1;\n```"} />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByTitle("Copy code")).toBeInTheDocument();
  });

  it("labels an unlabelled fenced block as 'code'", () => {
    render(<MarkdownRenderer content={"```\nplain\n```"} />);
    expect(screen.getByText("code")).toBeInTheDocument();
  });

  it("copies the fenced block's contents to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownRenderer content={"```js\nconst a = 1;\n```"} />);
    await userEvent.click(screen.getByTitle("Copy code"));

    // The trailing newline react-markdown appends is trimmed off.
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
    expect(screen.getByText("Copied")).toBeInTheDocument();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("reverts the copy confirmation after two seconds", async () => {
    // fireEvent rather than userEvent: userEvent's own scheduling does not mix
    // with vitest fake timers.
    vi.useFakeTimers();
    try {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
      render(<MarkdownRenderer content={"```js\nconst a = 1;\n```"} />);

      fireEvent.click(screen.getByTitle("Copy code"));
      expect(screen.getByText("Copied")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText("Copy")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not execute or emit raw HTML from model output", () => {
    // react-markdown escapes HTML by default; no rehype-raw is configured.
    const { container } = render(
      <MarkdownRenderer content={'<script>window.__pwned = true</script><img src=x onerror=alert(1)>'} />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it("shows the streaming cursor only while streaming", () => {
    const { container, rerender } = render(<MarkdownRenderer content="partial" isStreaming />);
    expect(container.querySelector('[title="Streaming response..."]')).toBeInTheDocument();
    rerender(<MarkdownRenderer content="partial" />);
    expect(container.querySelector('[title="Streaming response..."]')).toBeNull();
  });

  it("applies a caller-supplied class alongside its own", () => {
    const { container } = render(<MarkdownRenderer content="x" className="custom-class" />);
    expect(container.firstElementChild).toHaveClass("markdown-content", "custom-class");
  });

  it("renders empty content without crashing", () => {
    expect(() => render(<MarkdownRenderer content="" />)).not.toThrow();
  });
});
