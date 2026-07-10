// Single SSE-transport for a streaming completion. chatStream (message-in,
// answer-out) and streamChat (raw messages + tool-calls) had this ~40-line
// Promise body copy-pasted twice — the buffered newline split, parseSseLine,
// reasoning/answer routing, tool-call accumulation, timeout, cooperative abort,
// and error handling. It lives ONCE here; both callers build their payload and
// hand the JSON body to streamCompletion, which returns the answer text plus any
// assembled tool calls (empty for the plain chat path, which sends no tools).
import http from 'http';
import { parseSseLine, createThinkSplitter, createToolCallAccumulator, type AssembledToolCall } from './sse-stream';
import { modelRequestOptions } from './http-post';

export interface StreamResult {
  content: string;
  toolCalls: AssembledToolCall[];
}

export interface StreamOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

/**
 * POST a `stream: true` completion body to the local model server and stream the
 * response. `onDelta` fires per token, separated into the reasoning channel
 * (delta.reasoning_content or text inside think tags, via the splitter) and the
 * answer channel. Resolves with the full answer + any tool calls the model
 * emitted when the stream ends, on abort (returning whatever streamed so far),
 * and rejects on a non-200 status, transport error, or timeout.
 *
 * Fresh connection per request (llm/http-post modelRequestOptions) — no
 * keep-alive pool, so the tool loop's back-to-back requests never hit a
 * half-closed socket (ECONNRESET).
 */
export function streamCompletion(
  port: number,
  body: string,
  onDelta: (text: string, kind: 'content' | 'reasoning') => void,
  opts: StreamOptions
): Promise<StreamResult> {
  return new Promise<StreamResult>((resolve, reject) => {
    let buf = '';
    let timedOut = false;
    let aborted = false;
    // Stateful think-tag splitter: routes inline reasoning vs answer and
    // accumulates the answer text across chunk boundaries (see sse-stream.ts).
    const splitter = createThinkSplitter((ev) => onDelta(ev.text, ev.kind));
    const tools = createToolCallAccumulator();
    const done = (): StreamResult => ({ content: splitter.answer(), toolCalls: tools.list() });
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      reject(new Error('LLM request timed out'));
    }, opts.timeoutMs);

    const req = http.request(modelRequestOptions(port, Buffer.byteLength(body)), (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        reject(new Error(`LLM Server Error: ${res.statusCode}`));
        res.resume();
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const delta = parseSseLine(line);
          if (!delta) {
            continue;
          }
          if (delta.reasoning_content) {
            onDelta(delta.reasoning_content, 'reasoning');
          }
          if (delta.content) {
            splitter.push(delta.content);
          }
          if (delta.tool_calls) {
            tools.push(delta.tool_calls);
          }
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (!timedOut && !aborted) {
          resolve(done());
        }
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      if (!timedOut && !aborted) {
        reject(e);
      }
    });
    // Cooperative cancellation: stop the request and return whatever streamed so far.
    if (opts.signal) {
      const onAbort = (): void => {
        aborted = true;
        clearTimeout(timer);
        try {
          req.destroy();
        } catch {
          /* already gone */
        }
        resolve(done());
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    req.write(body);
    req.end();
  });
}
