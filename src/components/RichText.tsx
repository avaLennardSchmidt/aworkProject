import { createElement, Fragment, useMemo, type ReactNode } from "react";

/**
 * Renders an awork rich-text description (HTML) as a SAFE subset of React
 * elements — headings, lists, links, basic inline marks. It never uses
 * dangerouslySetInnerHTML: the HTML is parsed with the inert DOMParser and only
 * whitelisted tags/attributes are reconstructed, so embedded scripts, event
 * handlers, and javascript:/data: URLs are dropped.
 */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "hr",
]);
const INLINE_TAGS = new Set([
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "span",
]);

export function RichText({ html }: { html: string }) {
  const nodes = useMemo(() => parseRichText(html), [html]);
  return <div className="detail-richtext">{nodes}</div>;
}

function parseRichText(html: string): ReactNode {
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return html;
  }
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return convertChildren(doc.body);
}

function convertChildren(node: Node): ReactNode[] {
  const out: ReactNode[] = [];
  node.childNodes.forEach((child, index) => {
    const converted = convertNode(child, index);
    if (converted !== null && converted !== undefined) {
      out.push(converted);
    }
  });
  return out;
}

function convertNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "script" || tag === "style") {
    return null;
  }
  if (tag === "br") {
    return <br key={key} />;
  }
  if (tag === "hr") {
    return <hr key={key} />;
  }

  const children = convertChildren(element);

  if (tag === "a") {
    const href = sanitizeHref(element.getAttribute("href"));
    if (!href) {
      return <Fragment key={key}>{children}</Fragment>;
    }
    return (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  if (BLOCK_TAGS.has(tag) || INLINE_TAGS.has(tag)) {
    // Strip every attribute — we reconstruct only the tag name, no styles/handlers.
    return createElement(tag, { key }, children.length > 0 ? children : undefined);
  }

  // Unknown tag: keep its text content, drop the wrapper.
  return <Fragment key={key}>{children}</Fragment>;
}

function sanitizeHref(href: string | null): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href, window.location.origin);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) {
      return href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
