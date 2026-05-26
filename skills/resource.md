# Resource class

Zero-boilerplate RESTful CRUD helper. Extend and set `route`.

```ts
class Resource {
  route: string = ''
  defaultListParams: HttpParams = {}

  // All methods return CancellablePromise<HttpResult<T>>
  list<T>(params?: HttpParams, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  get<T>(id: number | string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  create<T>(data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  update<T>(id: number | string, data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  patch<T>(id: number | string, data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  delete<T>(id: number | string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  bulkDelete<T>(data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  publish<T>(id, published, publishKey?, options?): CancellablePromise<HttpResult<T>>

  path(suffix?: string | number): string   // concatRoute(route, suffix)
  useHttp(instance: Http): this            // override Http instance for this resource
}
```

## Usage

```ts
import { Resource } from '@mongez/http';
import type { User } from './types';

class UsersResource extends Resource {
  route = '/users';
}

export const usersResource = new UsersResource();

// List
const { data: users, error } = await usersResource.list<User[]>({ page: 1, limit: 20 });

// Get one
const { data: user } = await usersResource.get<User>(42);

// Create
const { data: newUser } = await usersResource.create<User>({ name: 'Alice', email: 'a@b.com' });

// Update (PUT)
const { data: updated } = await usersResource.update<User>(42, { name: 'Alice Updated' });

// Partial update (PATCH)
await usersResource.patch(42, { data: { avatar: 'url' } });

// Delete
await usersResource.delete(42);

// Bulk delete
await usersResource.bulkDelete({ ids: [1, 2, 3] });

// Publish / Unpublish
await usersResource.publish(42, true);
await usersResource.publish(42, false, 'active'); // custom key
```

## Http resolution

`Resource.http` is a **lazy getter** — it calls `getCurrentHttp()` on first access.
Call `setCurrentHttp(http)` at app bootstrap; all Resources resolve it at request time.

To use a different Http instance for a single resource:

```ts
const adminHttp = new Http({ baseURL: 'https://admin.api.com', auth: adminToken });
export const adminUsers = new UsersResource().useHttp(adminHttp);
```

## Nested resources

```ts
class PostCommentsResource extends Resource {
  constructor(postId: number) {
    super();
    this.route = `/posts/${postId}/comments`;
  }
}

const comments = new PostCommentsResource(5);
await comments.list();   // GET /posts/5/comments
```
