import { AxiosRequestConfig, AxiosResponse } from "axios";

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
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

  /**
   * Delete a resource using id
   */
  delete: (id: number, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

  /**
   * Bulk delete
   */
  bulkDelete: (
    data: any,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse>;

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
