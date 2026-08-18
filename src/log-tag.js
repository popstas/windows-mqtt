// Prefix EVERY physical line of a (possibly multi-line) message with `[level] `.
// The Rust side (`parse_stderr_log`) strips one `[level] ` prefix per line, so a
// multi-line error stack must carry the tag on each line or its continuation
// lines fall back to the default `info` level and get mislabeled.
function tagLines(level, message) {
  return String(message)
    .split('\n')
    .map((line) => `[${level}] ${line}`)
    .join('\n');
}

export { tagLines };
