import React, { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ children, className }) => {
  const [copied, setCopied] = useState(false);
  const textContent = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-[#ded7c8] bg-[#2a2825] text-[#f7f5f0] group">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#21201d] border-b border-[#3b3834] text-[11px] text-[#a8a297] font-mono">
        <span>{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-[#ffffff] transition cursor-pointer px-1.5 py-0.5 rounded hover:bg-[#3b3834]"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs font-mono leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isStreaming = false,
  className = "",
}) => {
  return (
    <div className={`markdown-content leading-relaxed text-[#2c2b29] ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-serif text-lg sm:text-xl font-bold text-[#2c2b29] mt-3.5 mb-2 border-b border-[#ded7c8] pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif text-base sm:text-lg font-semibold text-[#2c2b29] mt-3 mb-1.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-serif text-sm sm:text-base font-semibold text-[#3d3a33] mt-2.5 mb-1">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2.5 last:mb-0 text-sm leading-relaxed text-[#2c2b29]">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#1f1e1c]">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-[#3a3832]">{children}</em>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-2 space-y-1 text-sm text-[#2c2b29]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-[#2c2b29]">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-0.5">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-[#476340] pl-3.5 py-1.5 my-2.5 bg-[#f5f1e8] text-[#4a463d] italic rounded-r-lg font-serif text-sm">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-3.5 border-t border-[#ded7c8]" />
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClassName, children, ...props }: any) => {
            const isInline = !codeClassName && !String(children).includes("\n");
            if (isInline) {
              return (
                <code
                  className="bg-[#f0ebe1] text-[#78531f] px-1.5 py-0.5 rounded text-xs font-mono border border-[#ded7c8]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={codeClassName}>{children}</CodeBlock>;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 border border-[#ded7c8] rounded-xl">
              <table className="min-w-full divide-y divide-[#ded7c8] text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#f2eee6] text-[#47433b] font-medium">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[#eee9df] bg-[#ffffff]">{children}</tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[#47433b]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-xs text-[#2c2b29]">{children}</td>
          ),
        }}
      >
        {content}
      </Markdown>

      {/* Professional AI Chatbot Streaming Cursor */}
      {isStreaming && (
        <span
          className="inline-block w-2 h-4 ml-1 bg-[#476340] rounded-xs animate-pulse align-middle shadow-[0_0_8px_rgba(71,99,64,0.4)]"
          title="Streaming response..."
        />
      )}
    </div>
  );
};
