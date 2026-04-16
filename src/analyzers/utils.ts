/**
 * Extract the brace-delimited body starting from a given position in the source.
 * Finds the first `{` at or after `startIndex`, then counts braces to find
 * the matching `}`. Returns the substring between (and including) those braces,
 * or the remainder of the string if no balanced closing brace is found.
 */
export function extractBraceBody(content: string, startIndex: number): string {
  const openIdx = content.indexOf("{", startIndex);
  if (openIdx === -1) return "";
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        return content.substring(openIdx, i + 1);
      }
    }
  }
  return content.substring(openIdx);
}
