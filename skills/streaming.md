# Streaming, progress & responseType

## stream()

```ts
http.stream<T>(path: string, options?: StreamRequestOptions): CancellableAsyncIterable<T>
```

Opens a streaming connection and yields parsed chunks. Cancellable at any time via
`.cancel()`. The stream **never throws** — errors are caught, the iteration ends,
and the `HttpError` is stored on `stream.error`. Auto-reconnect is **opt-in**
(`reconnect: true`); by default the stream ends after the first disconnect.

### StreamRequestOptions

```ts
interface StreamRequestOptions {
  method?: HttpMethod          // default "GET" — use "POST" for chat-style APIs
  data?: HttpData              // body for POST streams
  format?: StreamFormat        // "sse" (default) | "ndjson"
  parseLine?: (line: string) => unknown   // custom parser; return undefined to skip line
  params?: HttpParams
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number

  // SSE auto-reconnect (does NOT reconnect on non-2xx HTTP errors)
  reconnect?: boolean              // default false — set true to enable auto-reconnect
  maxReconnectAttempts?: number    // default Infinity
  reconnectDelay?: number          // default 3000 ms; server `retry:` directive overrides
}
```

### SSE (Server-Sent Events) — default

Strips `data: ` prefix, skips `[DONE]` and empty lines, parses each payload as JSON.

```ts
// OpenAI-style chat completion
for await (const chunk of http.stream<ChatChunk>('/chat', {
  method: 'POST',
  data: { model: 'gpt-4o', messages },
})) {
  process(chunk.choices[0].delta.content);
}
```

### NDJSON (newline-delimited JSON)

Parses each non-empty line as JSON.

```ts
for await (const event of http.stream('/containers/logs', { format: 'ndjson' })) {
  console.log(event);
}
```

### Custom parser

```ts
for await (const item of http.stream('/feed', {
  parseLine: (line) => {
    if (!line.startsWith('ITEM:')) return undefined;
    return line.slice(5);
  },
})) { ... }
```

### Cancellation & errors

```ts
const stream = http.stream('/chat', { method: 'POST', data: body });

// Cancel from outside the loop (e.g. component unmount, user stops generation)
stream.cancel('user stopped');

for await (const chunk of stream) {
  // iteration ends silently when cancelled
}

// Stream never throws — check `.error` after the loop instead.
if (stream.error) {
  if (stream.error.isUnauthorized) redirect('/login');
  else                              showError(stream.error.message);
}
```

### React cleanup example

```ts
useEffect(() => {
  const stream = http.stream<Delta>('/chat', { method: 'POST', data: body });

  (async () => {
    for await (const chunk of stream) {
      setContent((prev) => prev + chunk.text);
    }
  })();

  return () => stream.cancel('unmounted');
}, []);
```

---

## responseType

Controls how the response body is decoded. Add to any `get()` / `post()` / etc. call.

```ts
type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer'
```

```ts
// Default: auto-detect from Content-Type
const { data } = await http.get('/users');           // → parsed JSON or text

// Explicit types
const { data } = await http.get('/doc', { responseType: 'text' });
const { data } = await http.get('/image.png', { responseType: 'blob' });
const { data } = await http.get('/binary', { responseType: 'arrayBuffer' });
const { data } = await http.get('/api', { responseType: 'json' });

// File download example
const { data: blob } = await http.get('/exports/report.xlsx', { responseType: 'blob' });
const url = URL.createObjectURL(blob as Blob);
const a = document.createElement('a');
a.href = url; a.download = 'report.xlsx'; a.click();
URL.revokeObjectURL(url);
```

---

## onDownloadProgress

Fires a callback each time a chunk arrives. Enables real progress bars.

```ts
interface DownloadProgressEvent {
  loaded: number        // bytes received so far
  total: number | null  // null when server omits Content-Length
  percent: number | null
}
```

```ts
const { data } = await http.get('/large-file.zip', {
  responseType: 'blob',
  onDownloadProgress: ({ loaded, total, percent }) => {
    if (percent !== null) {
      setProgress(percent);
    } else {
      setStatus(`${loaded} bytes`);
    }
  },
});
```

### Upload progress

Native `fetch` does **not** support upload progress events. If you need per-chunk upload feedback, use `XMLHttpRequest` directly. A future `http.upload()` helper may wrap this.
