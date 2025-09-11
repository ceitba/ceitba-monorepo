export interface ApiResponse<T> {
    data: T | null;
    error: ApiError | null;
    status: number;
}

export interface ApiError {
    code: string;
    message: string;
    details?: any;
}

export interface RequestConfig {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    params?: Record<string, any>;
    body?: any;
    timeout?: number;
}

export interface ApiClient {
    get<T>(url: string, config?: RequestConfig): Promise<ApiResponse<T>>;
    post<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>>;
    put<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>>;
    delete<T>(url: string, config?: RequestConfig): Promise<ApiResponse<T>>;
    patch<T>(url: string, data?: any, config?: RequestConfig): Promise<ApiResponse<T>>;
}

export interface ExternalApiConfig {
    baseUrl: string;
    apiKey?: string;
    timeout?: number;
    defaultHeaders?: Record<string, string>;
}
