import concatRoute from "@mongez/concat-route";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { getCurrentEndpoint } from "../current-endpoint";
import Endpoint from "../Endpoint";
import { HttpData, RestfulService } from "./RestfulEndpoint.types";

export default class RestfulEndpoint implements RestfulService {
  /**
   * Set the main module route
   * i.e /users
   */
  public route = "";

  /**
   * End point object
   */
  protected endpoint: Endpoint = getCurrentEndpoint();

  /**
   * Default list method params
   */
  public static defaultListParams = {};

  /**
   * List params to be set per instance
   */
  public listParams = RestfulEndpoint.defaultListParams;

  /**
   * Fetch records from endpoint api
   */
  public list(
    params = this.listParams,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    config.params = params;

    return this.endpoint.get(this.route, config);
  }

  /**
   * Fetch one record from endpoint api
   */
  public get(
    id: number | string,
    params = {},
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    if (!config.params) {
      config.params = params;
    }

    return this.endpoint.get(this.path(id), config);
  }

  /**
   * Publish/Unpublish a record
   * This sends a request with a `published` key with true or false value
   *
   */
  public publish(
    id: number | string,
    published: boolean | HttpData,
    publishKey = "published",
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    const data =
      typeof published === "object" ? published : { [publishKey]: published };

    return this.patch(this.path(id), data, config);
  }

  /**
   * Create new record
   */
  public create(
    data: HttpData,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return this.endpoint.post(this.route, data, config);
  }

  /**
   * Update an existing record
   */
  public update(
    id: number | string,
    data: HttpData,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return this.endpoint.put(this.path(id), data, config);
  }

  /**
   * Delete existing record
   */
  public delete(
    id: number | string,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return this.endpoint.delete(this.path(id), config);
  }

  /**
   * Delete multiple records
   */
  public bulkDelete(
    data,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    config.data = data;
    return this.endpoint.delete(this.path(), config);
  }

  /**
   * Patch an update on a record
   */
  public patch(
    id: number | string,
    data = {},
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
    return this.endpoint.patch(this.path(id), data, config);
  }

  /**
   * Concatenate the given path with the base route
   */
  public path(path: string | number = ""): string {
    return concatRoute(this.route, String(path));
  }
}
