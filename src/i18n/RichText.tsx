import { Fragment, type ReactNode } from "react";
import { placeholderPattern } from "./catalogue.ts";
import type { RichMessageKey, Translator } from "./translate.ts";

export interface RichTextProps {
  /** Only a rich key is accepted — a plain key fails to compile. */
  messageKey: RichMessageKey;
  translator: Translator;
  /** One node per `{placeholder}` in the message. */
  values: Readonly<Record<string, ReactNode>>;
}

/**
 * Renders a message whose placeholders are substituted with React nodes —
 * a link, an emphasised phrase — without `dangerouslySetInnerHTML` and
 * without splitting the sentence at the call site.
 *
 * Backlog item 113. This is why rich messages are their own catalogue
 * kind: a sentence assembled from JSX fragments cannot be reordered by a
 * translator, and German frequently needs to reorder it. Here the whole
 * sentence lives in the catalogue and only the nodes are injected.
 *
 * A missing value renders the placeholder's own name in braces rather
 * than silently vanishing, so the gap is visible in a test; the parity
 * test in this directory is what prevents it reaching a build at all.
 */
export function RichText({ messageKey, translator, values }: RichTextProps) {
  const template = translator.richTemplate(messageKey);
  const parts: ReactNode[] = [];
  const pattern = placeholderPattern();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(template)) !== null) {
    const name = match[1] ?? "";
    if (match.index > lastIndex) {
      parts.push(template.slice(lastIndex, match.index));
    }
    parts.push(name in values ? values[name] : `{${name}}`);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < template.length) parts.push(template.slice(lastIndex));

  return (
    <>
      {parts.map((part, index) => (
        // The index is a stable identity here: the parts come from one
        // immutable template string, so a given position always holds the
        // same literal or the same placeholder.
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
