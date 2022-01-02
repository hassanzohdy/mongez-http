import { EventSubscription } from "@mongez/events";
import { AxiosResponse, AxiosRequestConfig } from "axios";

export type HttpEvent = "sending" | "success" | "error" | "send";

/**
 * Types of data that can be sent with the request
 */
export type HttpData = string | object | FormData | HTMLFormElement;

export interface RestfulService {
  /**
   * Defines base route
   */
  route: string;

  /**
   * Retrieve list of resources
   */
  list: (params?: any, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

  /**
   * Get a single resource by id
   */
  get: (
    id: number | string,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

  /**
   * Create new record
   *
   * @param   {HttpData} data
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  create: (
    data: HttpData,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

  /**
   * Update an existing record
   *
   * @param   {number | string} id
   * @param   {HttpData} data
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  update: (
    id: number | string,
    data: HttpData,
    config: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

  /**
   * Delete a resource using id
   */
  delete: (id: number, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

  /**
   * Delete existing record
   *
   * @param   {number} id
   * @param   {HttpData} data
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  patch: (
    id: number | string,
    data: HttpData,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

  /**
   * Concatenate the given path with the base route
   *
   * @param  {string | number} path
   * @returns {string}
   */
  path: (path: string | number) => string;
}

export type HttpConfigurations = {
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

export type EndpointEventsInterface = {
  /**
   * Trigger endpoint event
   */
  trigger: (eventName: HttpEvent, ...args: any[]) => any;
  /**
   * Triggered when response is returned with error response
   */
  onError: (response: AxiosResponse) => EventSubscription;
  /**
   * Triggered when response is returned with success response
   */
  onSuccess: (response: AxiosResponse) => EventSubscription;
  /**
   * Triggered when response is returned wether it is success or error response
   */
  onResponse: (response: AxiosResponse) => EventSubscription;
  /**
   * Triggered before sending response
   */
  beforeSending: (
    callback: (config: AxiosRequestConfig) => void
  ) => EventSubscription;
};
