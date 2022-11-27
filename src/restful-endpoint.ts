import endpoint from "./endpoint";
import { AxiosResponse, AxiosRequestConfig, AxiosInstance } from "axios";
import { HttpData, RestfulService } from "./types";

export default class RestfulEndpoint implements RestfulService {
  /**
   * Set the main module route
   * i.e /users
   *
   * @var  {string}
   */
  public route: string = "";

  /**
   * End point object
   */
  protected endpoint: AxiosInstance = endpoint;

  /**
   * Default list method params
   */
  public static defaultListParams = {
    paginate: true,
  };

  /**
   * Fetch records from endpoint api
   *
   * @param   {any} params
   * @param   {AxiosRequestConfig} options
   * @returns {Promise<AxiosResponse>}
   */
  public list(
    params: any = RestfulEndpoint.defaultListParams,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    config.params = params;

    return endpoint.get(this.route, config);
  }

  /**
   * Fetch one record from endpoint api
   *
   * @param   {number | string} id
   * @param   {any} params
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public get(
    id: number | string,
    params: any = {},
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    if (!config.params) {
      config.params = params;
    }

    return endpoint.get(this.path(id), config);
  }

  /**
   * Publish/Unpublish a record
   * This sends a request with a `published` key with true or false value
   *
   * @param  {number | string} id
   * @param  {boolean} published
   * @param  {string} publishKey
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public publish(
    id: number | string,
    published: boolean | HttpData,
    publishKey: string = "published",
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    const data =
      typeof published === "object" ? published : { [publishKey]: published };

    return this.patch(id, data, config);
  }

  /**
   * Create new record
   *
   * @param   {HttpData} data
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public create(
    data: HttpData,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return endpoint.post(this.route, data, config);
  }

  /**
   * Update an existing record
   *
   * @param   {number | string} id
   * @param   {HttpData} data
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public update(
    id: number | string,
    data: HttpData,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return endpoint.put(this.path(id), data, config);
  }

  /**
   * Delete existing record
   *
   * @param   {number | string} id
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public delete(
    id: number | string,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return endpoint.delete(this.path(id), config);
  }

  /**
   * Patch an update on a record
   *
   * @param   {number | string} id
   * @param   {AxiosRequestConfig} config
   * @returns {Promise<AxiosResponse>}
   */
  public patch(
    id: number | string,
    data = {},
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return endpoint.patch(this.path(id), data, config);
  }

  /**
   * Concatenate the given path with the base route
   *
   * @param  {string | number} path
   * @returns {string}
   */
  public path(path: string | number = ""): string {
    return this.route + (path ? "/" + String(path).replace(/^\//, "") : "");
  }
}
