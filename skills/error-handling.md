# Error handling

## HttpError

```ts
class HttpError extends Error {
  status: number | null        // null for network/abort/timeout
  body: unknown                // parsed response body
  response: Response | null
  isAborted: boolean
  isTimeout: boolean
  isNetwork: boolean

  isClientError(): boolean     // 4xx
  isServerError(): boolean     // 5xx
  isUnauthorized(): boolean    // 401
  isForbidden(): boolean       // 403
  isNotFound(): boolean        // 404
  isValidationError(): boolean // 422
  isRateLimited(): boolean     // 429
  toJSON(): Record<string, unknown>
}
```

## Default pattern — destructure result

```ts
const { data, error } = await http.get<User>('/users/1');

if (error) {
  if (error.isNotFound())       console.warn('User not found');
  else if (error.isUnauthorized()) redirect('/login');
  else if (error.isValidationError()) showFormErrors(error.body);
  else if (error.isAborted)     { /* request was cancelled — ignore */ }
  else                          showGenericError(error.message);
  return;
}

// data is User here — TypeScript knows error is null
console.log(data.name);
```

## Opt-in throw mode

```ts
try {
  const { data } = await http.get('/users/1', { throw: true });
} catch (err) {
  if (err instanceof HttpError && err.isNotFound()) {
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
  result.data   // User — TypeScript knows
  result.error  // null
}
```
