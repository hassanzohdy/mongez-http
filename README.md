# Mongez Http

An [Axios Based Package](https://www.npmjs.com/package/axios) and Promise based HTTP client for the browser and node.js.

## Why not using axios directly instead?

Axios is an awesome library, and provides you with great features, however, there are some missing features that is needed in most of our real world projects:

> For demonstration purpose only, we may use React syntax for illustration when dealing with forms.

## Table of contents

- [Mongez Http](#mongez-http)
  - [Why not using axios directly instead?](#why-not-using-axios-directly-instead)
  - [Table of contents](#table-of-contents)
  - [Installation](#installation)
  - [Initializing Configurations](#initializing-configurations)
  - [Basic Usage](#basic-usage)
  - [Restful Endpoint](#restful-endpoint)
    - [List records](#list-records)
    - [Get single record](#get-single-record)
    - [Create new record](#create-new-record)
    - [Update Record](#update-record)
    - [Patching Record](#patching-record)
    - [Publishing records](#publishing-records)
    - [Deleting Record](#deleting-record)
    - [Using Axios Config in Restful Classes](#using-axios-config-in-restful-classes)
  - [Aborting Requests](#aborting-requests)
  - [Acceptable Http Data](#acceptable-http-data)
    - [Object Data Format](#object-data-format)
    - [HTML Form Element Format](#html-form-element-format)
    - [Form Data Format](#form-data-format)
  - [Form and FormData to Json Converter](#form-and-formdata-to-json-converter)
  - [Setting Authorization Header](#setting-authorization-header)
  - [Converting Put requests to Post requests](#converting-put-requests-to-post-requests)
  - [Http Configurations List](#http-configurations-list)
  - [HTTP Events](#http-events)
  - [TODO](#todo)

## Installation

`yarn add @mongez/http`

Or

`npm i @mognez/http`

## Initializing Configurations

Let's start with our first step, defining http configuration.

```js
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
});
```

From this step we can now use our relative paths to our base url we set in our configurations.

We'll go later with the rest of our configurations, now let's start using it.

## Basic Usage

```ts
// src/services/auth.ts
import endpoint from '@mongez/http';

export function login(data: object) {
    return endpoint.post('/login', data);
}

// in some component base file

// some-component.ts

const onSubmit = e => {
    const data = {
        email: 'hassanzohdy@gmail.com',
        password: '123456789',
    };

    login(data).then(response => {
        // response is done
    }).catch(error => {
        // some error in the response
    });
};
```

## Restful Endpoint

In some situations, such as Admin Dashboard, there would be pages that implements [CRUD Operations](https://en.wikipedia.org/wiki/Create,_read,_update_and_delete), thankfully, this can be done easily with `RestfulEndpoint` class, which you provide the route of the CRUD requests, and it handles all [Restful API](https://restfulapi.net/).

```ts
// src/services/users-service.ts
import { RestfulEndpoint } from '@mongez/http';

class UsersService extends RestfulEndpoint {
    /**
     * {@inheritDoc}
     */ 
    public route: string = '/users';
}

const usersService: UsersService = new UsersService();

export default usersService;
```

From this point we can now use our `usersService` object to `list` `get` `create` `update` `delete` `patch` or `publish`

### List records

To get a list of records, we can use `list` method which is defined by default in `RestfulEndpoint` class.

```ts
// src/index.ts
import usersService from './services/users-service';

// list users without any params sent
// request: GET /users
usersService.list().then(response => {
    //
});
```

We may also send params as a query string to the request as well

```ts
// src/index.ts
import usersService from './services/users-service';

// request: GET /users?paginate=true&itemsPerPage=15
const params: object = {
    paginate: true,
    itemsPerPage: 15,
};

usersService.list(paramsList).then(response => {
    //
});
```

### Get single record

To get a single record, use `get` method.

```ts
// src/index.ts
import usersService from './services/users-service';

// get user information
const userId: number = 1;
// request: GET /users/1
usersService.get(userId).then(response => {
    //
});

// get user with additional params sent with the request
// request: GET /users/1?active=true
usersService.get(userId, {
    active: true
}).then(response => {
    //
});
```

We may also send additional params with the single record as a query string.

```ts
// src/index.ts
import usersService from './services/users-service';

// get user information
const userId: number = 1;

const params: object = {
    active: true
};

// get user with additional params sent with the request
// request: GET /users/1?active=true
usersService.get(userId, params).then(response => {
    //
});
```

### Create new record

Creating a new record can be done from the endpoint service using `create` method.

> Check acceptable types of data at [Acceptable Http Data Section](#acceptable-http-data).

```ts
// src/index.ts
import usersService from './services/users-service';

const data: object = {
    email: 'hassanzohdy@gmail.com',
    password: '123456789',
    confirmPassword: '123456789',
};

// POST /users
usersService.create(data).then(response => {
    // user request is created successfully.
});
```

### Update Record

Updating an existing record is also can be done using `update` method.

> Check acceptable types of data at [Acceptable Http Data Section](#acceptable-http-data).

```ts
// src/index.ts
import usersService from './services/users-service';

const data: object = {
    email: 'hassanzohdy@gmail.com',
    password: '123456789',
    confirmPassword: '123456789',
};

const id: number = 1;

// PUT /users/1
usersService.update(id, data).then(response => {
    // user resource is updated successfully.
});
```

### Patching Record

Creating a small updates on records can be done use `patch` method.

```ts
// src/index.ts
import usersService from './services/users-service';

const data: object = {
    published: true
};

const id: number = 1;

// PATCH /users/1
usersService.patch(id, data).then(response => {
    // user resource is patched successfully.
});
```

### Publishing records

A smaller method that allow you to publish/un-publish records using `publish` method.

```ts
// src/index.ts
import usersService from './services/users-service';

const isPublished: boolean = true;

const id: number = 1;

// PATCH /users/1
// request payload: { published: true }
usersService.publish(id, isPublished).then(response => {
    // user resource is patched successfully.
});
```

You may change the `published` key to another key by passing your desired key in the third argument.

```ts
// src/index.ts
import usersService from './services/users-service';

const isActivated: boolean = true;

const id: number = 1;

// PATCH /users/1
// request payload: { activated: true }
usersService.publish(id, isActivated, 'activated').then(response => {
    // user resource is patched successfully.
});
```

### Deleting Record

Our final method in the Restful API concept is to delete a resource/record.

```ts
// src/index.ts
import usersService from './services/users-service';

const id: number = 1;

// DELETE /users/1
usersService.delete(id).then(response => {
    // user resource is patched successfully.
});
```

### Using Axios Config in Restful Classes

All of the previous methods `list` `get` `create` `update` `delete` `patch` or `publish` their last argument accepts Axios Configurations that can be [Request Config](https://www.npmjs.com/package/axios#request-config).

## Aborting Requests

Another good feature of `@mongez/http` is that you can cancel or abort your last request easily using `lastRequest` function.

```ts
import endpoint, { lastRequest } from '@mognez/http';

endpoint.get('/user').then(response => {
    // it nevers go here
});

// from some other point
lastRequest().abort();
```

> If you're making multiple requests, cache the last request function in a variable as calling it always returns last fired request.

```ts
import endpoint, { lastRequest } from '@mognez/http';

endpoint.get('/user').then(response => {
    // it nevers go here
});

const usersRequest = lastRequest();

endpoint.get('/posts').then(response => {
    // it nevers go here
});


usersRequest.abort();

const postsRequest = lastRequest();

postsRequest.abort();
```

## Acceptable Http Data

For `POST` `PUT` requests, there are three acceptable formats of data:

1. `object`: which will send the request as json.
2. `HTMLFormElement` which accepts an instance of [HTMLFormElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement) and request data will be sent as form data.
3. `FormData` which accepts an instance of [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData) and request data will be sent as form data.
4. `string` which will be sent as a string.

Let's see an example for each format.

### Object Data Format

In the next example, we'll see how to use an example of sending post request using plain object.

> If data is sent as plain object, then a request header `"Content-Type": "Application/json"` will be added to headers by default.

```ts
import endpoint from '@mognez/http';

const data: object = {
    email: 'hassanzohdy@gmail.com',
    password: '123456789',
}

endpoint.post('/login', data).then(response => {
    //
});
```

### HTML Form Element Format

In the next example, we'll see how to use an example of sending post request using form element.

```tsx
// Form.tsx
import React from 'react'; 
import endpoint from '@mognez/http';

export default function MyForm() {
    const submitForm = e => {
        e.preventDefault();

        const formElement: HTMLFormElement = e.target;
        
        endpoint.post('/login', formElement).then(response => {
            //
        });
    }
    return (
        <form onSubmit={submitForm}>
            <input name="email" type="email" />
            <input name="password" type="password" />
        </form>
    )
}
```

### Form Data Format

In the next example, we'll see how to use an example of sending post request using form data.

```tsx
// Form.tsx
import React from 'react'; 
import endpoint from '@mognez/http';

export default function MyForm() {
    const submitForm = e => {
        e.preventDefault();

        const formElement: HTMLFormElement = e.target;

        const formData = new FormData(formElement);
        
        endpoint.post('/login', formData).then(response => {
            //
        });
    }
    return (
        <form onSubmit={submitForm}>
            <input name="email" type="email" />
            <input name="password" type="password" />
        </form>
    )
}
```

## Form and FormData to Json Converter

Sometimes your api accepts only json data, but you may work with form elements or form data as well for storing form information, you may set an option to auto convert any form element or form data to json automatically in every request, just set `formDataToJSON` option to true in http configurations list.

```js
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
    formDataToJSON: true,
});
```

You may also set your serializer method to convert the form data elements to objects.

```ts
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
    formDataToJSON: true,
    formDataToJSONSerializer: (formData: FormData): object => {
        // convert it into an object

        return {};
    },
});
```

## Setting Authorization Header

If your backend api requires `Authorization` header in every request, You may set Authorization header from configurations either as a string or as a callback,

```js
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',
    setAuthorizationHeader: 'key some-api-key'
});
```

You can set it as a callback so it gets a bearer token for example

```js
import user from './src/some-user';
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',
    setAuthorizationHeader: () => {
        if (user.isLoggedIn()) {
            return `Bearer ${user.accessToken()}`;
        }

        return `key some-api-key`;
    }
});
```

## Converting Put requests to Post requests

Why? because PUT requests won't allow sending files whereas post requests do it, so in some backend frameworks like [Laravel](https://laravel.com/) has a nice workaround that allows you to send a post request and it handles it as put request.

If your backend allows something like this, you may wish to set `putToPost` option to **true**.

```js
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
    putToPost: true,
});
```

This will convert any put request to post request with `_method` key added to the request payload with value `PUT`.

```js
import endpoint, { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
    putToPost: true,
});

// The request will be:
// POST /users/1
// Request Payload: {email: some-email@gmail.com, _method: PUT}
endpoint.put('/users/1', {
    email: 'some-email@gmail.com',
});
```

You may also override the `_method` key to other key if you would like in your http configurations.

```js
import { setHttpConfigurations } from '@mongez/http';

setHttpConfigurations({
    baseUrl: 'https://sitename.com/api',    
    putToPost: true,
    putMethodKey: '_other_put_key'
});

// The request will be:
// POST /users/1
// Request Payload: {email: some-email@gmail.com, _other_put_key: PUT}
endpoint.put('/users/1', {
    email: 'some-email@gmail.com',
});
```

## Http Configurations List

The following snippet defines all available configurations to the package.

```ts
type HttpConfigurations = {
  /**
   * Base Url Request
   */
  baseUrl?: string;

  /**
   * If set to true, all PUT requests will be transformed to POST requests with _method = PUT value will be appended.
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
   * Set other axios setup configurations
   */
  axiosConfig?: AxiosRequestConfig;

  /**
   * If set to true, any data that is sent as HTMLFormElement or FormData will be converted into object json format.
   *
   * @default false
   */
  formDataToJSON?: boolean;

  /**
   * A serializer function that accepts FormData element
   * and returns an object to be transformed into JSON
   */
  formDataToJSONSerializer?: (formData: FormData) => object;

  /**
   * Set authorization header
   *
   * Useful when using Key and Bearer Tokens
   */
  setAuthorizationHeader?: string | (() => string);
};
```

## HTTP Events

`Mongez Http` is shipped with event driven approach so you may manipulate requests before sending it or after response is sent either on success, fail or on both.

Before sending any request:

```ts
import { AxiosRequestConfig } from "axios";
import { endpointEvents } from '@mongez/http';
import { EventSubscription } from "@mongez/events";

// This is triggered before sending any request
endpointEvents.beforeSending((requestConfig:AxiosRequestConfig): EventSubscription => {
    // do something
});
```

On success request:

```ts
import { AxiosResponse } from "axios";
import { endpointEvents } from '@mongez/http';
import { EventSubscription } from "@mongez/events";

// This is triggered on success request
endpointEvents.onSuccess((response: AxiosResponse): EventSubscription => {
    // do something
});
```

On Failure request:

```ts
import { AxiosResponse } from "axios";
import { endpointEvents } from '@mongez/http';
import { EventSubscription } from "@mongez/events";

// This is triggered on failure request
endpointEvents.onError((response: AxiosResponse): EventSubscription => {
    // do something
});
```

On request response either success or failure:

```ts
import { AxiosResponse } from "axios";
import { endpointEvents } from '@mongez/http';
import { EventSubscription } from "@mongez/events";

// This is triggered on response return either on success or on failure
endpointEvents.onResponse((response: AxiosResponse): EventSubscription => {
    // do something
});
```

## TODO

- Add Unit Tests
- Handle Nodejs Http Requests.
