---
name: mongez-http-error-handling
description: |
  @mongez/http `HttpError` and `HttpResult<T>` — status predicates (`isNotFound`, `isUnauthorized`, `isForbidden`, `isValidationError`, `isRateLimited`, `isClientError`, `isServerError`), runtime flags (`isAborted`, `isTimeout`, `isNetwork`), `toJSON`. `{data, error}` discriminated union; opt-in `throw: true` mode; TypeScript type narrowing.
---

# Error handling

## HttpError

```ts
class HttpError extends Error {
  status: number | null        // null for network/abort/timeout
  body: unknown                // parsed response body
  response: Response | null
  headers: Record<string, string> | null  // null when no response was received
  request: OutgoingRequest | null         // the outgoing request that produced this error
  isAborted: boolean
  isTimeout: boolean
  isNetwork: boolean

  // Status predicates — getters, no () needed
  get isClientError(): boolean     // 4xx
  get isServerError(): boolean     // 5xx
  get isUnauthorized(): boolean    // 401
  get isForbidden(): boolean       // 403
  get isNotFound(): boolean        // 404
  get isValidationError(): boolean // 422
  get isRateLimited(): boolean     // 429

  // Omits `request` (may contain Authorization / Cookie headers).
  toJSON(): Record<string, unknown>
}
```

## HttpResult<T>

```ts
type HttpResult<T> =
  | { data: T;    error: null;      status: number;       response: Response;        headers: Record<string, string>;       request: OutgoingRequest }
  | { data: null; error: HttpError; status: number | null; response: Response | null; headers: Record<string, string> | null; request: OutgoingRequest }
```

## Default pattern — destructure result

```ts
const { data, error } = await http.get<User>('/users/1');

if (error) {
  if (error.isNotFound)             console.warn('User not found');
  else if (error.isUnauthorized)    redirect('/login');
  else if (error.isValidationError) showFormErrors(error.body);
  else if (error.isAborted)         { /* request was cancelled — ignore */ }
  else                              showGenericError(error.message);
  return;
}

// data is User here — TypeScript knows error is null
console.log(data.name);
```

## Validation errors (422) — Laravel-style

```ts
const { data, error } = await usersResource.create(formData);

if (error?.isValidationError) {
  // error.body is whatever the server returned, e.g.:
  // { errors: { name: ['The name field is required.'], ... } }
  const { errors } = error.body as { errors: Record<string, string[]> };
  for (const [field, messages] of Object.entries(errors)) {
    setFieldError(field, messages[0]);
  }
}
```

## Opt-in throw mode

```ts
try {
  const { data } = await http.get('/users/1', { throw: true });
} catch (err) {
  if (err instanceof HttpError && err.isNotFound) {
    // handle 404
  }
}
```

## Type narrowing

The `HttpResult<T>` discriminated union narrows automatically:

```ts
const result = await http.get<User>('/me');

if (result.error) {
  result.data   // null — TypeScript knows
  result.error  // HttpError
} else {
  result.data    // User — TypeScript knows
  result.error   // null
  result.headers // Record<string, string>
}
```
