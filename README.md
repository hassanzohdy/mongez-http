# Mongez Http

An [Axios Based Package](https://www.npmjs.com/package/axios) and Promise based HTTP client for the browser and node.js.

## Why not using axios directly instead?

Axios is an awesome library, and provides you with great features, however, there are some missing features that is needed in most of our real world projects.

## Features

1. Everything that axios provides.
2. Easily convert `PUT` requests to `POST` requests with `_method=PUT` appended to the request body.
3. Easily set `Authorization` header for all requests.
4. Easily create Restful API endpoints with a single class.
5. Properly guides you to create your endpoints functions.
6. Empowers Cache Management.
7. Easily abort requests.
8. Easily listen to endpoint events, before sending, on success, on error, and on complete.

## Installation

`yarn add @mongez/http`

Or

`npm i @mongez/http`

## Usage

Let's create a new Endpoint instance to handle our requests:

> For demonstration purpose only, we may use React syntax for illustration when dealing with forms.

```ts
// src/endpoints.ts
import Endpoint from "@mongez/http";

export const endpoint = new Endpoint({
  baseURL: "https://jsonplaceholder.typicode.com",
});

endpoint
  .post("/login", {
    email: "hassanzohdy@gmail.com",
    password: "0000000",
  })
  .then((response) => {
    //
  });
```

Now we can use this endpoint to make requests from any service files or even components.

## Configurations

The `Endpoint` class provides you with a set of methods to handle your requests, also it accepts [Axios Configurations](https://github.com/axios/axios#request-config) besides the configurations below:

```ts
import { AxiosRequestConfig } from "axios";

export type EndpointConfigurations = AxiosRequestConfig & {
  /**
   * If set to true, all PUT requests will be transformed to POST requests with ${putMethodKey} = PUT value will be appended.
   *
   * @default false
   */
  putToPost?: boolean;

  /**
   * Defines the put key that will be added to post requests.
   * Works only if `putToPost` is set to true and you send a `put` request
   * The send value is `PUT`
   *
   * @default _method
   */
  putMethodKey?: string;

  /**
   * Set authorization header
   *
   * Useful when using Key and Bearer Tokens
   */
  setAuthorizationHeader?: string | (() => string);
};
```

In the above configurations, there are some interesting configurations that you may need to use such as `putToPost` and `setAuthorizationHeader`.

## Converting Put requests to Post requests

Why? because PUT requests won't allow sending files whereas post requests do it, so in some backend frameworks like [Laravel](https://laravel.com/) has a nice workaround that allows you to send a post request and it handles it as put request.

If you're using Laravel or any app that does not allow uploading files using `PUT` request method, so you need to send a POST request with `_method=PUT` appended to the request body, and this is what `putToPost` does.

You can also change the key of the appended data by changing the `putMethodKey` value, which defaults to `_method`.

## Setting Authorization Header

If your backend api requires `Authorization` header in every request, You may set Authorization header from configurations either as a string or as a callback,

```ts
import Endpoint from "@mongez/http";

export const endpoint = new Endpoint({
  baseURL: "https://api.sitename.com/v1",
  setAuthorizationHeader: () => {
    if (user.isLoggedIn()) {
      return `Bearer ${user.getAccessToken()}`;
    }

    return "key some-api-key";
  },
});
```

Or you may set it directly as string, for example if the api only accept `key` authorization header:

```ts
import Endpoint from "@mongez/http";

export const endpoint = new Endpoint({
  baseURL: "https://api.sitename.com/v1",
  setAuthorizationHeader: "key some-api-key",
});
```

The `setAuthorizationHeader` configuration will be called before each request so it should have the proper value to be sent as it won't cache the initial value unless it is string.

## Restful Endpoint

In some situations, such as Admin Dashboard, there would be pages that implements [CRUD Operations](https://en.wikipedia.org/wiki/Create,_read,_update_and_delete), thankfully, this can be done easily with `RestfulEndpoint` class, which you provide the route of the CRUD requests, and it handles all [Restful API](https://restfulapi.net/).

```ts
// src/services/users-service.ts
import { endpoint } from "./endpoints";
import { RestfulEndpoint } from "@mongez/http";

class UsersService extends RestfulEndpoint {
  /**
   * {@inheritDoc}
   */
  public route: string = "/users";
  /**
   * Endpoint handler
   */
  public endpoint = endpoint;
}

const usersService: UsersService = new UsersService();

export default usersService;
```

From this point we can now use our `usersService` object to `list` `get` `create` `update` `delete` `patch` or `publish`

### Current Endpoint

If you're application uses only one endpoint, you can set the current endpoint instance, this will allow all `RestfulEndpoint` instances to use the same endpoint instance unless you explicitly sets the `endpoint` property.

```ts
// endpoints.ts
import Endpoint, { setCurrentEndpoint } from "@mongez/http";

export const endpoint = new Endpoint({
  baseURL: "https://jsonplaceholder.typicode.com",
});

setCurrentEndpoint(endpoint);
```

Now we can use the `RestfulEndpoint` class without setting the `endpoint` property.

```ts
// src/services/users-service.ts
import { RestfulEndpoint } from "@mongez/http";

class UsersService extends RestfulEndpoint {
  /**
   * {@inheritDoc}
   */
  public route: string = "/users";
}

const usersService: UsersService = new UsersService();

export default usersService;
```

Of course you can get the current endpoint instance using `getCurrentEndpoint` method.

```ts
import { getCurrentEndpoint } from "@mongez/http";

const endpoint = getCurrentEndpoint();
// endpoint is the same instance that we set in the above example
```

### List records

To get a list of records, we can use `list` method which is defined by default in `RestfulEndpoint` class.

```ts
// src/index.ts
import usersService from "./services/users-service";

// list users without any params sent
// request: GET /users
usersService.list().then((response) => {
  //
});
```

We may also send params as a query string to the request as well

```ts
// src/index.ts
import usersService from "./services/users-service";

// request: GET /users?paginate=true&itemsPerPage=15
const params: object = {
  paginate: true,
  itemsPerPage: 15,
};

usersService.list(paramsList).then((response) => {
  //
});
```

### Get single record

To get a single record, use `get` method.

```ts
// src/index.ts
import usersService from "./services/users-service";

// get user information
const userId: number = 1;
// request: GET /users/1
usersService.get(userId).then((response) => {
  //
});

// get user with additional params sent with the request
// request: GET /users/1?active=true
usersService
  .get(userId, {
    active: true,
  })
  .then((response) => {
    //
  });
```

We may also send additional params with the single record as a query string.

```ts
// src/index.ts
import usersService from "./services/users-service";

// get user information
const userId: number = 1;

const params: object = {
  active: true,
};

// get user with additional params sent with the request
// request: GET /users/1?active=true
usersService.get(userId, params).then((response) => {
  //
});
```

### Create new record

Creating a new record can be done from the endpoint service using `create` method.

> Check acceptable types of data at [Acceptable Http Data Section](#acceptable-http-data).

```ts
// src/index.ts
import usersService from "./services/users-service";

const data: object = {
  email: "hassanzohdy@gmail.com",
  password: "123456789",
  confirmPassword: "123456789",
};

// POST /users
usersService.create(data).then((response) => {
  // user request is created successfully.
});
```

### Update Record

Updating an existing record is also can be done using `update` method.

> Check acceptable types of data at [Acceptable Http Data Section](#acceptable-http-data).

```ts
// src/index.ts
import usersService from "./services/users-service";

const data: object = {
  email: "hassanzohdy@gmail.com",
  password: "123456789",
  confirmPassword: "123456789",
};

const id: number = 1;

// PUT /users/1
usersService.update(id, data).then((response) => {
  // user resource is updated successfully.
});
```

### Patching Record

Creating a small updates on records can be done use `patch` method.

```ts
// src/index.ts
import usersService from "./services/users-service";

const data: object = {
  published: true,
};

const id: number = 1;

// PATCH /users/1
usersService.patch(id, data).then((response) => {
  // user resource is patched successfully.
});
```

### Publishing records

A smaller method that allow you to publish/un-publish records using `publish` method.

```ts
// src/index.ts
import usersService from "./services/users-service";

const isPublished: boolean = true;

const id: number = 1;

// PATCH /users/1
// request payload: { published: true }
usersService.publish(id, isPublished).then((response) => {
  // user resource is patched successfully.
});
```

You may change the `published` key to another key by passing your desired key in the third argument.

```ts
// src/index.ts
import usersService from "./services/users-service";

const isActivated: boolean = true;

const id: number = 1;

// PATCH /users/1
// request payload: { activated: true }
usersService.publish(id, isActivated, "activated").then((response) => {
  // user resource is patched successfully.
});
```

Or you can set it globally when creating the endpoint instance.

```ts
// src/endpoints.ts
import Endpoint from "@mongez/http";

export const endpoint = new Endpoint({
  baseURL: "https://jsonplaceholder.typicode.com",
  publishKey: "isActive",
});
```

### Deleting Record

Our final method in the Restful API concept is to delete a resource/record.

```ts
// src/index.ts
import usersService from "./services/users-service";

const id: number = 1;

// DELETE /users/1
usersService.delete(id).then((response) => {
  // deleted successfully.
});
```

### Bulk Delete

This feature allows you to perform a bulk delete on a list of records, it will call the resource path with `DELETE` method and send the ids as an array of ids.

```ts
// src/index.ts
import usersService from "./services/users-service";

const ids: number[] = [1, 2, 3];

// DELETE /users
usersService
  .bulkDelete({
    id: ids,
  })
  .then((response) => {
    // deleted successfully.
  });
```

### Creating Custom methods

In some cases we may need to create custom methods that can be used later in our project.

```ts
// src/services/users-service.ts
import { RestfulEndpoint } from "@mongez/http";

class UsersService extends RestfulEndpoint {
  /**
   * {@inheritDoc}
   */
  public route: string = "/users";

  /**
   * Get active members only
   */
  public listActive() {
    return this.endpoint.get(this.path("/active"));
  }
}

const usersService: UsersService = new UsersService();

export default usersService;
```

In the previous example, we created a new method `listActive` which calls endpoint instance `this.endpoint` and pass to it a `path` method, this method concatenate the given argument with the basic route to generate another route, in the previous example the final route will be `/users/active`.

## Acceptable Http Data

For `POST` `PUT` requests, there are four acceptable formats of data:

1. `object`: which will send the request as json.
2. `HTMLFormElement` which accepts an instance of [HTMLFormElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement) and request data will be sent as form data.
3. `FormData` which accepts an instance of [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData) and request data will be sent as form data.
4. `string` which will be sent as a string.

Let's see an example for each format.

### Object Data Format

In the next example, we'll see how to use an example of sending post request using plain object.

> If data is sent as plain object, then a request header `"Content-Type": "Application/json"` will be added to headers by default.

```ts
import endpoint from "./endpoints";

const data: object = {
  email: "hassanzohdy@gmail.com",
  password: "123456789",
};

endpoint.post("/login", data).then((response) => {
  //
});
```

### HTML Form Element Format

In the next example, we'll see how to use an example of sending post request using form element.

```tsx
// Form.tsx
import React from "react";
import endpoint from "./endpoints";

export default function MyForm() {
  const submitForm = (e) => {
    e.preventDefault();

    const formElement: HTMLFormElement = e.target;

    endpoint.post("/login", formElement).then((response) => {
      //
    });
  };
  return (
    <form onSubmit={submitForm}>
      <input name="email" type="email" />
      <input name="password" type="password" />
    </form>
  );
}
```

### Form Data Format

In the next example, we'll see how to use an example of sending post request using form data.

```tsx
// Form.tsx
import React from "react";
import endpoint from "./endpoints";

export default function MyForm() {
  const submitForm = (e) => {
    e.preventDefault();

    const formElement: HTMLFormElement = e.target;

    const formData = new FormData(formElement);

    endpoint.post("/login", formData).then((response) => {
      //
    });
  };
  return (
    <form onSubmit={submitForm}>
      <input name="email" type="email" />
      <input name="password" type="password" />
    </form>
  );
}
```

## Endpoint Events

You can listen to events on the endpoint instance, the events are:

- `beforeSending`: will be fired before sending the request.
- `onSuccess`: will be fired when the request is successful.
- `onError`: will be fired when the request is failed.
- `onComplete`: will be fired when the request is finished wether success or failed requests.

```ts
import endpoint from "./endpoints";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { EventSubscription } from "@mongez/events";

// This is triggered before sending any request
endpoint.events.beforeSending(
  (requestConfig: AxiosRequestConfig): EventSubscription => {
    // do something
  }
);

// This is triggered when the request is successful

endpoint.events.onSuccess((response: AxiosResponse): EventSubscription => {
  // do something
});

// This is triggered when the request is failed

endpoint.events.onError((response: AxiosResponse): EventSubscription => {
  // do something
});

// This is triggered when the request is finished wether success or failed requests
endpoint.events.onComplete((response: AxiosResponse): EventSubscription => {
  // do something
});
```

The `onComplete` event will be triggered before `onSuccess` and `onError` events.

## Aborting Requests

You can abort a request by getting the last request instance using `getLastRequest` method which is an instance of [AbortController](https://github.com/axios/axios#abortcontroller).

```ts
import endpoint from "./endpoints";

endpoint.get("/users").then((response) => {
  // do something
});

const lastRequest = endpoint.getLastRequest();

lastRequest.abort();
```

Of course you can use the original Axios `signal` property to abort the request.

```ts
import endpoint from "./endpoints";

const abortController = new AbortController();

endpoint
  .get("/users", {
    signal: abortController.signal,
  })
  .then((response) => {
    // do something
  });

// Anywhere in your code
abortController.abort();
```

## Caching

> Added in 2.1.0

You can now easily cache your `get` requests, to do so, you need to pass the `cache` option to the request method.

```ts
import endpoint from "./endpoints";

endpoint
  .get("/users", {
    cache: true,
  })
  .then((response) => {
    // do something
  });
```

By default request will be cached for 5 minutes, you can change this by passing the `cacheTime` option.

```ts
import endpoint from "./endpoints";

endpoint
  .get("/users", {
    cache: true,
    cacheOptions: {
      expiresAfter: 10 * 60, // 10 minutes
    },
  })
  .then((response) => {
    // do something
  });
```

Here we defined the cache time to be 10 minutes.

However, we need to define the cache driver that will contain the cached data, to do so, you need to define the `driver` property in cache options as well.

You can easily use any [cache driver here](https://github.com/hassanzohdy/mongez-cache) or the cache manger directly.

```ts
import endpoint from "./endpoints";
import cache from "@mongez/cache";

endpoint
  .get("/users", {
    cache: true,
    cacheOptions: {
      driver: cache,
      expiresAfter: 10 * 60, // 10 minutes
    },
  })
  .then((response) => {
    // do something
  });
```

Using Run Time Driver will cache the data until the user refreshes the page regardless of the cache time, so you you may use it directly if you want to save it in the run time.

```ts
import endpoint from "./endpoints";
import { RunTimeDriver } from "@mongez/cache";

endpoint
  .get("/users", {
    cache: true,
    cacheOptions: {
      driver: new RunTimeDriver(),
      expiresAfter: 10 * 60, // 10 minutes
    },
  })
  .then((response) => {
    // do something
  });
```

You can also set the default cache options for all requests by passing the `cacheOptions` property to the endpoint instance and `cache` flag.

```ts

// src/endpoints.ts
import Endpoint from '@mongez/http';
import cache from '@mongez/cache';

export const endpoint = new Endpoint({
    baseURL: 'https://jsonplaceholder.typicode.com',
    cache: true, // enable cache for all get requests
    cacheOptions: {
        expiresAfter: 10 * 60 // 10 minutes
        driver: cache,
    }
});
```

The cache driver **MUST** implement the [CacheDriverInterface](https://github.com/hassanzohdy/mongez-cache#cache-driver-interface).

## Legacy Version 1 Documentation

If you're still using Version 1, you can see its documentation in [Version 1 Documentation Section](./VERSION-1.md).

## Change Log

- 2.2.4 (16 Apr 2023)
  - Updated Dependencies.
  - Now `setAuthorizationHeader` if didn't return a value the `Authorization` header will not be added.
- 2.2.0 (28 Feb 2023)
  - Updated dependencies.
  - Fixed cache options
- 2.1.0 (07 Nov 2022)
  - Added caching support.
- 2.0.0 (19 Sept 2022)
  - Released Version 2.
- 1.0.22 (1 Feb 2022)
  - Fixed Incorrect base url concatenation with request config url.
- 1.0.21 (31 Jan 2022)
  - Fixed lastRequest incorrect Cancel Token Clone.
  - Added `LastRequest` as return type to `lastRequest()` function.
