---
name: mongez-http-recipes
description: |
  @mongez/http real-world recipes — React `useEffect` cancel on unmount, React Query `queryFn` with abort `signal`, global 401 redirect via `after()`, Laravel `putToPost` file upload, multi-tenant `Http` instances, 422 validation-error body extraction, paginated `Resource` subclass.
  TRIGGER when: code imports both `@mongez/http` and React or `@tanstack/react-query`; user asks "mongez http with React" or "cancel request on unmount" or "React Query with http" or "global 401 handler" or "file upload with PUT" or "pagination resource" or "validation errors 422".
  SKIP: API reference for individual types — use `mongez-http-client`, `mongez-http-error-handling`, `mongez-http-resource`, or `mongez-http-interceptors` instead.
---

# Recipes

## React — cancel on unmount

```ts
import { useEffect, useState } from 'react';
import { http } from '../http';
import type { User } from '../types';

function useUser(id: number) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const req = http.get<User>(`/users/${id}`);

    req.then(({ data, error }) => {
      if (error?.isAborted) return;
      if (data) setUser(data);
    });

    return () => req.cancel('unmounted');
  }, [id]);

  return user;
}
```

## React Query integration

```ts
import { useQuery } from '@tanstack/react-query';
import { http } from '../http';

const useUsers = (params) =>
  useQuery({
    queryKey: ['users', params],
    queryFn: ({ signal }) => http.get('/users', { params, signal }).then(({ data, error }) => {
      if (error) throw error;
      return data;
    }),
  });
```

## Global 401 redirect

```ts
http.after((result) => {
  if (result.error?.isUnauthorized) {
    window.location.href = '/login';
  }
});
```

## Laravel-style file upload (putToPost)

```ts
const http = new Http({ baseURL, putToPost: true });

const fd = new FormData();
fd.append('avatar', file);
fd.append('name', 'Alice');

// Sent as POST /users/1 with _method=PUT in body
await http.put('/users/1', fd);
```

## Multi-tenant: different Http per resource

```ts
const publicHttp  = new Http({ baseURL: 'https://api.example.com/public' });
const privateHttp = new Http({ baseURL: 'https://api.example.com/v2', auth: getToken });

export const articlesResource = new ArticlesResource().useHttp(publicHttp);
export const ordersResource   = new OrdersResource().useHttp(privateHttp);
```

## Validation errors (422)

```ts
const { data, error } = await usersResource.create(formData);

if (error?.isValidationError) {
  const errors = (error.body as { errors: Record<string, string[]> }).errors;
  // { name: ['The name field is required.'], ... }
}
```

## Pagination helper

```ts
class PaginatedResource<T> extends Resource {
  async page(n: number, perPage = 20) {
    const { data, error } = await this.list<{ data: T[]; total: number }>({
      page: n,
      per_page: perPage,
    });
    return { data, error };
  }
}
```
