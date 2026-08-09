"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Check, Copy, RotateCcw, Volume2 } from "lucide-react";
import { cn } from "../lib/utils";
import type { UiMessage } from "../lib/types";
import { parseAssistantOutput } from "../lib/assistant-output";
import { normalizeMarkdownHierarchy } from "../lib/markdown-hierarchy";
import { ImagePreview } from "./image-preview";
import { CodeBlock } from "./code-block";
import { ActivityPanel } from "./activity-panel";

interface MessageProps {
  message: UiMessage;
  isLast?: boolean;
  /** Endpoint synthesizing speech from text. When absent, the speak button is hidden. */
  speechEndpoint?: string;
  onCopy?(text: string): void;
  onRegenerate?(): void;
  onApprove?(): void;
  onDeny?(): void;
}

interface MarkdownCodeProps {
  className?: string;
  children?: React.ReactNode;
}

function UserMessageBubble({ content }: { content: string }) {
  const textRef = React.useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [canExpand, setCanExpand] = React.useState(false);

  React.useLayoutEffect(() => {
    const text = textRef.current;
    if (!text || expanded) return;

    const measureOverflow = () => {
      setCanExpand(text.scrollHeight > text.clientHeight + 1);
    };

    measureOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(text);
    return () => observer.disconnect();
  }, [content, expanded]);

  return (
    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-primary-foreground shadow-sm">
      <p
        ref={textRef}
        className={cn(
          "whitespace-pre-wrap text-sm font-medium leading-relaxed",
          !expanded && "line-clamp-5",
        )}
      >
        {content}
      </p>
      {canExpand && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            "mt-1.5 rounded-sm text-[11px] font-semibold text-primary-foreground/60",
            "transition-colors hover:text-primary-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
          )}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function Message({ message, isLast, speechEndpoint, onCopy, onRegenerate, onApprove, onDeny }: MessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const speak = async () => {
    if (speechEndpoint === undefined || visibleContent.length === 0) return;
    if (speaking) {
      audioRef.current?.pause();
      setSpeaking(false);
      return;
    }
    try {
      const res = await fetch(speechEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: visibleContent }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setSpeaking(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setSpeaking(false);
      };
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  };

  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
  const parsedOutput = React.useMemo(
    () => parseAssistantOutput(message.content, {
      streaming: message.streaming === true,
      hasToolContext: hasToolCalls,
    }),
    [message.content, message.streaming, hasToolCalls],
  );
  const visibleContent = parsedOutput.text;
  const renderedContent = React.useMemo(
    () => normalizeMarkdownHierarchy(visibleContent),
    [visibleContent],
  );
  const hasActivity = hasToolCalls || parsedOutput.artifacts.length > 0;
  const showActivity = hasActivity || message.streaming === true;

  const handleCopy = () => {
    if (onCopy === undefined) return;
    onCopy(visibleContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const markdownComponents = React.useMemo<Components>(
    () => ({
      pre: ({ children }: React.ComponentPropsWithoutRef<"pre">) => {
        const child = React.Children.toArray(children)[0];
        if (!React.isValidElement<MarkdownCodeProps>(child)) {
          return <pre>{children}</pre>;
        }

        const language = child.props.className?.match(/language-([^\s]+)/)?.[1];
        const code = String(child.props.children ?? "");
        return <CodeBlock code={code} language={language} onCopy={onCopy} />;
      },
      code: ({ className, children, ...props }: React.ComponentPropsWithoutRef<"code">) => (
        <code className={cn("response-inline-code", className)} {...props}>
          {children}
        </code>
      ),
      h4: ({ children }) => <h3>{children}</h3>,
      h5: ({ children }) => <h3>{children}</h3>,
      h6: ({ children }) => <h3>{children}</h3>,
    }),
    [onCopy],
  );

  if (isUser) {
    return (
      <div className="flex flex-col px-4 items-end gap-2">
        {message.files && message.files.length > 0 && (
          <div className={cn("flex flex-wrap gap-2 justify-end", message.content.length > 0 && "mb-1")}>
            {message.files.map((file) => (
              <ImagePreview key={file.id} file={file} />
            ))}
          </div>
        )}
        {message.content.length > 0 && (
          <UserMessageBubble content={message.content} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 items-start">
      <div className="w-full space-y-2">
        {message.errored && (
          <div className="mb-2 flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            <span>Error</span>
          </div>
        )}

        {showActivity && (
          <ActivityPanel
            artifacts={parsedOutput.artifacts}
            hasVisibleContent={visibleContent.length > 0}
            latencyMs={message.latencyMs}
            streaming={message.streaming === true}
            toolCalls={message.toolCalls ?? []}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}

        {visibleContent.length > 0 && (
          <article
            className={cn(
              "ai-response response-container",
              message.errored && "text-destructive",
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {renderedContent}
            </ReactMarkdown>
          </article>
        )}

        {!message.streaming && visibleContent.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {onCopy && (
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "h-6 w-6 flex items-center justify-center rounded transition-colors",
                  copied
                    ? "text-emerald-400"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/30",
                )}
                title={copied ? "Copied" : "Copy to clipboard"}
              >
                {copied ? (
                  <Check className="h-3 w-3 animate-in fade-in zoom-in-75 duration-150" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            )}
            {speechEndpoint && (
              <button
                type="button"
                onClick={() => void speak()}
                className={cn(
                  "h-6 w-6 flex items-center justify-center rounded transition-colors",
                  speaking
                    ? "text-primary"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/30",
                )}
                title={speaking ? "Stop speaking" : "Speak this response"}
              >
                <Volume2 className="h-3 w-3" />
              </button>
            )}
            {isLast && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/30 transition-colors"
                title="Regenerate response"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
