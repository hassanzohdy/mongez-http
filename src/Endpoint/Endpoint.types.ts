import { CacheDriverInterface } from "@mongez/cache";
import { AxiosRequestConfig } from "axios";
export type EndpointEvent = "sending" | "success" | "error" | "complete";

export type EndpointConfigurations = AxiosRequestConfig & {
  /**
   * If set to true, all PUT requests will be transformed to POST requests with ${putMethodKey} = PUT value will be appended.
   *
   * @default false
   */
  putToPost?: boolean;

  /**
   * Determine whether to enable cache in get requests
   *
   * @default false
   */
  cache?: boolean;

  /**
   * Cache options
   */
  cacheOptions?: {
    driver: CacheDriverInterface;
    expiresAfter?: number;
  };

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
  setAuthorizationHeader?:
    | string
    | ((requestConfig: AxiosRequestConfig) => string);
};

export type RequestEndpointConfigurations = EndpointConfigurations & {
  /**
   * Cache options
   */
  cacheOptions: {
    driver?: CacheDriverInterface;
    expiresAfter?: number;
  };
};
