import events, { EventSubscription } from "@mongez/events";
import { merge, Random } from "@mongez/reinforcements";
import Is from "@mongez/supportive-is";
import axios, { Axios, AxiosRequestConfig, AxiosResponse } from "axios";
import {
  EndpointConfigurations,
  EndpointEvent,
  RequestEndpointConfigurations,
} from "./Endpoint.types";

export default class Endpoint extends Axios {
  /**
   * Last request controller
   */
  public lastRequest?: AbortController;

  /**
   * Default configurations
   */
  protected defaultConfigurations: EndpointConfigurations = {
    putToPost: false,
    cache: false,
    cacheOptions: {
      expiresAfter: 5 * 60, // 5 minutes
    },
    putMethodKey: "_method",
    ...(axios.defaults as any),
  };

  /**
   * Endpoint id
   */
  protected endpointId = Random.id();

  /**
   * Endpoint event namespace
   */
  protected eventNamespace = `endpoint.${this.endpointId}`;

  /**
   * Constructor
   */
  public constructor(public configurations: EndpointConfigurations = {}) {
    super(configurations);
    this.defaults = merge(this.defaultConfigurations, configurations) as any;
    this.configurations = merge(this.defaultConfigurations, configurations);

    this.boot();
  }

  /**
   * Set endpoint configurations
   */
  public setConfigurations(configurations: EndpointConfigurations) {
    this.configurations = merge(this.configurations, configurations);

    this.defaults = this.configurations as any;
  }

  /**
   * Boot the endpoint
   */
  protected boot() {
    this.addInterceptors();
  }

  /**
   * Add axios interceptors
   */
  protected addInterceptors() {
    this.addRequestInterceptors();
    this.addResponseInterceptors();
  }

  /**
   * Add request interceptors
   */
  protected addRequestInterceptors() {
    this.interceptors.request.use((requestConfig: AxiosRequestConfig) => {
      // A workaround for put requests to be sent as post request
      // this will allow us to upload images
      const headers = requestConfig.headers || {};

      const isPutRequest = requestConfig.method?.toUpperCase() === "PUT";

      let data = requestConfig.data;

      if (Is.formElement(data)) {
        data = new FormData(data);
      }

      if (isPutRequest && this.configurations.putToPost) {
        requestConfig.method = "POST";
        if (Is.formData(data)) {
          data.append(this.configurations.putMethodKey, "PUT");
        } else if (Is.plainObject(data) && this.configurations.putMethodKey) {
          data = set(data, this.configurations.putMethodKey, "PUT");
        }
      }

      if (Is.plainObject(data)) {
        headers!["Content-Type"] = "Application/json";

        data = JSON.stringify(data);
      }

      requestConfig.data = data;

      const authHeader = this.configurations.setAuthorizationHeader;

      if (authHeader && !headers?.Authorization) {
        headers.Authorization =
          typeof authHeader === "function"
            ? authHeader(requestConfig)
            : authHeader;
      }

      requestConfig.headers = headers;

      this.lastRequest = new AbortController();

      requestConfig.signal = this.lastRequest.signal;

      // trigger event of sending ajax request
      this.trigger("sending", requestConfig);

      return requestConfig;
    });
  }

  /**
   * Add response interceptors
   */
  protected addResponseInterceptors() {
    this.interceptors.response.use(
      (response) => {
        if (response.config.signal === this.lastRequest?.signal) {
          this.lastRequest = undefined;
        }

        this.trigger("complete", response);
        this.trigger("success", response);

        return response;
      },
      (error) => {
        if (error.response?.config?.signal === this.lastRequest?.signal) {
          this.lastRequest = undefined;
        }

        this.trigger("complete", error.response);
        this.trigger("error", error.response);

        return Promise.reject(error);
      }
    );
  }

  /**
   * {@inheritDoc}
   */
  public get<T = any, R = AxiosResponse<T>>(
    url: string,
    options?: RequestEndpointConfigurations
  ): Promise<R> {
    return new Promise(async (resolve, reject) => {
      if (
        options?.cache ||
        (this.configurations.cache && options?.cache !== false)
      ) {
        const cacheConfigurations = {
          ...(this.configurations.cacheOptions || {}),
          ...(options?.cacheOptions || {}),
        };

        const cacheDriver = cacheConfigurations.driver;

        const cacheKey = this.getCacheKey(url);

        const response = await cacheDriver?.get(cacheKey);

        if (response) {
          resolve(response as any);
        } else {
          super
            .get(url, options)
            .then((response) => {
              cacheDriver?.set(
                cacheKey,
                {
                  data: response.data,
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                },
                cacheConfigurations.expiresAfter
              );
              resolve(response as any);
            })
            .catch((error) => reject(error));
        }
      } else {
        super
          .get(url, options)
          .then(resolve as any)
          .catch(reject);
      }
    });
  }

  /**
   * Get endpoint last request
   */
  public getLastRequest() {
    return this.lastRequest;
  }

  /**
   * Get events subscribers
   */
  public get events() {
    return {
      /**
       * Triggered when response is returned with error response
       */
      onError: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.error`, callback);
      },
      /**
       * Triggered when response is returned with success response
       */
      onSuccess: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.success`, callback);
      },
      /**
       * Triggered when response is returned wether it is success or error response
       */
      onComplete: (
        callback: (response: AxiosResponse) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.complete`, callback);
      },
      /**
       * Triggered before sending response
       */
      beforeSending: (
        callback: (config: AxiosRequestConfig) => void
      ): EventSubscription => {
        return events.subscribe(`${this.eventNamespace}.sending`, callback);
      },
    };
  }

  /**
   * Trigger the given event
   */
  protected trigger(event: EndpointEvent, ...args: any[]) {
    return events.trigger(`${this.eventNamespace}.${event}`, ...args);
  }

  /**
   * Get cache key form the given path
   */
  public getCacheKey(path: string) {
    return `endpoint.${this.configurations.baseURL}.${path}`;
  }
}
